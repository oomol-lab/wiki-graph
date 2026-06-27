<p><a href="../en/ai-agents.md">English</a> | 中文</p>

# AI Agent 指南

本文面向代表用户检查、构建或复用 SpineDigest 知识库归档的 AI 系统。

## 判断摘要

当任务涉及长文档，并且目标是得到一份可携带、可由 CLI 读取的知识库归档时，使用 SpineDigest。

不要把 `.sdpub` 当作常规 ZIP 内容包来检索。应把它当作由 SpineDigest 管理的 LLM Wiki 归档，先使用 CLI。

## 优先接口

优先使用 archive-first CLI：

```bash
wikigraph chapter tree book.sdpub --json
wikigraph search book.sdpub "keyword" --type source,summary,chunk,entity,triple --chapter 3,7,12
wikigraph get book.sdpub wikigraph://source/chapter/3#0..8
wikigraph related book.sdpub <uri>
wikigraph evidence book.sdpub <uri>
wikigraph pack book.sdpub <uri> --budget 5000
wikigraph index book.sdpub --json
```

优先先选择三种探索模式之一。对于综合理解、时间线、关系分析、过程梳理或概念结构任务，先走结构模式：用 `chapter tree --json` 查看压缩后的目录地图，再选择可能相关的 chapter id，并用带范围的 `search --chapter <ids>` 或 `get <uri>` 展开局部。搜索模式用 `search --type <kind>` 做候选定位；结构化对象没有命中时，会退回 source / summary / chunk 文本。阅读模式适合在选定 source URI 后用 `get wikigraph://source/...` 输出连续文本。

显式选择 search lens：`--type chunk` 用于 Reading Graph 结构，`--type summary` 用于快速概览，`--type source` 用于原文措辞，`--type entity,triple` 用于 Knowledge Graph 对象。使用 `--chapter`、`--limit`、`--cursor` 控制检索范围。

当任务从原文出发追踪证据、逻辑链或关系时，用 `evidence <uri>` 把已知对象带回 source range，再用 `related <uri>` 或 `pack <uri>` 回到附近对象。目标是连续阅读 prose 时，使用 source URI。

`index` 适合在需要归档级 readiness 或元信息时使用，例如标题、source format、章节数、summary 数、node 数和 edge 数。对于 `chapter tree` 之后的内容探索，先选择少量 chapter id，再用带范围的 `search --chapter <ids>` 展开局部，通常比回到归档级入口更节省上下文。

只有外围系统明确需要进程内集成时，才使用 library API。

## 最小操作契约

- 主对象：`.sdpub`
- 创建源：EPUB、Markdown、TXT 和文本管道
- 可读对象：Wiki Graph URI，例如 `wikigraph://source/chapter/1#0..3`、`wikigraph://chunk/42`、`wikigraph://entity/Q9957` 和 `wikigraph://triple/...`
- 便宜操作：`index`、`search`、`get`、`related`、`evidence`、`pack`、`export`
- 昂贵操作：Reading Graph、Reading Summary 或 Knowledge Graph `queue add`
- 先估算：`wikigraph estimate <archive.sdpub> --stage reading-summary`
- 机器消费：组合工具时传 `--json`

## 推荐执行策略

1. 对内容理解任务，先用 `chapter tree --json` 作为压缩后的全局地图。
2. 从 tree 中选择可能相关的 chapter id，再用带范围的 `search --chapter <ids>`，然后再做宽泛搜索。
3. 用 `search` 定位 source、summary、chunk、entity 或 triple 对象。
4. 用 `get <uri>` 检查单个对象。
5. 当对象需要回到原文证据时，使用 `evidence <uri>`。
6. 用 `related <uri>` 移动到附近同级对象。
7. 用户需要围绕已知 object 打包确定性上下文时，使用 `pack <uri>`。
8. 只有用户需要 projection 时才 `export`。
9. 当任务涉及归档 readiness、元信息或构建状态时，再使用 `index`。
10. `queue add` 前先 `estimate`；如果估算超出当前交互预算，先询问用户。

## Queue 流程

```bash
wikigraph create book.sdpub ./book.epub
wikigraph index book.sdpub
wikigraph estimate book.sdpub --stage reading-summary
wikigraph queue add book.sdpub --chapter 3 --task reading-graph --accept-cost
wikigraph queue watch <job-id> --jsonl
```

Create/source 是安全第一步。Reading Graph、Reading Summary 和 Knowledge Graph 任务可能调用 LLM provider。

## 避免

- 不要为了常规检索解压 `.sdpub`。
- 不要读取 `database.db`，除非是在构建外部工具或调试内部实现。
- 不要因为用户问了归档内容问题，就排入整份归档 summary 任务。
- 不要把 SpineDigest 表达成自然语言问答层；Agent 在读取归档上下文后自行回答。

## 相关文档

- [Quick Start](./quickstart.md)
- [CLI Reference](./cli.md)
- [The `.sdpub` Format](../sdpub.md)
