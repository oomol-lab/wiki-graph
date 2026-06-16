<p><a href="../en/cli.md">English</a> | 中文</p>

# CLI Reference

SpineDigest 采用 archive-first CLI。主命令形态是：

```bash
spinedigest <action> <archive.sdpub> ...
```

## 归档命令

```bash
spinedigest import <archive.sdpub> [source] [--input-format <format>] [--llm <json>] [--prompt <text>] [--confirm]
spinedigest build <archive.sdpub> [--stage <source|graph|summary|ready>] [--chapter <id>] [--llm <json>] [--prompt <text>] [--confirm]
spinedigest estimate <archive.sdpub> [--stage <source|graph|summary|ready>] [--json]
spinedigest status <archive.sdpub> [--json]
spinedigest index <archive.sdpub> [--json]
spinedigest list <archive.sdpub> [--id <ids>] [--chapter <ids>] [--type <types>] [--order <doc-asc|doc-desc>] [--limit <n>] [--cursor <token>] [--json]
spinedigest find <archive.sdpub> <query> [--match <any|all>] [--chapter <ids>] [--type <types>] [--order <doc-asc|doc-desc>] [--limit <n>] [--cursor <token>] [--json]
spinedigest grep <archive.sdpub> <query> [--chapter <ids>] [--type <types>] [--order <doc-asc|doc-desc>] [--limit <n>] [--cursor <token>] [--json]
spinedigest page <archive.sdpub> <id> [--json]
spinedigest read <archive.sdpub> <id>
spinedigest evidence <archive.sdpub> <id> [--json]
spinedigest links <archive.sdpub> <node:id> [--json]
spinedigest backlinks <archive.sdpub> <node:id> [--json]
spinedigest path <archive.sdpub> <node:id> <node:id> --chapter <id>
spinedigest export <archive.sdpub> --output-format <format> [--output <path>]
```

探索模式：

- 搜索模式：`find` 用确定性关键词发现对象；`grep` 检查连续精确文本。
- 结构模式：`list` 返回有界对象集合；`page` 打开一个带局部导航的详情页。
- 阅读模式：`read` 将一个对象以连续纯文本输出。

搜索与集合行为：

- `find` 是确定性的关键词发现。它按空白拆分 query，默认 `--match any`，并优先返回命中更多关键词的对象。
- `find --match all` 是严格模式，要求同一个对象内包含全部关键词。
- `grep` 是精确文本搜索。它把 query 当作一个连续字符串。
- `--chapter 12` 或 `--chapter 11,12` 用于限定章节。
- `--type chapter,summary,node,fragment,sentence,meta` 用于限定 `list`；`find` 和 `grep` 搜索 `summary,node,fragment,sentence`。
- `--order doc-asc|doc-desc` 按稳定文档位置排序，默认 `doc-asc`。
- `--limit` 默认 `20`；下一页把返回的 `nextCursor` 传给 `--cursor`。
- 两个命令都不做语义扩展、模糊匹配、词干匹配或向量搜索。

对象 ID：

- `chapter:<id>`
- `node:<id>`
- `fragment:<serial>:<fragment>`
- `sentence:<serial>:<fragment>:<index>`
- `summary:<id>`
- `meta:book`

## 构建阶段

面向用户的阶段：

- `source`：已导入的规范化源数据
- `graph`：graph node、edge 和 evidence-backed knowledge unit
- `summary`：可读的章节 summary
- `ready`：完整 ready 归档投影

`source` 便宜。`graph`、`summary` 和 `ready` 可能调用 LLM provider。整份归档构建前先运行 `estimate`。

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
spinedigest find book.sdpub "RAG" --json
spinedigest page book.sdpub node:84 --json
spinedigest evidence book.sdpub node:84 --json
```

默认 stdout 是适合人和 Agent 阅读的 Markdown-like 文本，包含稳定 ID 和下一步命令提示。

## 直接压缩与维护命令

直接一次性 digest/export 命令仍然可用：

```bash
spinedigest transform [--input <path>] [--output <path>] [--input-format <format>] [--output-format <format>] [--digest-dir <path>] [--llm <json>] [--prompt <text>] [--confirm] [--stage <planned|sourced|graphed|summarized>] [--verbose]
```

归档维护命令以一级命令暴露：

```bash
spinedigest meta <archive.sdpub> [metadata options] [--json]
spinedigest cover <archive.sdpub>
spinedigest chapter <list|status|add|remove|reset|set-source|set-summary> <path> [options]
```

常规探索请使用 archive-first commands。维护命令用于 metadata 编辑、cover 提取和 chapter tree 编辑。

`spinedigest config status` 输出配置状态。`spinedigest status <archive.sdpub>` 输出归档状态。

## 标准流规则

archive-first `import` 命令用于写入 `.sdpub`。纯流式一次性 digest/export 使用 `spinedigest transform`：

```bash
cat ./chapter.txt | spinedigest transform --input-format txt --output-format markdown
```

## 相关文档

- [Quick Start](./quickstart.md)
- [AI Agent Guide](./ai-agents.md)
- [Library Usage](./library.md)
