import { createWriteStream } from "fs";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, describe, expect, it } from "vitest";
import { ZipFile } from "yazl";
import { formatLocatedWikiGraphUri } from "wiki-graph-core";

import { createWikiGraphSDK } from "./sdk.js";

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map(async (path) => await rm(path, { force: true, recursive: true })),
  );
});

describe("PCEX conversion", () => {
  it("creates sourced WIKG chapters with PDF locators", async () => {
    const root = await mkdtemp(join(tmpdir(), "wiki-graph-pcex-"));
    temporary.push(root);
    await writePcex(join(root, "book.pcex"));
    const sdk = createWikiGraphSDK({
      cwd: root,
      stateDir: join(root, "state"),
    });
    try {
      const digest = "a".repeat(64);
      const result = await sdk.conversions.convert({
        input: {
          format: "pcex",
          path: "book.pcex",
          sourcePdf: { digest, name: "source.pdf" },
        },
        output: { format: "wikg", path: "book.wikg" },
        targetStage: "sourced",
      });
      expect(result).toMatchObject({
        chapterCount: 1,
        sourceArtifact: {
          digest,
          mediaType: "application/pdf",
          name: "source.pdf",
        },
      });
      const archive = await sdk.archives.open("book.wikg");
      const tree = await archive.getChapterTree();
      expect(tree.chapters).toHaveLength(1);
      const source = await archive.page(`${tree.chapters[0]!.uri}/source`);
      expect(source).toMatchObject({
        fragment: { sentenceCount: 1, text: "A😀 world." },
        type: "fragment",
      });
      const path = tree.chapters[0]!.uri.replace("wikg://chapter/", "");
      const located = formatLocatedWikiGraphUri(
        join(root, "book.wikg"),
        `wikg://chapter/${path}/source/locators`,
      );
      const locators = await (await sdk.archives.open(located)).list();
      expect(locators).toMatchObject({
        items: [
          {
            range: [1, 3],
            uri: `wikg://artifact/${digest.slice(0, 12)}#page=1&bbox=0.1,0.6,0.5,0.8`,
          },
          {
            range: [4, 9],
            uri: `wikg://artifact/${digest.slice(0, 12)}#page=1&bbox=0.5,0.6,0.9,0.8`,
          },
        ],
      });
    } finally {
      sdk.close();
    }
  });
});

async function writePcex(path: string): Promise<void> {
  const zip = new ZipFile();
  zip.addBuffer(
    Buffer.from(
      JSON.stringify({
        format_version: 4,
        producer: { name: "test", version: "1" },
        document: {
          title: "Test book",
          description: null,
          publisher: null,
          isbn: null,
          authors: [{ name: "Author" }],
          publication_date: null,
          language: "en",
        },
      }),
    ),
    "manifest.json",
  );
  zip.addBuffer(
    Buffer.from(
      '<pages index_base="1" coordinate_space="ocr_pixels" render_dpi="144"><page index="1" width="1000" height="2000"/></pages>',
    ),
    "pages.xml",
  );
  zip.addBuffer(
    Buffer.from(
      '<chapter id="1" level="0"><flow><text role="body"><fragment page_index="1" source_order="0" bbox="100,400,500,800">A😀 </fragment><fragment page_index="1" source_order="1" bbox="500,400,900,800">world.</fragment></text></flow></chapter>',
    ),
    "chapters/chapter_1.xml",
  );
  zip.end();
  await new Promise<void>((resolve, reject) => {
    zip.outputStream
      .pipe(createWriteStream(path))
      .once("finish", resolve)
      .once("error", reject);
  });
}
