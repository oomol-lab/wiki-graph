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
spinedigest ls <archive.sdpub> [chapters|nodes|edges|evidence|summaries|meta] [--json]
spinedigest find <archive.sdpub> <query> [--json]
spinedigest grep <archive.sdpub> <query> [--json]
spinedigest page <archive.sdpub> <id> [--json]
spinedigest evidence <archive.sdpub> <id> [--json]
spinedigest links <archive.sdpub> <node:id> [--json]
spinedigest backlinks <archive.sdpub> <node:id> [--json]
spinedigest path <archive.sdpub> <node:id> <node:id> --chapter <id>
spinedigest map <archive.sdpub> [--json]
spinedigest export <archive.sdpub> --output-format <format> [--output <path>]
```

对象 ID：

- `chapter:<id>`
- `node:<id>`
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

低层 `.sdpub` 维护命令：

```bash
spinedigest sdpub <info|toc|list|cat|cover|meta> --input <path> [options]
spinedigest sdpub stage <pending|advance> <path> [options]
spinedigest sdpub chapter <list|status|add|remove|reset|set-source|set-summary> <path> [options]
spinedigest sdpub graph <status|log|show|grep|neighbors|blame|path> <path> --chapter <id> [options]
```

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
