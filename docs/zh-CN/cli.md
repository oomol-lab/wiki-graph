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
wikigraph list <archive.sdpub> --type <types> [--id <ids>] [--chapter <ids>] [--order <doc-asc|doc-desc>] [--limit <n>] [--cursor <token>] [--json]
wikigraph find <archive.sdpub> <query> --type <types> [--match <any|all>] [--chapter <ids>] [--order <doc-asc|doc-desc>] [--limit <n>] [--cursor <token>] [--json]
wikigraph grep <archive.sdpub> <query> --type <types> [--chapter <ids>] [--order <doc-asc|doc-desc>] [--limit <n>] [--cursor <token>] [--json]
wikigraph page <archive.sdpub> <selector> [--json]
wikigraph read <archive.sdpub> <selector>
wikigraph links <archive.sdpub> --node <id> [--json]
wikigraph backlinks <archive.sdpub> --node <id> [--json]
wikigraph related <archive.sdpub> --node <id> [--json]
wikigraph path <archive.sdpub> --from <id> --to <id> --chapter <id>
wikigraph map <archive.sdpub> [--json]
wikigraph pack <archive.sdpub> <selector> [--budget <chars>] [--json]
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

- 搜索模式：`find` 用确定性关键词发现对象；`grep` 检查连续精确文本。
- 结构模式：`chapter tree --json` 查看目录层级；`list` 查看章节和知识点集合；`page` 打开具体页面并暴露相关节点、来源片段和链接。
- 阅读模式：`read` 输出选定章节、知识点、summary、原文片段或 metadata object 的连续文本。

搜索与集合行为：

- `find` 是确定性的关键词发现。它按空白拆分 query，默认 `--match any`，并优先返回命中更多关键词的对象。
- `list`、`find` 和 `grep` 都要求显式 `--type`。做内容理解时，选择一个 search lens：`--type node` 用于拓扑 / LLM Wiki 结构，`--type summary` 用于快速概览，`--type fragment` 用于原文措辞。
- `find --match all` 是严格模式，要求同一个对象内包含全部关键词。
- `grep` 是精确文本搜索。它把 query 当作一个连续字符串。
- `--chapter 12` 或 `--chapter 11,12` 用于限定章节。
- `--type chapter,summary,node,fragment,meta` 用于限定 `list`；`find` 和 `grep` 接受 `--type summary,node,fragment` 作为 search lens。
- `--order doc-asc|doc-desc` 按稳定文档位置排序，默认 `doc-asc`。
- `--limit` 默认 `20`；下一页把返回的 `nextCursor` 传给 `--cursor`。
- 两个命令都不做语义扩展、模糊匹配、词干匹配或向量搜索。

对象 ID：

- `--chapter <id>`
- `--node <id>`
- `--fragment <chapter>:<fragment>`
- `--summary <id>`
- `--meta book`

## 构建阶段

面向用户的阶段：

- `source`：已导入的规范化源数据
- `reading-graph`：面向阅读的 chunk、edge 和 source-backed knowledge unit
- `reading-summary`：可读的章节 summary

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
wikigraph find book.sdpub "RAG" --type node --json
wikigraph page book.sdpub --chapter 3 --json
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
