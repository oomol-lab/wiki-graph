<p><a href="../en/cli.md">English</a> | 中文</p>

# CLI Reference

SpineDigest 采用 URI-first CLI。主对象是 `.wikg` 知识库归档，CLI target 使用 Wiki Graph URI。

```bash
wikigraph <wkg-uri> <action> ...
wikigraph wkg-job://<job-id> <action> ...
```

## 归档命令

```bash
wikigraph <archive-uri> create [source] [--input-format <format>] [--llm <json>] [--prompt <text>]
wikigraph <archive-uri> estimate [--stage <source|reading-graph|reading-summary>] [--json]
wikigraph <located-wkg-uri> search <query> [--all] [--limit <n>] [--context <n>] [--cursor <token>] [--evidence [n]] [--backlinks] [--json|--jsonl]
wikigraph <located-wkg-uri>/<chapter|entity|triple|source|summary|chunk> search <query> [--all] [--limit <n>] [--context <n>] [--cursor <token>] [--evidence [n]] [--backlinks] [--json|--jsonl]
wikigraph <located-wkg-uri>/<chapter|entity|triple|source|summary|chunk> list [--all] [--limit <n>] [--context <n>] [--cursor <token>] [--evidence [n]] [--backlinks] [--json|--jsonl]
wikigraph <object-uri> get [--evidence [n]] [--context <n>] [--backlinks] [--json|--jsonl]
wikigraph <chunk-uri> related [query] [--all] [--limit <n>] [--context <n>] [--cursor <token>] [--evidence [n]] [--json|--jsonl]
wikigraph <entity-uri> related [query] [--all] [--limit <n>] [--context <n>] [--cursor <token>] [--role <any|subject|object|self>] [--evidence [n]] [--json|--jsonl]
wikigraph <entity-uri|triple-uri|summary-uri|chunk-uri> evidence [query] [--all] [--limit <n>] [--context <n>] [--cursor <token>] [--json|--jsonl]
wikigraph <located-chunk-uri|located-entity-uri> pack [--budget <chars>] [--json|--jsonl]
wikigraph <archive-uri> export --output-format <format> [--output <path>]
wikigraph <chapter-uri> queue add --task reading-graph|reading-summary|knowledge-graph --accept-cost [--boost] [--llm <json>] [--prompt <text>]
wikigraph wkg-job:// list [--all] [--active] [--input <archive-uri>] [--json]
wikigraph wkg-job://<job-id> get [--json]
wikigraph wkg-job://<job-id> watch [--jsonl] [--from beginning|now]
wikigraph wkg-job://<job-id> pause|resume|cancel|boost
wikigraph wkg-job://<job-id> set --task reading-graph|reading-summary|knowledge-graph
wikigraph queue clean
```

探索模式：

- 搜索模式：`search` 根据 query text 发现可 URI 寻址的对象。
- 结构模式：`<archive-uri>/chapter/tree get` 查看目录层级；`list` 从 archive 或 scoped URI 枚举对象集合。
- 阅读模式：`get` 打开选定 URI；`related`、`evidence` 和 `pack` 在选定对象后扩展或验证它。

搜索与集合行为：

- `search` 根据 query text 查找可 URI 寻址的对象。Search result 是线索，不等于 source evidence。
- `list` 在没有 query text 时枚举可 URI 寻址的对象。
- Object command 使用 Wiki Graph URI。`search` 和 `list` 使用 archive 或 scope URI，例如 `wkg:///Users/me/book.wikg`；`get`、`related`、`evidence` 和 `pack` 使用具体 object URI，例如 `wkg:///Users/me/book.wikg/chapter/12`。
- 做内容理解时，在 URI 中选择 search lens：`<archive-uri>/chunk` 用于 Reading Graph 结构，`<archive-uri>/summary` 用于快速概览，`<archive-uri>/source` 用于原文措辞，`<archive-uri>/entity` 和 `<archive-uri>/triple` 用于 Knowledge Graph 对象。
- Lens 位置决定 scope：用 `<archive-uri>/entity list` 枚举整本归档的 entity；只有需要单章 entity 时，才用 `<chapter-uri>/entity list`。
- 要找已知 entity 的原文提及或 grounding，先用 `<archive-uri>/entity/<qid> evidence`，再考虑按 label 做字面 source search。
- 要读取映射的 Wikipedia 页面，使用 `<archive-uri>/entity/<qid>/wikipage get`；不要根据 label 或 QID 推断 Wikipedia URL。
- 使用 chapter scope URI，例如 `wkg:///Users/me/book.wikg/chapter/12`，把 search 或 list 限定在一个章节内。
- Source search hit 和 evidence preview 默认在命中或引用范围前后各带 2 个句子。需要精确范围时用 `--context 0`；需要不同窗口时用 `--context <n>`。
- 直接读取 source，例如 `<chapter-uri>/source#23..25 get`，仍然保持精确范围。
- Scope、lens、分页和输出格式选择见 `wikigraph help retrieval`。
- Search 不做语义扩展、词干匹配或向量搜索。
- URI 语法和 object boundary 规则见 `wikigraph help uri`。

