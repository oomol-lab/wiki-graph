<p><a href="../en/cli.md">English</a> | 中文</p>

# CLI Reference

SpineDigest 采用 URI-first CLI。主对象是 `.sdpub` 知识库归档，CLI target 使用 Wiki Graph URI。

```bash
wikigraph <wkg-uri> <action> ...
wikigraph wkg-job://<job-id> <action> ...
```

## 归档命令

```bash
wikigraph <archive-uri> create [source] [--input-format <format>] [--llm <json>] [--prompt <text>]
wikigraph <archive-uri> estimate [--stage <source|reading-graph|reading-summary>] [--json]
wikigraph <archive-uri> status [--json]
wikigraph <archive-uri> index [--json]
wikigraph <wikigraph-uri-with-sdpub-locator> search <query> [--type <chapter|entity|triple|source|summary|chunk[,kind...]>] [--limit <n>] [--cursor <token>] [--json|--jsonl]
wikigraph <wikigraph-uri-with-sdpub-locator> list [--type <chapter|entity|triple|source|summary|chunk[,kind...]>] [--limit <n>] [--cursor <token>] [--json|--jsonl]
wikigraph <object-uri> get [--json|--jsonl]
wikigraph <object-uri> related [--evidence [n]] [--json|--jsonl]
wikigraph <entity|triple|summary|chunk-uri> evidence [--limit <n>] [--cursor <token>] [--json|--jsonl]
wikigraph <object-uri> pack [--budget <chars>] [--json|--jsonl]
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
- 结构模式：`<archive-uri>/chapter/tree get --json` 查看目录层级；`list` 从 archive 或 scoped URI 枚举对象集合。
- 阅读模式：`get` 打开选定 URI；`related`、`evidence` 和 `pack` 在选定对象后扩展或验证它。

搜索与集合行为：

- `search` 根据 query text 查找可 URI 寻址的对象。Search result 是线索，不等于 source evidence。
- `list` 在没有 query text 时枚举可 URI 寻址的对象。
- Object command 使用 Wiki Graph URI。`search` 和 `list` 使用 archive 或 scope URI，例如 `wkg:///Users/me/book.sdpub`；`get`、`related`、`evidence` 和 `pack` 使用具体 object URI，例如 `wkg:///Users/me/book.sdpub/chapter/12`。
- 做内容理解时，选择一个 search lens：`--type chunk` 用于 Reading Graph 结构，`--type summary` 用于快速概览，`--type source` 用于原文措辞，`--type entity,triple` 用于 Knowledge Graph 对象。
- 使用 chapter scope URI，例如 `wkg:///Users/me/book.sdpub/chapter/12`，把 search 或 list 限定在一个章节内。
- `--limit` 默认 `20`；下一页把返回的 `nextCursor` 传给 `--cursor`。
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

- `sdpub`
- `epub`
- `txt`
- `markdown`

扩展名映射：

- `.sdpub` -> `sdpub`
- `.epub` -> `epub`
- `.txt` -> `txt`
- `.md` 或 `.markdown` -> `markdown`

## JSON 契约

读取、搜索和导航命令支持 `--json`：

```bash
wikigraph wkg:///Users/me/book.sdpub search "RAG" --type chunk --json
wikigraph wkg:///Users/me/book.sdpub/chapter/3 get --json
```

默认 stdout 是适合人和 Agent 阅读的 Markdown-like 文本，包含稳定 ID 和下一步命令提示。

## 直接 Transform

`transform` 运行一次性的 direct digest/export，不创建可复用的 `.sdpub` 知识库归档：

```bash
wikigraph transform [--input <path>] [--output <path>] [--input-format <format>] [--output-format <format>] [--digest-dir <path>] [--llm <json>] [--prompt <text>] [--stage <planned|source|reading-graph|reading-summary>] [--verbose]
```

不存在裸 transform shortcut。需要显式使用 `wikigraph transform ...`。

## 维护命令

维护命令使用 URI target：

```bash
wikigraph <archive-root-uri> get|set [metadata options]
wikigraph <cover-uri> get
wikigraph <archive-uri>/chapter list|add [options]
wikigraph <chapter-uri> status|move|remove|reset [options]
wikigraph <chapter-uri>/source set [--input <path>] --input-format <format>
wikigraph <chapter-uri>/summary set [--input <path>]
wikigraph <chapter-uri>/title set (--title <title>|--clear)
wikigraph <archive-uri>/chapter/tree get|set [options]
```

常规探索请使用 URI-first commands。`<archive-uri>/chapter/tree get` 是只读结构检查，会输出稳定 JSON tree，未命名章节显示为 `title: null`。`<archive-uri>/chapter/tree set` 可以重排章节，并在节点包含 `title` 时修改标题。

`wikigraph config status` 输出配置状态。`wikigraph <archive-uri> status` 输出归档状态。

## 标准流规则

archive-first `create` 命令用于写入 `.sdpub`。传入 `--input-format` 时，它可以从 stdin 读取 Markdown 或纯文本：

```bash
cat ./chapter.txt | wikigraph wkg://chapter.sdpub create --input-format txt
```

直接流式 digest/export 需要显式使用 `transform`：

```bash
cat ./chapter.txt | wikigraph transform --input-format txt --output-format markdown
```

## 相关文档

- [Quick Start](./quickstart.md)
- [AI Agent Guide](./ai-agents.md)
- [Library Usage](./library.md)
