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
  renderUriHelpText,
  renderUriPredicateHelpText,
  renderTransformHelpText,
} from "./help.js";

describe("cli/args/help", () => {
  const wikispineRuntimeGuideUrl =
    "https://raw.githubusercontent.com/oomol-lab/wiki-graph/refs/heads/main/docs/wikispine-runtime.md";

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
        "wikg://lib/archive123/chapter",
      ),
    ).toContain("wikg://lib/<archive-id>/chapter/part");
    expect(
      renderUriPredicateHelpText(
        "chapter-title-object",
        "clear",
        "wikg://book.wikg/chapter/part/title",
      ),
    ).toContain("does not delete the chapter");
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
      "Invalid help topic: unknown. Expected one of format, config, runtime, uri, recipe, readiness, library.\nSee: wg --help",
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

  it("documents the layered help contract", () => {
    const rootHelpText = renderMainHelpText();
    const uriHelpText = renderHelpTopicText("uri");

    expect(rootHelpText).toContain("wg help [topic]");
    expect(rootHelpText).toContain("wg help recipe");
    expect(rootHelpText).toContain("wg help readiness");
    expect(rootHelpText).toContain("wg help library");
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
    expect(rootHelpText).toContain("retrieved efficiently with keywords");
    expect(rootHelpText).toContain("Scope: a URI target");
    expect(rootHelpText).toContain("Object: a URI target");
    expect(rootHelpText).toContain("Predicate: an operation bound to a URI");
    expect(rootHelpText).not.toContain("wg help task");
    expect(rootHelpText).toContain("wg help uri");
    expect(rootHelpText).toContain("wg <archive-uri> inspect");
    expect(rootHelpText).toContain("wg transform");
    expect(rootHelpText).toContain("wg wikg://lib --help");
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
      "Archive FTS readiness:",
    );
    expect(renderHelpTopicText("readiness")).toContain(
      "Library index readiness:",
    );
    expect(renderHelpTopicText("readiness")).toContain(
      "Without a current index",
    );
    expect(renderHelpTopicText("readiness")).toContain(
      "`wg <archive-uri>/index enable` enables the searchable index as local cache outside the `.wikg` archive",
    );
    expect(renderHelpTopicText("readiness")).toContain(
      "CLI archive writes keep it synchronized automatically",
    );
    expect(renderHelpTopicText("readiness")).toContain(
      "wg <archive-uri>/index enable --help",
    );
    expect(renderHelpTopicText("readiness")).toContain(
      "wg <archive-uri>/index embed --help",
    );
    expect(renderHelpTopicText("readiness")).toContain(
      "wg wikg://lib/index enable --help",
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
    expect(uriHelpText).toContain("wikg://lib/<archive-id>/");
    expect(uriHelpText).toContain("wg next <uri> <cursor>");
    expect(uriHelpText).toContain("wg help format");
    expect(uriHelpText).not.toContain("JSONL contains object records");
    expect(renderHelpTopicText("format")).toContain("Command output shapes:");
    expect(renderHelpTopicText("format")).toContain(
      "Use `--json` when an Agent or script needs one stable machine-readable response.",
    );
    expect(renderHelpTopicText("format")).toContain(
      "Whole `source` and `summary` text objects are plain text streams and do not support `--json`.",
    );
    expect(renderHelpTopicText("format")).toContain(
      "Ranged fragments such as `/source#20..30` and `/summary#20..30` are structured range objects and support `--json`.",
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
    ).toContain("status, readiness, storage policy, and materialization state");
    expect(
      renderUriPredicateHelpText("index-object", "enable", "wikg://lib/index"),
    ).toContain("Build or rebuild this library's aggregate search index");
    expect(
      renderUriPredicateHelpText("index-object", "enable", "wikg://lib/index"),
    ).not.toContain(
      "Use `embed` when the index should travel with the archive",
    );
    expect(
      renderUriPredicateHelpText(
        "index-object",
        "external",
        "wikg://book.wikg/index",
      ),
    ).toContain("does not guarantee a current local materialization");
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
    ).toContain("wikg://lib/<archive-id>/triple/Q8018/discusses/Q123");
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
      "indexed full-text retrieval",
    );
    expect(renderHelpTopicText("recipe")).toContain(
      "grep/find with Google-like keyword input",
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
      "ranged fragments such as `/source#20..30` support `--json`",
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
      "Whole source reads are plain text streams and do not support `--json`; source range fragments are structured range objects and support `--json`.",
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
  });

  it("renders library help through templates", () => {
    const scopeHelpText = renderLibraryUriHelpText("wikg://lib", {
      isDefault: true,
      kind: "scope",
    });
    const metadataHelpText = renderLibraryUriHelpText("wikg://lib/meta", {
      isDefault: true,
      kind: "metadata",
    });
    const createHelpText = renderLibraryPredicateHelpText(
      "wikg://lib",
      { isDefault: true, kind: "scope" },
      "create",
    );

    expect(scopeHelpText).toContain("Library scope");
    expect(scopeHelpText).toContain("wg wikg://lib create --path <folder>");
    expect(scopeHelpText).toContain("wg wikg://lib scan [--json]");
    expect(scopeHelpText).toContain("wg wikg://lib/index [--json]");
    expect(scopeHelpText).toContain(".lib` suffix");
    expect(scopeHelpText).not.toContain("future `wikg://lib/<archive-id>/`");
    expect(scopeHelpText).toContain(
      "This is not a list of all library registries.",
    );
    expect(scopeHelpText).toContain("broad library index search");
    expect(scopeHelpText).toContain("wg wikg://lib --query <query>");
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
    expect(createHelpText).toContain(
      "does not expose a list-all-library-registries command",
    );
    expect(
      renderLibraryPredicateHelpText(
        "wikg://lib",
        { isDefault: true, kind: "scope" },
        "list",
      ),
    ).toContain("not all library registries");
    expect(
      renderLibraryPredicateHelpText(
        "wikg://lib/index",
        { isDefault: true, kind: "scope", objectUri: "wikg://index" },
        "enable",
      ),
    ).toContain("Rebuild holds the library write lock");
    expect(
      renderLibraryPredicateHelpText(
        "wikg://lib/index",
        { isDefault: true, kind: "scope", objectUri: "wikg://index" },
        "enable",
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
      "Library archive shortcuts:",
    );
    expect(renderHelpTopicText("library")).toContain(
      "wikg://lib/<archive-id> inspect",
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
    expect(
      renderLibraryPredicateHelpText(
        "wikg://lib/meta",
        { isDefault: true, kind: "metadata" },
        "get",
      ),
    ).toContain("Read this library metadata map");
    const archiveMemberHelp = parseCLIArguments([
      "wikg://lib/archive123",
      "--help",
    ]);
    const archiveMemberInspectHelp = parseCLIArguments([
      "wikg://lib/archive123",
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
      "reads the registry entry for this library archive member",
    );
    expect(archiveMemberHelp.helpText).toContain("inspect [--json]");
    expect(archiveMemberHelp.helpText).toContain("not the library registry");
    expect(archiveMemberInspectHelp.helpText).toContain(
      "URI Predicate Command",
    );
    expect(archiveMemberInspectHelp.helpText).toContain(
      "wikg://lib/archive123 inspect [--json]",
    );
    expect(archiveMemberInspectHelp.helpText).toContain(
      "not a library-level health report",
    );
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
