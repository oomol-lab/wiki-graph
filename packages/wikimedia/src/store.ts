/* eslint-disable */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import type {
  DisambiguationItem,
  EntityData,
  EntityOutput,
  PageMeta,
  Profile,
  SiteOutput,
  Wiki,
} from "./types.js";

const WIKIS = ["zhwiki", "enwiki"] as const;

interface SiteRow {
  readonly wiki: Wiki;
  readonly source_title: string | null;
  readonly label: string | null;
  readonly description: string | null;
  readonly url: string | null;
  readonly site_exists: boolean;
  readonly page_id: string | number | null;
  readonly revision_id: string | number | null;
  readonly is_disambiguation_page: boolean;
}

export class Store {
  public constructor(
    private readonly db: Pool,
    private readonly ttlDays = 14,
  ) {}

  async migrate(): Promise<void> {
    await this.db.query(
      await readFile(
        resolve(
          dirname(fileURLToPath(import.meta.url)),
          "../migrations/001_initial.sql",
        ),
        "utf8",
      ),
    );
  }

  async resolve(
    input: readonly { qid: string; disambiguation: boolean }[],
    client: {
      entities(qids: readonly string[]): Promise<readonly EntityData[]>;
      pages(
        wiki: Wiki,
        titles: readonly string[],
      ): Promise<readonly PageMeta[]>;
      disambiguation(page: PageMeta): Promise<any>;
    },
    normalizer: { normalize(input: any): Promise<Profile> },
  ): Promise<readonly EntityOutput[]> {
    const unique = [...new Map(input.map((item) => [item.qid, item])).values()];
    const results = new Map<string, EntityOutput>();
    const missing: typeof unique = [];

    for (const item of unique) {
      await this.expireIfNeeded(item);
      const cached = await this.readCached(item);
      if (cached === undefined) missing.push(item);
      else results.set(item.qid, cached);
    }

    if (missing.length > 0) {
      const entities = await client.entities(missing.map((item) => item.qid));
      const entitiesByQid = new Map(
        entities.map((entity) => [entity.qid, entity]),
      );
      const pagesByWiki = await this.fetchPages(client, entities);
      for (const item of missing) {
        const result = await this.rebuild(
          item,
          entitiesByQid.get(item.qid),
          pagesByWiki,
          client,
          normalizer,
        );
        results.set(item.qid, result);
      }
    }

    return input.map((item) => results.get(item.qid)!);
  }

  private async expireIfNeeded(item: {
    readonly qid: string;
    readonly disambiguation: boolean;
  }): Promise<void> {
    const connection = await this.db.connect();
    try {
      await connection.query("BEGIN");
      const root = await connection.query<{
        refreshed_at: Date;
        wikispine_disambiguation: boolean;
      }>(
        "SELECT refreshed_at,wikispine_disambiguation FROM qid_entity WHERE qid=$1 FOR UPDATE",
        [item.qid],
      );
      const row = root.rows[0];
      const expired =
        row !== undefined &&
        Date.now() - new Date(row.refreshed_at).getTime() >
          this.ttlDays * 86_400_000;
      const flagChanged =
        row !== undefined &&
        row.wikispine_disambiguation !== item.disambiguation;
      if (expired || flagChanged) {
        await connection.query("DELETE FROM qid_site WHERE qid=$1", [item.qid]);
      }
      if (flagChanged) {
        await connection.query(
          "UPDATE qid_entity SET wikispine_disambiguation=$2 WHERE qid=$1",
          [item.qid, item.disambiguation],
        );
      }
      await connection.query("COMMIT");
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }
  }

