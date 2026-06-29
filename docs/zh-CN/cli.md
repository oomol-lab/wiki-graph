<p><a href="../en/cli.md">English</a> | 中文</p>

# CLI Reference

SpineDigest 采用 archive-first CLI。主对象是 `.sdpub` 知识库归档，主命令形态是：

```bash
wikigraph <action> <archive.sdpub> ...
```

## 归档命令

```bash
wikigraph create <archive.sdpub> [source] [--input-format <format>] [--llm <json>] [--prompt <text>] [--confirm]
wikigraph estimate <archive.sdpub> [--stage <source|reading-graph|reading-summary>] [--json]
wikigraph status <archive.sdpub> [--json]
wikigraph index <archive.sdpub> [--json]
wikigraph search <archive-or-scope-uri> <query> [--type <chapter|entity|triple|source|summary|chunk[,kind...]>] [--limit <n>] [--cursor <token>] [--json|--jsonl]
wikigraph list <archive-or-scope-uri> [--type <chapter|entity|triple|source|summary|chunk[,kind...]>] [--limit <n>] [--cursor <token>] [--json|--jsonl]
wikigraph get <object-uri> [--json|--jsonl]
wikigraph related <object-uri> [--json|--jsonl]
wikigraph evidence <object-uri> [--limit <n>] [--cursor <token>] [--json|--jsonl]
wikigraph pack <object-uri> [--budget <chars>] [--json|--jsonl]
wikigraph export <archive.sdpub> --output-format <format> [--output <path>]
wikigraph queue add <archive.sdpub> --chapter <id> [--task reading-graph|reading-summary|knowledge-graph] --accept-cost [--boost] [--llm <json>] [--prompt <text>]
wikigraph queue list [--all] [--active] [--input <archive.sdpub>] [--json]
wikigraph queue status <job-id> [--json]
wikigraph queue watch <job-id> [--jsonl] [--from beginning|now]
wikigraph queue pause|resume|cancel|boost <job-id>
wikigraph queue target <job-id> --task reading-graph|reading-summary|knowledge-graph
wikigraph queue clean
```

探索模式：

- 搜索模式：`search` 根据 query text 发现可 URI 寻址的对象。
- 结构模式：`chapter tree --json` 查看目录层级；`list` 从 archive 或 scoped URI 枚举对象集合。
- 阅读模式：`get` 打开选定 URI；`related`、`evidence` 和 `pack` 在选定对象后扩展或验证它。

搜索与集合行为：

- `search` 根据 query text 查找可 URI 寻址的对象。Search result 是线索，不等于 source evidence。
- `list` 在没有 query text 时枚举可 URI 寻址的对象。
- Object command 使用 Wiki Graph URI。使用 `search`、`list`、`get`、`related`、`evidence` 或 `pack` 前，先把 archive path 转为 archive URI，例如 `wikigraph:///Users/me/book.sdpub`。
- 做内容理解时，选择一个 search lens：`--type chunk` 用于 Reading Graph 结构，`--type summary` 用于快速概览，`--type source` 用于原文措辞，`--type entity,triple` 用于 Knowledge Graph 对象。
- 使用 chapter scope URI，例如 `wikigraph:///Users/me/book.sdpub/chapter/12`，把 search 或 list 限定在一个章节内。
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
- `queue list --json` 输出机器可读快照。
- `queue watch --jsonl` 输出持久化进度事件，是推荐的 Agent-facing 事件流。

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
wikigraph search wikigraph:///Users/me/book.sdpub "RAG" --type chunk --json
wikigraph get wikigraph:///Users/me/book.sdpub/chapter/3 --json
```

默认 stdout 是适合人和 Agent 阅读的 Markdown-like 文本，包含稳定 ID 和下一步命令提示。

## 直接 Transform

`transform` 运行一次性的 direct digest/export，不创建可复用的 `.sdpub` 知识库归档：

```bash
wikigraph transform [--input <path>] [--output <path>] [--input-format <format>] [--output-format <format>] [--digest-dir <path>] [--llm <json>] [--prompt <text>] [--stage <planned|source|reading-graph|reading-summary>] [--verbose]
```

不存在裸 transform shortcut。需要显式使用 `wikigraph transform ...`。

## 维护命令

归档维护命令以一级命令暴露：

```bash
wikigraph meta <archive.sdpub> [metadata options] [--json]
wikigraph cover <archive.sdpub>
wikigraph chapter <list|status|add|move|remove|reset|set-source|set-summary|set-title|tree> <path> [options]
```

常规探索请使用 archive-first commands。无 `apply` 的 `chapter tree` 是只读结构检查，会输出稳定 JSON tree，未命名章节显示为 `title: null`。维护命令用于 metadata 编辑、cover 提取和会修改 chapter tree 的编辑；`chapter tree apply` 可以重排章节，并在节点包含 `title` 时修改标题。

`wikigraph config status` 输出配置状态。`wikigraph status <archive.sdpub>` 输出归档状态。

## 标准流规则

archive-first `create` 命令用于写入 `.sdpub`。传入 `--input-format` 时，它可以从 stdin 读取 Markdown 或纯文本：

```bash
cat ./chapter.txt | wikigraph create ./chapter.sdpub --input-format txt
```

直接流式 digest/export 需要显式使用 `transform`：

```bash
cat ./chapter.txt | wikigraph transform --input-format txt --output-format markdown
```

## 相关文档

- [Quick Start](./quickstart.md)
- [AI Agent Guide](./ai-agents.md)
- [Library Usage](./library.md)