## 构建阶段

面向用户的阶段：

- `source`：已导入的规范化源数据
- `reading-graph`：面向阅读的 chunk、edge 和 source-backed knowledge unit
- `reading-summary`：可读的章节 summary
- `knowledge-graph`：grounded entity mention 和 source-backed relation

`source` 便宜。Reading Graph、Reading Summary 和 Knowledge Graph queue task 可能调用 LLM provider。先运行 `estimate`，再用 `queue add` 为需要生成的 chapter id 排队。

Queue 行为：

- `queue add` 要求 `--accept-cost`。
- `wkg-job:// list --json` 输出机器可读快照。
- `wkg-job://<job-id> watch --jsonl` 输出持久化进度事件，是推荐的 Agent-facing 事件流。

## 格式

支持格式：

- `wikg`
- `epub`
- `txt`
- `markdown`

扩展名映射：

- `.wikg` -> `wikg`
- `.epub` -> `epub`
- `.txt` -> `txt`
- `.md` 或 `.markdown` -> `markdown`

## 输出格式

读取、搜索和导航命令在 usage 标出 `--json` 或 `--jsonl` 时支持机器可读输出：

```bash
wikigraph wkg:///Users/me/book.wikg/chunk search "RAG"
wikigraph wkg:///Users/me/book.wikg/chapter/3 get
```

默认 stdout 是适合人和 Agent 阅读的 Markdown-like 文本，包含稳定 ID 和下一步命令提示。选择 `--json`、`--jsonl`、`--limit` 或 `--all` 前，先读 `wikigraph help retrieval`。

## 直接 Transform

`transform` 运行一次性的 direct digest/export，不创建可复用的 `.wikg` 知识库归档：

```bash
wikigraph transform [--input <path>] [--output <path>] [--input-format <format>] [--output-format <format>] [--digest-dir <path>] [--llm <json>] [--prompt <text>] [--stage <planned|source|reading-graph|reading-summary>] [--verbose]
```

不存在裸 transform shortcut。需要显式使用 `wikigraph transform ...`。

## 维护命令

维护命令使用 URI target：

```bash
wikigraph <archive-uri> get|set [metadata options]
wikigraph <cover-uri> get
wikigraph <archive-uri>/chapter list [--all] [--limit <n>] [--cursor <token>] [--json|--jsonl]
wikigraph <archive-uri>/chapter add [options]
wikigraph <chapter-uri>/state get [--json]
wikigraph <chapter-uri> move|remove|reset [options]
wikigraph <chapter-uri>/source set [--input <path>] --input-format <format>
wikigraph <chapter-uri>/summary set [--input <path>]
wikigraph <chapter-uri>/title set (--title <title>|--clear)
wikigraph <archive-uri>/chapter/tree get|set [options]
```

常规探索请使用 URI-first commands。`<archive-uri>/chapter/tree get` 是只读结构检查，会输出稳定 JSON tree，未命名章节显示为 `title: null`。`<archive-uri>/chapter/tree set` 可以重排章节，并在节点包含 `title` 时修改标题。

`wikigraph config status` 输出配置状态。

## 标准流规则

URI-first `create` 命令用于写入 `.wikg`。传入 `--input-format` 时，它可以从 stdin 读取 Markdown 或纯文本：

```bash
cat ./chapter.txt | wikigraph wkg://chapter.wikg create --input-format txt
```

直接流式 digest/export 需要显式使用 `transform`：

```bash
cat ./chapter.txt | wikigraph transform --input-format txt --output-format markdown
```

## 相关文档

- [Quick Start](./quickstart.md)
- [AI Agent Guide](./ai-agents.md)
- [Library Usage](./library.md)