  private async readCached(item: {
    readonly qid: string;
    readonly disambiguation: boolean;
  }): Promise<EntityOutput | undefined> {
    const root = await this.db.query<{ wikispine_disambiguation: boolean }>(
      "SELECT wikispine_disambiguation FROM qid_entity WHERE qid=$1",
      [item.qid],
    );
    if (
      root.rows[0] === undefined ||
      root.rows[0].wikispine_disambiguation !== item.disambiguation
    ) {
      return undefined;
    }
    const sites = await this.db.query<SiteRow>(
      "SELECT wiki,source_title,label,description,url,site_exists,page_id,revision_id,is_disambiguation_page FROM qid_site WHERE qid=$1",
      [item.qid],
    );
    if (sites.rows.length !== WIKIS.length) return undefined;
    const byWiki = new Map(sites.rows.map((row) => [row.wiki, row]));
    if (!WIKIS.every((wiki) => byWiki.has(wiki))) return undefined;

    const output: EntityOutput = {
      qid: item.qid,
      zh: siteOutput(byWiki.get("zhwiki")),
      en: siteOutput(byWiki.get("enwiki")),
    };
    if (!item.disambiguation) return output;

    const disambiguationSites = sites.rows.filter(
      (site) => site.is_disambiguation_page,
    );
    if (disambiguationSites.length === 0) {
      return { ...output, disambiguation: [] };
    }
    const profiles = await this.db.query<{ result_json: Profile }>(
      `SELECT profile.result_json
       FROM qid_site_disambiguation_profile AS profile
       INNER JOIN qid_site_disambiguation AS content
         ON content.qid=profile.qid
        AND content.wiki=profile.wiki
        AND content.page_id=profile.page_id
        AND content.revision_id=profile.revision_id
       INNER JOIN qid_site AS site
         ON site.qid=content.qid
        AND site.wiki=content.wiki
        AND site.page_id=content.page_id
        AND site.revision_id=content.revision_id
       WHERE profile.qid=$1 AND profile.status='ready'`,
      [item.qid],
    );
    if (profiles.rows.length < disambiguationSites.length) return undefined;
    return {
      ...output,
      disambiguation: fuseMeanings(
        profiles.rows.flatMap((row) => parseProfile(row.result_json).meanings),
      ),
    };
  }

  private async fetchPages(
    client: {
      pages(
        wiki: Wiki,
        titles: readonly string[],
      ): Promise<readonly PageMeta[]>;
    },
    entities: readonly EntityData[],
  ): Promise<ReadonlyMap<Wiki, ReadonlyMap<string, PageMeta>>> {
    const result = new Map<Wiki, ReadonlyMap<string, PageMeta>>();
    for (const wiki of WIKIS) {
      const titles = [
        ...new Set(
          entities.flatMap((entity) =>
            entity.sitelinks[wiki] === undefined
              ? []
              : [entity.sitelinks[wiki]],
          ),
        ),
      ];
      const pages = titles.length === 0 ? [] : await client.pages(wiki, titles);
      result.set(
        wiki,
        new Map(
          pages.flatMap((page) => [
            [page.requestedTitle ?? page.title, page],
            [page.title, page],
          ]),
        ),
      );
    }
    return result;
  }

