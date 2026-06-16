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
spinedigest find book.sdpub "keyword"
spinedigest page book.sdpub node:84
spinedigest evidence book.sdpub node:84
```

多关键词发现优先用 `find`。它按空白拆分，并要求所有关键词出现在同一个返回对象中。检查连续精确短语时再用 `grep`。概念发现可加 `--type summary,node`，追原文可加 `--type fragment,sentence`，并用 `--chapter`、`--limit`、`--cursor` 控制检索范围。

只有外围系统明确需要进程内集成时，才使用 library API。

## 最小操作契约

- 主对象：`.sdpub`
- 导入源：EPUB、Markdown、TXT 和文本管道
- 可读对象：`chapter:<id>`、`node:<id>`、`sentence:<serial>:<fragment>:<index>`、`summary:<id>`、`meta:book`
- 便宜操作：`status`、`index`、`ls`、`find`、`page`、`evidence`、`links`、`backlinks`、`map`、`export`
- 昂贵操作：graph、summary 或 ready `build`
- 先估算：`spinedigest estimate <archive.sdpub> --stage ready`
- 机器消费：组合工具时传 `--json`

## 推荐执行策略

1. 面对未知归档，先运行 `status` 和 `index`。
2. 用 `find` 或 `ls` 发现稳定对象 ID。
3. 用 `page` 阅读单个对象。
4. 引用或形成有来源支撑的判断前，先用 `evidence`。
5. 用 `links`、`backlinks`、`path` 或 `map` 导航图上下文。
6. 只有用户需要 projection 时才 `export`。
7. `build` 前先 `estimate`；如果估算超出当前交互预算，先询问用户。

## 构建流程

```bash
spinedigest import book.sdpub ./book.epub
spinedigest status book.sdpub
spinedigest estimate book.sdpub --stage ready
spinedigest build book.sdpub --stage graph --chapter 3 --confirm
```

Import/source 是安全第一步。Graph 和 summary 阶段可能调用 LLM provider。

## 避免

- 不要为了常规检索解压 `.sdpub`。
- 不要读取 `database.db`，除非是在构建外部工具或调试内部实现。
- 不要因为用户问了归档内容问题，就启动整份归档 ready build。
- 不要把 SpineDigest 表达成自然语言问答层；Agent 在读取归档上下文后自行回答。

## 相关文档

- [Quick Start](./quickstart.md)
- [CLI Reference](./cli.md)
- [The `.sdpub` Format](../sdpub.md)
