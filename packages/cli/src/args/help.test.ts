import { describe, expect, it } from "vitest";
import { parseCLIArguments } from "./index.js";
import {
  renderArchiveMaintenanceChapterActionHelpText,
  renderArchiveMaintenanceCommandHelpText,
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
  });

  it("prints help topic pages", () => {
    expect(parseCLIArguments(["help", "runtime"])).toStrictEqual({
      help: true,
      helpText: renderHelpTopicText("runtime"),
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
      "Invalid help topic: unknown. Expected one of format, config, runtime, uri, recipe, readiness.\nSee: wg --help",
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
    expect(renderHelpTopicText("readiness")).toContain("FTS readiness:");
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
    expect(renderHelpTopicText("readiness")).toContain("LLM readiness:");
    expect(renderHelpTopicText("readiness")).toContain("WikiSpine readiness:");
    expect(renderHelpTopicText("readiness")).toContain("provider fetch");
    expect(renderHelpTopicText("readiness")).toContain(
      wikispineRuntimeGuideUrl,
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
    expect(metadataHelpText).toContain("Library metadata object");
    expect(metadataHelpText).toContain("Metadata keys are free-form");
    expect(createHelpText).toContain("Library Predicate Command");
    expect(createHelpText).toContain("Create a non-default library registry");
    expect(
      renderLibraryPredicateHelpText(
        "wikg://lib",
        { isDefault: true, kind: "scope" },
        "list",
      ),
    ).toContain("List archive memberships in this library scope");
    expect(
      renderLibraryUriHelpText("wikg://lib/index", {
        isDefault: true,
        kind: "scope",
        objectUri: "wikg://index",
      }),
    ).toContain("Library index object");
    expect(
      renderLibraryPredicateHelpText(
        "wikg://lib/meta",
        { isDefault: true, kind: "metadata" },
        "get",
      ),
    ).toContain("Read this library metadata map");
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
