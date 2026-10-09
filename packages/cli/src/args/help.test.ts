import { describe, expect, it } from "vitest";
import { parseCLIArguments } from "./index.js";
import {
  renderArchiveMaintenanceChapterActionHelpText,
  renderArchiveMaintenanceCommandHelpText,
  renderGcCommandHelpText,
  renderHelpTopicText,
  renderLibraryPredicateHelpText,
  renderLibraryUriHelpText,
  renderMainHelpText,
  renderMaintenanceCommandHelpText,
  renderUriHelpText,
  renderUriPredicateHelpText,
  renderTransformHelpText,
} from "./help.js";

describe("cli/args/help", () => {
  const wikispineRuntimeGuideUrl =
    "https://raw.githubusercontent.com/oomol-lab/wiki-graph/refs/heads/main/docs/wikispine-runtime.md";

  it("shell-quotes actual URIs in dynamic help commands", () => {
    const archiveUri = "wikg://~/Library's Books/The little prince.wikg";
    const sourceUri = `${archiveUri}/chapter/part/source`;
    const archiveHelp = renderUriHelpText("archive-scope", archiveUri);
    const sourceSetHelp = renderUriPredicateHelpText(
      "chapter-source-object",
      "set",
      sourceUri,
    );

    expect(archiveHelp).toContain(`Target:\n  ${archiveUri}`);
    expect(archiveHelp).toContain(
      "wg 'wikg://~/Library'\\''s Books/The little prince.wikg'",
    );
    expect(archiveHelp).toContain(
      "wg 'wikg://~/Library'\\''s Books/The little prince.wikg'/chapter --help",
    );
    expect(archiveHelp).toContain(
      "wg 'wikg://~/Library'\\''s Books/The little prince.wikg'/title --help",
    );
    expect(archiveHelp).not.toContain(`wg ${archiveUri}`);
    expect(sourceSetHelp).toContain(`Target:\n  ${sourceUri}`);
    expect(sourceSetHelp).toContain(
      "wg 'wikg://~/Library'\\''s Books/The little prince.wikg/chapter/part/source' set",
    );
    expect(sourceSetHelp).not.toContain(`wg ${sourceUri}`);
  });

  it("prints archive maintenance help pages", () => {
    expect(parseCLIArguments(["meta", "--help"])).toStrictEqual({
      help: true,
      helpText: renderArchiveMaintenanceCommandHelpText("meta"),
      kind: "maintenance",
    });
    expect(parseCLIArguments(["cover", "--help"])).toStrictEqual({
      help: true,
      helpText: renderArchiveMaintenanceCommandHelpText("cover"),
      kind: "maintenance",
    });
    expect(() =>
      parseCLIArguments(["chapter", "set-summary", "--help"]),
    ).toThrow("Use concrete chapter resource URIs");
    expect(
      parseCLIArguments([
        "wikg://book.wikg/chapter/part/summary",
        "set",
        "--help",
      ]),
    ).toStrictEqual({
      help: true,
      helpText: renderUriPredicateHelpText(
        "chapter-summary-object",
        "set",
        "wikg://book.wikg/chapter/part/summary",
      ),
      kind: "help",
    });
    expect(() =>
      parseCLIArguments([
        "wikg://book.wikg/chapter/part/summary",
        "evidence",
        "--help",
      ]),
    ).toThrow("does not support `evidence`");
    expect(() =>
      parseCLIArguments(["wikg://book.wikg/chapter/part/summary", "evidence"]),
    ).toThrow("wg <chapter-uri>/summary --help");
    expect(() => parseCLIArguments(["chapter", "set-title", "--help"])).toThrow(
      "Use concrete chapter resource URIs",
    );
    expect(
      parseCLIArguments([
        "wikg://book.wikg/chapter/part/title",
        "set",
        "--help",
      ]),
    ).toStrictEqual({
      help: true,
      helpText: renderUriPredicateHelpText(
        "chapter-title-object",
        "set",
        "wikg://book.wikg/chapter/part/title",
      ),
      kind: "help",
    });
    expect(
      parseCLIArguments(["wikg://book.wikg/meta", "--help"]),
    ).toStrictEqual({
      help: true,
      helpText: renderUriHelpText("metadata-object", "wikg://book.wikg/meta"),
      kind: "help",
    });
    expect(
      parseCLIArguments(["wikg://book.wikg/entity/Q42/meta", "--help"]),
    ).toStrictEqual({
      help: true,
      helpText: renderUriHelpText(
        "metadata-object",
        "wikg://book.wikg/entity/Q42/meta",
      ),
      kind: "help",
    });
    expect(() =>
      parseCLIArguments([
        "wikg://book.wikg/entity/Q42/meta",
        "evidence",
        "--help",
      ]),
    ).toThrow("does not support `evidence`");
    expect(
      renderUriPredicateHelpText(
        "metadata-object",
        "put",
        "wikg://book.wikg/entity/Q42/meta",
      ),
    ).toContain("`--json` controls output shape");
    expect(
      parseCLIArguments([
        "wikg://book.wikg/chapter/part/source#1..2",
        "--help",
      ]),
    ).toStrictEqual({
      help: true,
      helpText: renderUriHelpText(
        "chapter-source-range-object",
        "wikg://book.wikg/chapter/part/source#1..2",
      ),
      kind: "help",
    });
    expect(
      parseCLIArguments(["wikg://book.wikg/chapter/part/summary#1", "--help"]),
    ).toStrictEqual({
      help: true,
      helpText: renderUriHelpText(
        "chapter-summary-range-object",
        "wikg://book.wikg/chapter/part/summary#1",
      ),
      kind: "help",
    });
    expect(
      parseCLIArguments(["wikg://book.wikg/chapter/part/source#1..2"]),
    ).toMatchObject({
      args: {
        action: "get",
        objectId: "wikg://book.wikg/chapter/part/source#1..2",
      },
      help: false,
      kind: "archive",
    });
    expect(
      parseCLIArguments([
        "wikg://book.wikg/chapter/part/source/locators#1..2",
        "--limit",
        "3",
        "--json",
      ]),
    ).toStrictEqual({
      args: {
        action: "list",
        archivePath: "wikg://book.wikg/chapter/part/source/locators#1..2",
        format: "json",
        limit: 3,
      },
      help: false,
      kind: "archive",
    });
    expect(
      parseCLIArguments([
        "wikg://book.wikg/chapter/part/source/locators#1..2",
        "--help",
      ]),
    ).toStrictEqual({
      help: true,
      helpText: renderUriHelpText(
        "chapter-source-locator-scope",
        "wikg://book.wikg/chapter/part/source/locators#1..2",
      ),
      kind: "help",
    });
    expect(() =>
      parseCLIArguments([
        "wikg://book.wikg/chapter/part/source#1..2",
        "set",
        "--help",
      ]),
    ).toThrow("does not support `set`");
    expect(
      renderUriPredicateHelpText(
        "chapter-scope",
        "move",
        "wikg://book.wikg/chapter/part",
      ),
    ).toContain("--root");
    expect(
      renderUriPredicateHelpText(
        "chapter-scope",
        "remove",
        "wikg://book.wikg/chapter/part",
      ),
    ).toContain("--recursive");
    expect(
      renderUriPredicateHelpText(
        "chapter-scope",
        "reset",
        "wikg://book.wikg/chapter/part",
      ),
    ).toContain("planned|source|reading-graph");
    expect(
      renderUriPredicateHelpText(
        "chapter-scope",
        "reset",
        "wikg://book.wikg/chapter/part",
      ),
    ).toContain("not supported reset targets");
    const resetHelpText = renderUriPredicateHelpText(
      "chapter-scope",
      "reset",
      "wikg://book.wikg/chapter/part",
    );
    expect(resetHelpText).toContain("source text and provenance");
    expect(resetHelpText).toContain("Knowledge Graph");
    expect(resetHelpText).toContain("all chapter index artifacts");
    expect(resetHelpText).toContain("source embedding artifact");
    const libraryChapterHelp = parseCLIArguments([
      "wikg://lib/chapter",
      "--help",
    ]);
    expect(libraryChapterHelp).toStrictEqual({
      help: true,
      helpText: renderUriHelpText(
        "chapter-collection-scope",
        "wikg://lib/chapter",
      ),
      kind: "help",
    });
    if (libraryChapterHelp.kind !== "help") {
      throw new Error("Expected help result.");
    }
    expect(libraryChapterHelp.helpText).toContain("read-only aggregate views");
    expect(libraryChapterHelp.helpText).not.toContain(
      "add: create a child object",
    );
    expect(() =>
      parseCLIArguments(["wikg://lib/chapter", "add", "--help"]),
    ).toThrow("library-wide chapter target");
    expect(() =>
      parseCLIArguments(["wikg://book.wikg/chapter", "move", "--help"]),
    ).toThrow("does not support `move`");
    expect(() =>
      parseCLIArguments(["wikg://lib/chapter/part/source", "set", "--help"]),
    ).toThrow("library-wide chapter target");
    expect(
      renderUriPredicateHelpText(
        "chapter-collection-scope",
        "add",
        "wikg://lib/arc/archive123/chapter",
      ),
    ).toContain("wikg://lib/arc/<archive-id>/chapter/part");
    expect(
      renderUriPredicateHelpText(
        "chapter-title-object",
        "clear",
        "wikg://book.wikg/chapter/part/title",
      ),
    ).toContain("does not delete the chapter");
  });

  it("shows the explicit home schema recovery command", () => {
    expect(renderMaintenanceCommandHelpText("upgrade")).toContain(
      "wg maintenance upgrade home",
    );
  });

  it("prints help topic pages", () => {
    expect(parseCLIArguments(["help", "runtime"])).toStrictEqual({
      help: true,
      helpText: renderHelpTopicText("runtime"),
      kind: "help",
    });
    expect(parseCLIArguments(["help", "library"])).toStrictEqual({
      help: true,
      helpText: renderHelpTopicText("library"),
      kind: "help",
    });
    expect(() => parseCLIArguments(["help", "object"])).toThrow(
      "Invalid help topic: object.",
    );
    expect(() => parseCLIArguments(["help", "object", "entity"])).toThrow(
      "Unexpected positional arguments: entity.",
    );
    expect(() => parseCLIArguments(["help", "entity"])).toThrow(
      "Invalid help topic: entity.",
    );
    expect(
      parseCLIArguments(["wikg://book.wikg/chunk", "--help"]),
    ).toStrictEqual({
      help: true,
      helpText: renderUriHelpText("chunk-scope", "wikg://book.wikg/chunk"),
      kind: "help",
    });
    expect(
      parseCLIArguments(["wikg://book.wikg/chapter/tree", "--help"]),
    ).toStrictEqual({
      help: true,
      helpText: renderUriHelpText(
        "chapter-tree-object",
        "wikg://book.wikg/chapter/tree",
      ),
      kind: "help",
    });
    expect(
      parseCLIArguments(["wikg://book.wikg/entity/Q42", "related", "--help"]),
    ).toStrictEqual({
      help: true,
      helpText: renderUriPredicateHelpText(
        "entity-object",
        "related",
        "wikg://book.wikg/entity/Q42",
      ),
      kind: "help",
    });
    for (const [uri, predicate] of [
      ["wikg://lib/arc/archive123/entity/Q42/evidence", "evidence"],
      ["wikg://lib/arc/archive123/chunk/12/related", "related"],
      ["wikg://lib/arc/archive123/triple/Q1/mentions/Q2/pack", "pack"],
      [
        "wikg://lib/arc/archive123/chapter/part/entity/Q42/evidence",
        "evidence",
      ],
    ] as const) {
      expect(() => parseCLIArguments([uri, "--help"])).toThrow(
        `Use predicate form: ${uri.slice(0, -predicate.length - 1)} ${predicate}`,
      );
    }
    expect(() =>
      parseCLIArguments([
        "wikg://lib/arc/archive123/triple/Q1/mentions/Q2/extra/pack",
        "--help",
      ]),
    ).toThrow("Unknown Wiki Graph URI target");
    expect(() => parseCLIArguments(["help", "verb", "get"])).toThrow(
      "Unexpected positional arguments: get.",
    );
    expect(() => parseCLIArguments(["help", "get"])).toThrow(
      "Invalid help topic: get.",
    );
    expect(() => parseCLIArguments(["help", "matrix"])).toThrow(
      "Invalid help topic: matrix.",
    );
  });

  it("rejects invalid help usage", () => {
    expect(() => parseCLIArguments(["help", "unknown"])).toThrow(
      "Invalid help topic: unknown. Expected one of format, file-import, source-locators, config, runtime, uri, recipe, readiness, library.\nSee: wg --help",
    );
    expect(() =>
      parseCLIArguments(["help", "object", "entity", "extra"]),
    ).toThrow("Unexpected positional arguments: entity extra.");
    expect(() => parseCLIArguments(["help", "verb", "get", "extra"])).toThrow(
      "Unexpected positional arguments: get extra.",
    );
    expect(() =>
      parseCLIArguments(["help", "recipe", "--input", "book.epub"]),
    ).toThrow("The `help` command does not support --input.\nSee: wg --help");
    expect(() =>
      parseCLIArguments(["help", "runtime", "--llm", '{"model":"cli-model"}']),
    ).toThrow("The `help` command does not support --llm.\nSee: wg --help");
  });

  it("documents planned chapter source input and provenance JSONL", () => {
    const chapterAddHelpText = renderUriPredicateHelpText(
      "chapter-collection-scope",
      "add",
      "wikg://book.wikg/chapter",
    );
    const chapterHelpText = renderUriHelpText(
      "chapter-scope",
      "wikg://book.wikg/chapter/part",
    );
    const sourceHelpText = renderUriHelpText(
      "chapter-source-object",
      "wikg://book.wikg/chapter/part/source",
    );
    const sourceRangeHelpText = renderUriHelpText(
      "chapter-source-range-object",
      "wikg://book.wikg/chapter/part/source#1..2",
    );
    const sourceSetHelpText = renderUriPredicateHelpText(
      "chapter-source-object",
      "set",
      "wikg://book.wikg/chapter/part/source",
    );
    const fileImportHelpText = renderHelpTopicText("file-import");

    expect(chapterHelpText).toContain(
      "wikg://book.wikg/chapter/part/source --help",
    );
    expect(chapterAddHelpText).toContain("Located URI");
    expect(chapterAddHelpText).toContain("`uri` and `locatedUri`");
    expect(chapterAddHelpText).toContain("non-empty UTF-8 plain text");
    expect(chapterAddHelpText).toContain("does not create a source-text map");
    expect(chapterAddHelpText).toContain("does not infer a");
    expect(chapterAddHelpText).toContain(
      "handles are opaque and are not derived from `--title`",
    );
    expect(chapterHelpText).toContain(
      "wikg://book.wikg/chapter/part/state --help",
    );
    expect(sourceSetHelpText).toContain(
      "Fill a planned chapter with its complete source text.",
    );
    expect(sourceSetHelpText).toContain(
      "Supply exactly one positional value or `--input`",
    );
    expect(sourceSetHelpText).toContain("must be `planned`");
    expect(sourceSetHelpText).toContain("Source input must not be empty");
    expect(sourceSetHelpText).toContain("Plain text writes source without");
    expect(sourceSetHelpText).toContain("File extensions are not inferred");
    expect(sourceSetHelpText).toContain(
      "does not replace source on a later-stage chapter",
    );
    expect(sourceSetHelpText).toContain(
      "`sourceUnits` is the number of stored source processing fragments",
    );
    expect(sourceSetHelpText).toContain("<chapter-uri>/state --help");
    expect(sourceSetHelpText).toContain("<chapter-uri> reset --help");
    expect(sourceSetHelpText).toContain("[--json]");
    expect(fileImportHelpText).toContain(
      "`create --import` currently accepts EPUB",
    );
    expect(fileImportHelpText).not.toContain("create --import ./book.pdf");
    expect(fileImportHelpText).toContain('"type":"artifact"');
    expect(fileImportHelpText).toContain('"pageIndex":1');
    expect(fileImportHelpText).toContain('"cfi":"epubcfi(...)"');
    expect(fileImportHelpText).toContain("offsets are not input fields");
    expect(fileImportHelpText).toContain("SHA-256 of source file bytes");
    expect(fileImportHelpText).toContain(
      'wikg://book.wikg/chapter add --title "Part" --json',
    );
    expect(fileImportHelpText).toContain("<locatedUri>/source set");
    expect(fileImportHelpText).toContain("not title-derived slugs");
    expect(fileImportHelpText).not.toContain(
      "wikg://book.wikg/chapter/part/source set --input",
    );
    expect(fileImportHelpText).toContain(
      "<chapter-uri>/source/locators --json",
    );
    expect(sourceHelpText).toContain("containing `uri` and `text`");
    expect(sourceHelpText).toContain(
      "set: initialize source for a planned chapter",
    );
    expect(sourceRangeHelpText).toContain("current stored source revision");
    expect(sourceHelpText).toContain("/source/locators");
    expect(fileImportHelpText).toContain(
      "evidence cannot point back to a PDF page or EPUB CFI",
    );
    expect(renderHelpTopicText("recipe")).toContain(
      'wikg://book.wikg/chapter add --title "Part" --input ./chapter.txt',
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "wikg://local/job add --input <archive-uri> --task index-fts",
    );
    expect(renderHelpTopicText("recipe")).not.toContain("<chapter-id>");
  });

  it("documents the layered help contract", () => {
    const rootHelpText = renderMainHelpText();
    const uriHelpText = renderHelpTopicText("uri");
    const fileImportHelpText = renderHelpTopicText("file-import");
    const archiveCreateHelpText = renderUriPredicateHelpText(
      "archive-scope",
      "create",
      "wikg://book.wikg",
    );

    expect(rootHelpText).toContain("wg help [topic]");
    expect(rootHelpText).toContain("wg help recipe");
    expect(rootHelpText).toContain("wg help readiness");
    expect(rootHelpText).toContain("wg help library");
    expect(rootHelpText).not.toContain("wg help file-import");
    expect(rootHelpText).not.toContain("wg help source-locators");
    expect(uriHelpText).toContain("wikg://book.wikg/title");
    expect(uriHelpText).toContain(
      "<archive-uri>/title` is its queryable title object",
    );
    expect(fileImportHelpText).toContain("Source Files and Provenance");
    expect(fileImportHelpText).toContain("source-text map");
    expect(fileImportHelpText).toContain("OCR, layout analysis");
    expect(archiveCreateHelpText).toContain("wg help file-import");
    const locatorHelpText = renderHelpTopicText("source-locators");
    expect(locatorHelpText).toContain("wikg://artifact/<short-uid>");
    expect(locatorHelpText).toContain("wikg://artifact/<sha256-digest>");
    expect(locatorHelpText).toContain("3..13 -> <artifact-locator-uri>");
    expect(locatorHelpText).toContain("Returned `range` values count Unicode");
    expect(locatorHelpText).toContain("<chapter-uri>/source/locators#4..8");
    expect(locatorHelpText).toContain("--limit <n>");
    expect(
      renderUriHelpText(
        "artifact-object",
        `wikg://book.wikg/artifact/${"a".repeat(12)}`,
      ),
    ).toContain("Source artifact object");
    expect(
      parseCLIArguments([
        `wikg://lib/arc/archive123/artifact/${"a".repeat(12)}#epubcfi(/6/2!/4/2)`,
        "--help",
      ]),
    ).toMatchObject({ kind: "help" });
    expect(
      renderUriHelpText(
        "artifact-object",
        `wikg://book.wikg/artifact/${"a".repeat(64)}`,
      ),
    ).toContain("Source artifact object");
    expect(
      renderUriPredicateHelpText(
        "entity-object",
        "evidence",
        "wikg://book.wikg/entity/Q1",
      ),
    ).toContain("wg help source-locators");
    expect(
      renderUriHelpText(
        "chapter-source-locator-scope",
        "wikg://book.wikg/chapter/part/source/locators#1..2",
      ),
    ).toContain("Source locator collection scope");
    const libraryArtifactHelp = renderUriHelpText(
      "artifact-object",
      `wikg://lib/arc/archive123/artifact/${"a".repeat(64)}`,
    );
    expect(libraryArtifactHelp).toContain(
      "wikg://lib/arc/<archive-id>/artifact/<short-uid>",
    );
    expect(libraryArtifactHelp).not.toContain(
      "wikg://lib/arc/<archive-id>/entity",
    );
    expect(rootHelpText).toContain("Core concepts:");
    expect(rootHelpText).toContain("knowledge-base archives");
    expect(rootHelpText).toContain("Do not edit archive internals:");
    expect(rootHelpText).toContain("zip-based archive");
    expect(rootHelpText).toContain("Agents must not unzip it");
    expect(rootHelpText).toContain(
      "Direct internal edits can break consistency",
    );
    expect(rootHelpText).toContain(
      "Use the CLI's retrieval, generation, metadata, chapter, config, and maintenance commands",
    );
    expect(rootHelpText).toContain("Knowledge-base contents:");
    expect(rootHelpText).toContain(
      "Knowledge Graph: entity and predicate networks",
    );
    expect(rootHelpText).toContain("Reading Graph: attention chunks");
    expect(rootHelpText).toContain("Summaries: compressed reading outputs");
    expect(rootHelpText).toContain("Source text: original chapter content");
    expect(rootHelpText).toContain("retrieved through the search index");
    expect(rootHelpText).toContain("Scope: a URI target");
    expect(rootHelpText).toContain("Object: a URI target");
    expect(rootHelpText).toContain("Predicate: an operation bound to a URI");
    expect(rootHelpText).not.toContain("wg help task");
    expect(rootHelpText).toContain("wg help uri");
    expect(rootHelpText).toContain("wg <archive-uri> inspect");
    expect(rootHelpText).toContain("wg transform");
    expect(rootHelpText).toContain("wg wikg://lib --help");
    expect(rootHelpText).toContain(
      "Library registries, managed archive folders, path binding, and aggregate indexes",
    );
    expect(rootHelpText).not.toContain("aggregate indexes, and rebind");
    expect(rootHelpText).not.toContain("wg import");
    expect(rootHelpText).not.toContain("wg wikg://local/job add");
    expect(rootHelpText).not.toContain("wg <archive-uri>/index build");
    expect(rootHelpText).toContain(
      "The CLI help system is part of the product contract",
    );
    expect(rootHelpText).toContain("Use `wg <uri> --help`");
    expect(rootHelpText).toContain("Treat `wg --help` as the root");
    expect(rootHelpText).toContain("Wiki Graph CLI");
    expect(rootHelpText).not.toContain("wg help overview");
    expect(rootHelpText).not.toContain("wg help retrieval");
    expect(rootHelpText).not.toContain("wg help command");
    expect(rootHelpText).toContain("wg <uri> <predicate> --help");
    expect(rootHelpText).toContain("Important object families:");
    expect(rootHelpText).toContain("What to learn where:");
    expect(renderHelpTopicText("runtime")).toContain(
      "Runtime and Debug Behavior",
    );
    expect(renderHelpTopicText("config")).toContain("Configuration");
    expect(renderHelpTopicText("readiness")).toContain(
      "Archive index readiness:",
    );
    expect(renderHelpTopicText("readiness")).toContain("Embeddings readiness:");
    expect(renderHelpTopicText("readiness")).toContain(
      "Library index readiness:",
    );
    expect(renderHelpTopicText("readiness")).toContain(
      "Ordinary archive source query needs chapter index artifacts",
    );
    expect(renderHelpTopicText("readiness")).toContain(
      "Summary embedding alone does not satisfy ordinary archive source query readiness",
    );
    expect(renderHelpTopicText("readiness")).toContain(
      "`wg <archive-uri>/index sync` builds or repairs local `index.db` cache from artifacts",
    );
    expect(renderHelpTopicText("readiness")).toContain(
      "Archive-level query can create a missing cache from current artifacts on first use",
    );
    expect(renderHelpTopicText("readiness")).toContain(
      "Broad query is grouped by result type first",
    );
    expect(renderHelpTopicText("readiness")).toContain(
      "FTS, Dense, and Hybrid ranking affect ordering inside those result groups",
    );
    expect(renderHelpTopicText("readiness")).toContain(
      "wg <archive-uri>/index sync --help",
    );
    expect(renderHelpTopicText("readiness")).toContain(
      "wg <archive-uri>/index clean --help",
    );
    expect(renderHelpTopicText("readiness")).toContain(
      "wg wikg://lib/index sync --help",
    );
    expect(renderHelpTopicText("readiness")).toContain("LLM readiness:");
    expect(renderHelpTopicText("readiness")).toContain("WikiSpine readiness:");
    expect(renderHelpTopicText("readiness")).toContain("provider fetch");
    expect(renderHelpTopicText("readiness")).toContain(
      "If the selected provider fails its config test",
    );
    expect(renderHelpTopicText("readiness")).toContain(
      wikispineRuntimeGuideUrl,
    );
    expect(renderHelpTopicText("config")).toContain(
      "`cli` requires a `wikispine` executable on PATH",
    );
    expect(renderHelpTopicText("config")).toContain(
      "CLI help does not install the local WikiSpine runtime",
    );
    expect(renderHelpTopicText("config")).toContain(
      "`set <json>` and `set --json-input <json>` cannot set a real `apiKey`",
    );
    expect(renderHelpTopicText("config")).toContain(wikispineRuntimeGuideUrl);
    expect(
      renderUriHelpText(
        "local-config-section",
        "wikg://local/config/wikispine",
      ),
    ).toContain(wikispineRuntimeGuideUrl);
    expect(
      renderUriPredicateHelpText(
        "local-config-section",
        "test",
        "wikg://local/config/wikispine",
      ),
    ).toContain(wikispineRuntimeGuideUrl);
    expect(renderTransformHelpText()).toContain(
      "This is not a plain file-format converter",
    );
    expect(renderTransformHelpText()).toContain(
      "Source inputs (`epub`, `txt`, `markdown`) call an LLM",
    );
    expect(uriHelpText).toContain("wg <scope-uri> --query <query>");
    expect(uriHelpText).toContain("wg <entity|triple|chunk-uri> evidence");
    expect(uriHelpText).toContain(
      "wg wikg://local/job add --input <archive-uri|chapter-uri>",
    );
    expect(uriHelpText).toContain("Library locators:");
    expect(uriHelpText).toContain("wikg://lib/arc/<archive-id>/");
    expect(uriHelpText).toContain("wg next <uri> <cursor>");
    expect(uriHelpText).toContain("wg help format");
    expect(uriHelpText).not.toContain("JSONL contains object records");
    expect(renderHelpTopicText("format")).toContain("Command output shapes:");
    expect(renderHelpTopicText("format")).toContain(
      "Use `--json` when an Agent or script needs one stable machine-readable response.",
    );
    expect(renderHelpTopicText("format")).toContain(
      "Whole `source` and `summary` objects print plain text by default; with `--json`, both return `uri` and `text`",
    );
    expect(renderHelpTopicText("format")).toContain(
      "Ranged fragments such as `/source#20..30` and `/summary#20..30` use the same output choices and retain the requested range in `uri`.",
    );
    expect(renderHelpTopicText("format")).toContain(
      "JSONL may contain both object records and control records.",
    );
    expect(renderHelpTopicText("format")).toContain("--all --jsonl");
    expect(() => parseCLIArguments(["help", "ai"])).toThrow(
      "Invalid help topic: ai.",
    );
    expect(renderHelpTopicText("recipe")).toContain("Operating rules:");
    expect(renderHelpTopicText("recipe")).toContain(
      "Never unzip a `.wikg` archive",
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "Use Wiki Graph URIs as stable object handles",
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "Never pass a bare filesystem path to URI-targeted commands.",
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "/Users/me/book.wikg -> wikg:///Users/me/book.wikg",
    );
    expect(renderHelpTopicText("recipe")).toContain(
      'wg wikg://book.wikg/entity --query "attention" --evidence 2',
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "wikg:///absolute/path/book.wikg/entity/Q8018",
    );
    expect(uriHelpText).toContain(
      "Do not pass a bare filesystem path as a command target.",
    );
    expect(uriHelpText).toContain('wg <archive-uri> --query "term"');
    expect(uriHelpText).toContain("--skip-unindexed");
    expect(uriHelpText).toContain("--query-mode hybrid|fts|embedding");
    expect(uriHelpText).toContain(
      String.raw`C:\Users\me\book.wikg -> wikg://C:/Users/me/book.wikg`,
    );
    expect(uriHelpText).toContain("Document Flow order:");
    expect(uriHelpText).toContain(
      "`--reverse` cannot be combined with `--query`",
    );
    expect(uriHelpText).toContain(
      "wg <archive-uri>/entity/<qid> evidence --reverse --limit 1",
    );
    expect(
      renderUriPredicateHelpText(
        "entity-object",
        "evidence",
        "wikg://book.wikg/entity/Q8018",
      ),
    ).toContain("wg help uri");
    expect(
      renderUriPredicateHelpText(
        "entity-object",
        "related",
        "wikg://book.wikg/entity/Q8018",
      ),
    ).toContain("`--reverse` reads Document Flow order backward");
    expect(
      renderUriHelpText("entity-object", "wikg://book.wikg/entity/Q8018"),
    ).toContain("supports `--reverse` without `--query`");
    expect(renderUriHelpText("entity-scope", "wikg://lib/entity")).toContain(
      "Library context:",
    );
    expect(
      renderUriHelpText("entity-scope", "wikg://book.wikg/chapter/part/entity"),
    ).toContain(
      "This chapter-qualified scope covers the selected chapter subtree",
    );
    expect(
      renderUriHelpText(
        "entity-scope",
        "wikg:///library/chapter/book.wikg/entity",
      ),
    ).not.toContain(
      "This chapter-qualified scope covers the selected chapter subtree",
    );
    expect(
      renderUriHelpText("index-object", "wikg://book.wikg/index"),
    ).toContain("reads index cache status and capabilities");
    expect(
      renderUriPredicateHelpText("index-object", "sync", "wikg://lib/index"),
    ).toContain("Sync this library index cache");
    expect(
      renderUriPredicateHelpText(
        "index-object",
        "sync",
        "wikg://book.wikg/index",
      ),
    ).toContain("[--skip-unindexed]");
    expect(
      renderUriPredicateHelpText("index-object", "sync", "wikg://lib/index"),
    ).not.toContain(
      "Use `embed` when the index should travel with the archive",
    );
    expect(
      renderUriPredicateHelpText(
        "index-object",
        "clean",
        "wikg://book.wikg/index",
      ),
    ).toContain("Delete this index cache");
    expect(
      renderUriHelpText("local-config-namespace", "wikg://local/config"),
    ).toContain("Local config namespace");
    expect(
      renderUriPredicateHelpText(
        "entity-object",
        "evidence",
        "wikg://lib/entity/Q8018",
      ),
    ).toContain("aggregate library index");
    expect(
      renderUriHelpText("entity-object", "wikg://lib/entity/Q8018"),
    ).toContain("aggregate views over matching entities");
    expect(
      renderUriHelpText("job-collection-scope", "wikg://local/job"),
    ).toContain("generation jobs can consume model/runtime cost");
    expect(
      renderUriHelpText("job-collection-scope", "wikg://local/job"),
    ).toContain("Job list does not support `--jsonl`");
    expect(
      renderUriHelpText(
        "chapter-summary-object",
        "wikg://book.wikg/chapter/part/summary",
      ),
    ).toContain("does not guarantee the prose answers every question");
    expect(
      renderUriPredicateHelpText(
        "job-collection-scope",
        "clean",
        "wikg://local/job",
      ),
    ).toContain("succeeded, failed, and canceled jobs");
    expect(
      renderUriPredicateHelpText(
        "local-config-section",
        "test",
        "wikg://local/config/concurrent",
      ),
    ).toContain("Validate this local concurrency config section");
    expect(renderUriHelpText("triple-scope", "wikg://lib/triple")).toContain(
      "Library-wide scopes such as `wikg://lib/triple`",
    );
    expect(
      renderUriPredicateHelpText(
        "triple-object",
        "evidence",
        "wikg://lib/triple/Q8018/discusses/Q123",
      ),
    ).toContain("wikg://lib/arc/<archive-id>/triple/Q8018/discusses/Q123");
    expect(renderHelpTopicText("format")).toContain(
      "Avoid `--all | head` as a preview pattern.",
    );
    expect(uriHelpText).toContain("Recovery hints:");
    expect(uriHelpText).toContain("No `--query` results:");
    expect(uriHelpText).toContain("Missing generated objects:");
    expect(renderHelpTopicText("recipe")).toContain(
      'wg wikg:///Users/me/book.wikg --query "attention memory"',
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "Choose your starting point:",
    );
    expect(renderHelpTopicText("recipe")).toContain("After inspect:");
    expect(renderHelpTopicText("recipe")).toContain("Finding material:");
    expect(renderHelpTopicText("recipe")).toContain(
      "defaults to hybrid FTS + embedding search",
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "Use `--query-mode fts` for strict keyword retrieval",
    );
    expect(renderHelpTopicText("recipe")).toContain("When to read deeper:");
    expect(renderHelpTopicText("recipe")).toContain("wg help readiness");
    expect(renderHelpTopicText("recipe")).toContain("wg help library");
    expect(renderHelpTopicText("recipe")).toContain(
      "User gave you a folder of `.wikg` archives:",
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "Read the chapter object and use Unix pipes or redirection.",
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "wg wikg://book.wikg/chapter/part/source > chapter-part-source.md",
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "wg wikg://book.wikg/chapter/part/source#23..45",
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "wg wikg://book.wikg/chapter/part/summary#23..45",
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "wg wikg://book.wikg/entity/Q8018 evidence --reverse --limit 1",
    );
    expect(renderHelpTopicText("recipe")).toContain(
      'wg wikg://book.wikg/triple --query "attention memory" --evidence 2',
    );
    expect(renderHelpTopicText("recipe")).toContain(
      'wg wikg://book.wikg/chunk --query "attention memory" --evidence 2',
    );
    expect(renderHelpTopicText("recipe")).toContain(
      'wg wikg://book.wikg/entity/Q8018 related --query "memory"',
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "wg wikg://book.wikg/entity/Q8018 pack --budget 5000",
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "Use `--json` when you want stable Agent-readable fields",
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "Whole and ranged `source` and `summary` reads return `uri` and `text`",
    );
    expect(uriHelpText).toContain(
      "Ranged fragments such as `/source#4..8` and `/summary#4..8` are structured range objects.",
    );
    expect(
      renderUriHelpText(
        "chapter-source-object",
        "wikg://book.wikg/chapter/part/source",
      ),
    ).toContain(
      "Whole and ranged source reads print text by default. With `--json`, they return one object containing `uri` and `text`.",
    );
    expect(
      renderUriHelpText(
        "chapter-summary-object",
        "wikg://book.wikg/chapter/part/summary",
      ),
    ).toContain(
      "Whole and ranged summary reads print text by default. With `--json`, they return one object containing `uri` and `text`.",
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "wg wikg://book.wikg/chapter/part/entity --all --jsonl",
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "If Reading Graph data is missing",
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "If Knowledge Graph data is missing",
    );
    expect(uriHelpText).toContain("Command routing:");
    expect(uriHelpText).toContain("wg <archive-uri> create");
    expect(uriHelpText).toContain("wg <archive-uri> export");
    expect(uriHelpText).toContain("wg transform");
    expect(uriHelpText).not.toContain("wg ls");
    expect(renderHelpTopicText("config")).toContain("wikg://local/config/llm");
    expect(renderHelpTopicText("config")).toContain(
      "wikg://local/config/embeddings",
    );
    expect(renderHelpTopicText("config")).toContain(
      "wikg://local/config/concurrent",
    );
    expect(renderHelpTopicText("config")).toContain("One-run overrides");
    expect(renderHelpTopicText("config")).toContain("baseUrl");
    expect(renderHelpTopicText("config")).toContain(
      "job-local LLM object is stored with the job",
    );
    expect(
      renderUriPredicateHelpText(
        "job-collection-scope",
        "add",
        "wikg://local/job",
      ),
    ).toContain("does not update `wikg://local/config/llm`");
    expect(
      renderUriPredicateHelpText(
        "job-collection-scope",
        "add",
        "wikg://local/job",
      ),
    ).toContain("index-fts|index-embedding-source|index-embedding-summary");
    expect(
      renderUriPredicateHelpText(
        "job-collection-scope",
        "add",
        "wikg://local/job",
      ),
    ).toContain("wikg://local/config/embeddings");
    expect(
      renderUriPredicateHelpText(
        "job-collection-scope",
        "add",
        "wikg://local/job",
      ),
    ).toContain("require a current FTS artifact");
    expect(
      renderUriPredicateHelpText(
        "job-collection-scope",
        "add",
        "wikg://local/job",
      ),
    ).toContain("re-run archive `inspect` to verify coverage");
    expect(renderHelpTopicText("readiness")).toContain(
      "wikg://local/job add --input <archive-uri|chapter-uri> --task index-fts",
    );
    expect(renderHelpTopicText("runtime")).toContain("Local state map:");
    expect(renderHelpTopicText("runtime")).toContain(
      "~/.wikigraph/cache/continuation-cursors.sqlite",
    );
    expect(renderGcCommandHelpText()).toContain(
      "expired continuation cursor state under `~/.wikigraph/cache`",
    );
    expect(
      renderArchiveMaintenanceChapterActionHelpText("set-summary"),
    ).toContain("The chapter must be `reading-graph`");
    expect(renderArchiveMaintenanceChapterActionHelpText("add")).toContain(
      "[--json]",
    );
    expect(renderArchiveMaintenanceChapterActionHelpText("add")).toContain(
      "`uri` and `locatedUri`",
    );
    expect(
      renderArchiveMaintenanceChapterActionHelpText("set-source"),
    ).toContain("[--json]");
    expect(renderArchiveMaintenanceCommandHelpText("cover")).toContain(
      "refuses to write binary data to an interactive terminal",
    );
    expect(renderArchiveMaintenanceCommandHelpText("cover")).toContain(
      "[--help|-h]",
    );
    expect(renderArchiveMaintenanceCommandHelpText("meta")).toContain(
      "<object-uri>/meta put <key>",
    );
    expect(renderArchiveMaintenanceCommandHelpText("meta")).toContain(
      "<object-uri>/meta put <key> <value> [--json]",
    );
    expect(
      renderUriPredicateHelpText(
        "metadata-object",
        "clear",
        "wikg://book.wikg/meta",
      ),
    ).toContain("wikg://book.wikg/meta clear [--json]");
    expect(
      renderUriPredicateHelpText(
        "local-config-section",
        "put",
        "wikg://local/config/concurrent",
      ),
    ).toContain("wg wikg://local/config/concurrent put <key> <value> [--json]");
    expect(
      renderUriPredicateHelpText(
        "local-config-section",
        "test",
        "wikg://local/config/embeddings",
      ),
    ).toContain("reports the returned vector dimensions");
  });

  it("renders library help through templates", () => {
    const scopeHelpText = renderLibraryUriHelpText("wikg://lib", {
      isDefault: true,
      kind: "scope",
    });
    const scopeTrailingSlashHelp = renderLibraryUriHelpText("wikg://lib/", {
      isDefault: true,
      kind: "scope",
    });
    const metadataHelpText = renderLibraryUriHelpText("wikg://lib/meta", {
      isDefault: true,
      kind: "metadata",
    });
    const createHelpText = renderLibraryPredicateHelpText(
      "wikg://lib/registry",
      { isDefault: true, kind: "registry" },
      "add",
    );

    expect(scopeHelpText).toContain("Library scope");
    expect(scopeHelpText).toContain(
      "wg wikg://lib/registry add --path <folder>",
    );
    expect(scopeHelpText).toContain("wg wikg://lib/arc scan [--json|--jsonl]");
    expect(scopeHelpText).toContain("wg wikg://lib/index [--json]");
    expect(scopeHelpText).toContain("wikg://lib/<lib-id>");
    expect(scopeHelpText).not.toContain(
      "future `wikg://lib/arc/<archive-id>/`",
    );
    expect(scopeHelpText).toContain(
      "Use `wg wikg://lib/registry` to list all library registries.",
    );
    expect(scopeHelpText).toContain("reads the library-wide scope collection");
    expect(scopeHelpText).not.toContain("lists archive members");
    expect(scopeHelpText).not.toContain("List archive memberships");
    expect(scopeTrailingSlashHelp).not.toContain("wikg://lib//");
    expect(scopeTrailingSlashHelp).not.toContain("List archive memberships");
    expect(parseCLIArguments(["wikg://lib/", "--help"])).toStrictEqual({
      help: true,
      helpText: scopeTrailingSlashHelp,
      kind: "help",
    });
    expect(() => parseCLIArguments(["wikg://lib", "list", "--help"])).toThrow(
      "does not support `list`",
    );
    expect(() =>
      parseCLIArguments(["wikg://lib/team", "list", "--help"]),
    ).toThrow("does not support `list`");
    expect(scopeHelpText).toContain("wg wikg://lib [--json]");
    expect(scopeHelpText).toContain("wg wikg://lib --query <query>");
    expect(scopeHelpText).toContain("--skip-unindexed");
    expect(scopeHelpText).toContain("searches library-wide objects");
    expect(scopeHelpText).not.toContain("searches archive members");
    expect(scopeHelpText).not.toContain("broad library index search");

    expect(
      parseCLIArguments(["wikg://lib", "--query", "attention", "--help"]),
    ).toStrictEqual({
      help: true,
      helpText: scopeHelpText,
      kind: "help",
    });
    expect(() => parseCLIArguments(["wikg://lib", "remove", "--help"])).toThrow(
      "default library cannot be removed",
    );
    expect(scopeHelpText).toContain("wg help library");
    expect(metadataHelpText).toContain("Library metadata object");
    expect(metadataHelpText).toContain("Metadata keys are free-form");
    expect(createHelpText).toContain("Library Predicate Command");
    expect(createHelpText).toContain("Create a non-default library registry");
    expect(createHelpText).toContain("wikg://lib/registry add --path <folder>");
    expect(
      renderLibraryPredicateHelpText(
        "wikg://lib/registry",
        { isDefault: true, kind: "registry" },
        "list",
      ),
    ).toContain("List all library registries");
    expect(
      renderLibraryPredicateHelpText(
        "wikg://lib/index",
        { isDefault: true, kind: "scope", objectUri: "wikg://index" },
        "sync",
      ),
    ).toContain("Sync holds the library write lock");
    expect(
      renderLibraryPredicateHelpText(
        "wikg://lib/index",
        { isDefault: true, kind: "scope", objectUri: "wikg://index" },
        "sync",
      ),
    ).toContain("wg help readiness");
    expect(
      renderLibraryUriHelpText("wikg://lib/index", {
        isDefault: true,
        kind: "scope",
        objectUri: "wikg://index",
      }),
    ).toContain("aggregate index");
    expect(renderHelpTopicText("library")).toContain("Library Management");
    expect(renderHelpTopicText("library")).toContain(
      "folder path binding, archive memberships",
    );
    expect(renderHelpTopicText("library")).toContain(
      "Library archive shortcuts:",
    );
    expect(renderHelpTopicText("library")).toContain(
      "wikg://lib/arc/<archive-id> inspect",
    );
    expect(renderHelpTopicText("library")).toContain(
      "not a library-level health report",
    );
    expect(renderHelpTopicText("library")).toContain(
      "Library index lifecycle:",
    );
    expect(renderHelpTopicText("library")).toContain("Registry discovery:");
    expect(renderHelpTopicText("library")).toContain("Concurrency:");
    expect(renderHelpTopicText("library")).toContain(
      "aggregate views over matching objects",
    );
    expect(renderHelpTopicText("library")).toContain(
      "wg wikg://lib/registry add --path <folder>",
    );
    expect(renderHelpTopicText("library")).toContain("wg wikg://lib/arc scan");
    expect(renderHelpTopicText("library")).toContain(
      "wg wikg://lib/arc --query <archive-title>",
    );
    expect(renderHelpTopicText("library")).toContain(
      "wg wikg://lib/path set <existing-directory>",
    );
    expect(renderHelpTopicText("library")).not.toContain(".lib");
    expect(renderHelpTopicText("library")).not.toContain(
      "wg wikg://lib create",
    );
    expect(renderHelpTopicText("library")).not.toContain("wg wikg://lib add");
    expect(renderHelpTopicText("library")).not.toContain("wg wikg://lib scan");
    expect(renderHelpTopicText("library")).not.toContain(
      "wg wikg://lib rebind",
    );
    expect(renderHelpTopicText("library")).not.toContain("move --to");
    expect(renderHelpTopicText("library")).not.toContain(
      "wikg://lib/<archive-id>/",
    );
    expect(
      renderLibraryPredicateHelpText(
        "wikg://lib/meta",
        { isDefault: true, kind: "metadata" },
        "get",
      ),
    ).toContain("Read this library metadata map");
    const archiveMemberHelp = parseCLIArguments([
      "wikg://lib/arc/archive123",
      "--help",
    ]);
    const archiveMemberInspectHelp = parseCLIArguments([
      "wikg://lib/arc/archive123",
      "inspect",
      "--help",
    ]);
    expect(archiveMemberHelp).toMatchObject({ help: true, kind: "help" });
    expect(archiveMemberInspectHelp).toMatchObject({
      help: true,
      kind: "help",
    });
    if (!archiveMemberHelp.help || !archiveMemberInspectHelp.help) {
      throw new Error("Expected library archive help output.");
    }
    expect(archiveMemberHelp.helpText).toContain(
      "reads the archive member page for this managed archive",
    );
    expect(archiveMemberHelp.helpText).toContain(
      "Registry fields such as physical path, size, mtime, and mutation token are diagnostic metadata.",
    );
    expect(archiveMemberHelp.helpText).toContain("inspect [--json]");
    expect(archiveMemberHelp.helpText).toContain("not the library registry");
    const archiveCollectionHelp = renderLibraryUriHelpText("wikg://lib/arc", {
      isDefault: true,
      kind: "archive-collection",
    });
    expect(archiveCollectionHelp).toContain(
      "searches managed archive titles through the aggregate library index",
    );
    expect(archiveCollectionHelp).toContain(
      "--query-mode <hybrid|fts|embedding>",
    );
    expect(archiveCollectionHelp).toContain("--skip-unindexed");
    const archiveTitleHelp = renderUriHelpText(
      "archive-title-object",
      "wikg:///tmp/book.wikg/title",
    );
    expect(archiveTitleHelp).toContain("Archive title object");
    expect(archiveTitleHelp).toContain("reads the archive title");
    expect(archiveTitleHelp).toContain("set or clear it");
    expect(archiveMemberInspectHelp.helpText).toContain(
      "URI Predicate Command",
    );
    expect(archiveMemberInspectHelp.helpText).toContain(
      "wikg://lib/arc/archive123 inspect [--json]",
    );
    expect(archiveMemberInspectHelp.helpText).toContain(
      "not a library-level health report",
    );
    const relatedHelpText = renderUriPredicateHelpText(
      "entity-object",
      "related",
      "wikg://book.wikg/entity/Q23",
    );
    const evidenceHelpText = renderUriPredicateHelpText(
      "entity-object",
      "evidence",
      "wikg://book.wikg/entity/Q23",
    );
    expect(relatedHelpText).toContain("[--skip-unindexed]");
    expect(relatedHelpText).toContain(
      "Add `--skip-unindexed` only with `--query`",
    );
    expect(evidenceHelpText).toContain("[--skip-unindexed]");
    expect(evidenceHelpText).toContain(
      "Add `--skip-unindexed` only with `--query`",
    );
    const registryHelpText = renderLibraryUriHelpText("wikg://lib/registry", {
      isDefault: true,
      kind: "registry",
    });
    const pathHelpText = renderLibraryUriHelpText("wikg://lib/path", {
      isDefault: true,
      kind: "path",
    });
    const arcHelpText = renderLibraryUriHelpText("wikg://lib/arc", {
      isDefault: true,
      kind: "archive-collection",
    });
    const arcTrailingSlashHelp = renderLibraryUriHelpText("wikg://lib/arc/", {
      isDefault: true,
      kind: "archive-collection",
    });
    const arcTreeHelpText = renderLibraryUriHelpText("wikg://lib/arc/tree", {
      isDefault: true,
      kind: "archive-tree",
    });
    expect(registryHelpText).toContain("Predicate commands:");
    expect(registryHelpText).toContain("wikg://lib/registry add --help");
    expect(pathHelpText).toContain("wikg://lib/path set --help");
    expect(pathHelpText).toContain("binds the library folder path");
    expect(arcHelpText).toContain("wikg://lib/arc add --help");
    expect(arcHelpText).toContain("wikg://lib/arc scan --help");
    expect(arcHelpText).toContain("wikg://lib/arc/tree --help");
    expect(arcHelpText).not.toContain("lists archive members");
    expect(arcHelpText).toContain("use `/tree` for member file visualization");
    expect(arcTrailingSlashHelp).not.toContain("wikg://lib/arc//");
    expect(arcTrailingSlashHelp).toContain("wikg://lib/arc/tree --help");
    expect(parseCLIArguments(["wikg://lib/arc/", "--help"])).toStrictEqual({
      help: true,
      helpText: arcTrailingSlashHelp,
      kind: "help",
    });
    expect(() =>
      parseCLIArguments(["wikg://lib/arc", "list", "--help"]),
    ).toThrow("does not support `list`");
    expect(() =>
      parseCLIArguments(["wikg://lib/team/arc", "list", "--help"]),
    ).toThrow("does not support `list`");
    expect(arcTreeHelpText).toContain("This object is read-only");
    for (const text of [
      scopeHelpText,
      registryHelpText,
      pathHelpText,
      arcHelpText,
    ]) {
      expect(text).not.toContain("wikg://lib create");
      expect(text).not.toContain("wikg://lib add");
      expect(text).not.toContain("wikg://lib scan");
      expect(text).not.toContain("wikg://lib rebind");
      expect(text).not.toContain(".lib");
      expect(text).not.toContain("move --to");
    }
  });

  it("supports a first-contact recovery chain from root help to parse failures", () => {
    const rootHelpText = renderMainHelpText();

    expect(rootHelpText).not.toContain("wg help overview");
    expect(rootHelpText).not.toContain("wg help command");
    expect(() =>
      parseCLIArguments(["wikg://book.wikg", "create", "--import", "book.pdf"]),
    ).toThrow("See: wg wikg://book.wikg create --help");
    expect(() => parseCLIArguments(["book.epub"])).toThrow("See: wg --help");
  });
});