  private async rebuild(
    item: { readonly qid: string; readonly disambiguation: boolean },
    entity: EntityData | undefined,
    pagesByWiki: ReadonlyMap<Wiki, ReadonlyMap<string, PageMeta>>,
    client: { disambiguation(page: PageMeta): Promise<any> },
    normalizer: { normalize(input: any): Promise<Profile> },
  ): Promise<EntityOutput> {
    await this.db.query(
      "INSERT INTO qid_entity(qid,wikispine_disambiguation,refreshed_at) VALUES($1,$2,NOW()) ON CONFLICT(qid) DO UPDATE SET wikispine_disambiguation=EXCLUDED.wikispine_disambiguation",
      [item.qid, item.disambiguation],
    );
    const siteValues = new Map<Wiki, { output: SiteOutput; page?: PageMeta }>();

    for (const wiki of WIKIS) {
      const language = wiki === "zhwiki" ? "zh" : "en";
      const sourceTitle = entity?.sitelinks[wiki];
      const page =
        sourceTitle === undefined
          ? undefined
          : pagesByWiki.get(wiki)?.get(sourceTitle);
      const output = {
        label: entity?.labels[language] ?? page?.title ?? null,
        description:
          entity?.descriptions[language] ?? page?.description ?? null,
        url: page?.url ?? null,
      };
      await this.db.query(
        "INSERT INTO qid_site(qid,wiki,source_title,label,description,url,site_exists,page_id,revision_id,is_disambiguation_page) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(qid,wiki) DO UPDATE SET source_title=EXCLUDED.source_title,label=EXCLUDED.label,description=EXCLUDED.description,url=EXCLUDED.url,site_exists=EXCLUDED.site_exists,page_id=EXCLUDED.page_id,revision_id=EXCLUDED.revision_id,is_disambiguation_page=EXCLUDED.is_disambiguation_page,updated_at=NOW()",
        [
          item.qid,
          wiki,
          sourceTitle ?? null,
          output.label,
          output.description,
          output.url,
          page !== undefined,
          page?.pageId ?? null,
          page?.revisionId ?? null,
          page?.isDisambiguation ?? false,
        ],
      );
      siteValues.set(wiki, { output, ...(page === undefined ? {} : { page }) });
    }

    const meanings: DisambiguationItem[] = [];
    if (item.disambiguation) {
      for (const wiki of WIKIS) {
        const page = siteValues.get(wiki)?.page;
        if (page?.isDisambiguation !== true) continue;
        const parsed = await client.disambiguation(page);
        await this.db.query(
          "INSERT INTO qid_site_disambiguation(qid,wiki,page_id,revision_id,content_json) VALUES($1,$2,$3,$4,$5) ON CONFLICT(qid,wiki,page_id,revision_id) DO UPDATE SET content_json=EXCLUDED.content_json,updated_at=NOW()",
          [
            item.qid,
            wiki,
            page.pageId,
            page.revisionId,
            JSON.stringify(parsed),
          ],
        );
        const profile = await normalizer.normalize({
          sourceQid: item.qid,
          wiki,
          page: parsed,
        });
        meanings.push(...profile.meanings);
        await this.db.query(
          "INSERT INTO qid_site_disambiguation_profile(qid,wiki,page_id,revision_id,normalizer_version,model_id,result_json,status) VALUES($1,$2,$3,$4,'v1','configured',$5,'ready') ON CONFLICT(qid,wiki,page_id,revision_id,normalizer_version,model_id) DO UPDATE SET result_json=EXCLUDED.result_json,status='ready',error_message=NULL,updated_at=NOW()",
          [
            item.qid,
            wiki,
            page.pageId,
            page.revisionId,
            JSON.stringify(profile),
          ],
        );
      }
    }
    await this.db.query(
      "UPDATE qid_entity SET refreshed_at=NOW(),wikispine_disambiguation=$2 WHERE qid=$1",
      [item.qid, item.disambiguation],
    );
    return {
      qid: item.qid,
      zh: siteValues.get("zhwiki")!.output,
      en: siteValues.get("enwiki")!.output,
      ...(item.disambiguation
        ? { disambiguation: fuseMeanings(meanings) }
        : {}),
    };
  }

  async close(): Promise<void> {
    await this.db.end();
  }
}

function siteOutput(row: SiteRow | undefined): SiteOutput {
  return {
    label: row?.label ?? null,
    description: row?.description ?? null,
    url: row?.url ?? null,
  };
}

function parseProfile(value: Profile | string): Profile {
  return typeof value === "string" ? (JSON.parse(value) as Profile) : value;
}

function fuseMeanings(
  meanings: readonly DisambiguationItem[],
): readonly DisambiguationItem[] {
  return [
    ...new Map(meanings.map((meaning) => [meaning.qid, meaning])).values(),
  ];
}
