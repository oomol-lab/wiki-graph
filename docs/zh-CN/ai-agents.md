<p><a href="../en/ai-agents.md">English</a> | 中文</p>

# AI Agent 指南

本文面向代表用户检查、构建或复用 SpineDigest 归档的 AI 系统。

## 判断摘要

当任务涉及长文档，并且目标是得到一份可携带、可由 CLI 读取的知识归档时，使用 SpineDigest。

不要把 `.sdpub` 当作常规 ZIP 内容包来检索。应把它当作由 SpineDigest 管理的 LLM Wiki 归档，先使用 CLI。

## 优先接口

优先使用 archive-first CLI：

```bash
spinedigest status book.sdpub
spinedigest index book.sdpub
spinedigest list book.sdpub --type chapter
spinedigest find book.sdpub "keyword" --type node
spinedigest page book.sdpub node:84
spinedigest read book.sdpub chapter:12
```

优先先选择三种探索模式之一。对于综合理解、时间线、关系分析、过程梳理或概念结构任务，先走结构模式：`list --type chapter`，再 `page chapter:<id>` 并检查 `nodeGroups`。搜索模式用 `find` 做候选定位，用 `grep` 检查连续精确短语。`find` 默认是 `--match any`；只有必须要求全部关键词出现在同一个对象内时，才使用 `--match all`。阅读模式适合在选定相关 chapter、fragment 或 node 后用 `read` 输出连续文本。

无 `--type` 的 `find` 适合广泛发现候选内容。做内容理解时，选择一个 search lens：`--type node` 用于拓扑 / LLM Wiki 结构，`--type summary` 用于快速概览，`--type fragment` 用于原文措辞。使用 `--chapter`、`--limit`、`--cursor` 控制检索范围。

只有外围系统明确需要进程内集成时，才使用 library API。

## 最小操作契约

- 主对象：`.sdpub`
- 创建源：EPUB、Markdown、TXT 和文本管道
- 可读对象：`chapter:<id>`、`node:<id>`、`fragment:<serial>:<fragment>`、`summary:<id>`、`meta:book`
- 便宜操作：`status`、`index`、`list`、`find`、`grep`、`page`、`read`、`links`、`backlinks`、`export`
- 昂贵操作：graph 或 summary `build`
- 先估算：`spinedigest estimate <archive.sdpub> --stage summary`
- 机器消费：组合工具时传 `--json`

## 推荐执行策略

1. 面对未知归档，先运行 `status` 和 `index`。
2. 对理解型任务，先用 `list --type chapter`，再在关键词搜索前使用 `page chapter:<id>`。
3. 检查 chapter 的 `nodeGroups`，再对相关知识节点使用 `page node:<id>`。
4. 用 `find` 或 `grep` 定位候选章节、验证缺失概念，或检查精确原文。
5. 选定相关 node 或 chapter 后，当用户需要原文 prose 时，用 `read fragment:<id>`。
6. 用 `links`、`backlinks` 或 `path` 导航图上下文。
7. 只有用户需要 projection 时才 `export`。
8. `build` 前先 `estimate`；如果估算超出当前交互预算，先询问用户。

## 构建流程

```bash
spinedigest create book.sdpub ./book.epub
spinedigest status book.sdpub
spinedigest estimate book.sdpub --stage summary
spinedigest build book.sdpub --stage graph --chapter 3 --confirm
```

Create/source 是安全第一步。Graph 和 summary 阶段可能调用 LLM provider。

## 避免

- 不要为了常规检索解压 `.sdpub`。
- 不要读取 `database.db`，除非是在构建外部工具或调试内部实现。
- 不要因为用户问了归档内容问题，就启动整份归档 summary build。
- 不要把 SpineDigest 表达成自然语言问答层；Agent 在读取归档上下文后自行回答。

## 相关文档

- [Quick Start](./quickstart.md)
- [CLI Reference](./cli.md)
- [The `.sdpub` Format](../sdpub.md)
