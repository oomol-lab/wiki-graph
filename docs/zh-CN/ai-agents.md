<p><a href="../en/ai-agents.md">English</a> | 中文</p>

# AI Agent 指南

本文面向代表用户检查、构建或复用 SpineDigest 知识库归档的 AI 系统。

## 判断摘要

当任务涉及长文档，并且目标是得到一份可携带、可由 CLI 读取的知识库归档时，使用 SpineDigest。

不要把 `.sdpub` 当作常规 ZIP 内容包来检索。应把它当作由 SpineDigest 管理的 LLM Wiki 归档，先使用 CLI。

## 优先接口

归档状态使用 archive command，内容探索优先使用 URI-first object command：

```bash
wikigraph wkg://book.sdpub/chapter/tree get --json
wikigraph wkg://book.sdpub search "keyword" --type source,summary,chunk,entity,triple
wikigraph wkg://book.sdpub/chapter/3/source/0#0..8 get
wikigraph <uri> related
wikigraph <uri> evidence
wikigraph <uri> pack --budget 5000
wikigraph wkg://book.sdpub index --json
```

当 Agent 已经拿到 URI，但不确定它支持哪些操作时，使用 `wikigraph help object` 或 `wikigraph help object <object>`。当已经知道要执行的操作，但不确定它能作用于哪些对象时，使用 `wikigraph help verb <verb>`。`wikigraph help matrix` 提供完整 object/verb 交叉引用。

优先先选择三种探索模式之一。对于综合理解、时间线、关系分析、过程梳理或概念结构任务，先走结构模式：用 `wkg://.../chapter/tree get --json` 查看压缩后的目录地图，再选择可能相关的 chapter id，并用 scoped URI search 或 `wkg://... get` 展开局部。搜索模式用 `wkg://... search --type <kind>` 做候选定位；结构化对象没有命中时，会退回 source / summary / chunk 文本。阅读模式适合在选定 source URI 后用 `wkg://... get` 输出连续文本。
Search result 可能显示短 object URI，例如 `wkg://entity/Q9957`；把它继续传给 object command 前，需要补上 archive locator，例如 `wkg://book.sdpub/entity/Q9957`。

显式选择 search lens：`--type chunk` 用于 Reading Graph 结构，`--type summary` 用于快速概览，`--type source` 用于原文措辞，`--type entity,triple` 用于 Knowledge Graph 对象。使用 scoped chapter URI、`--limit`、`--cursor` 控制检索范围。

当任务从原文出发追踪证据、逻辑链或关系时，用 `wikigraph <uri> evidence` 把已知对象带回 source range，再用 `wikigraph <uri> related` 或 `wikigraph <uri> pack` 回到附近对象。目标是连续阅读 prose 时，使用 source URI。

`index` 适合在需要归档级 readiness 或元信息时使用，例如标题、source format、章节数、summary 数、node 数和 edge 数。对于 `chapter tree` 之后的内容探索，先选择少量 chapter id，再用 scoped chapter URI 展开局部，通常比回到归档级入口更节省上下文。

只有外围系统明确需要进程内集成时，才使用 library API。

## 最小操作契约

- 主对象：`.sdpub`
- 创建源：EPUB、Markdown、TXT 和文本管道
- 可读对象：Wiki Graph URI，例如 `wkg://source/chapter/1#0..3`、`wkg://chunk/42`、`wkg://entity/Q9957` 和 `wkg://triple/...`
- 便宜操作：`index`、`search`、`get`、`related`、`evidence`、`pack`、`export`
- 昂贵操作：Reading Graph、Reading Summary 或 Knowledge Graph `queue add`
- 先估算：`wikigraph <archive-uri> estimate --stage reading-summary`
- 机器消费：组合工具时传 `--json`

## 推荐执行策略

1. 对内容理解任务，先用 `<archive-uri>/chapter/tree get --json` 作为压缩后的全局地图。
2. 从 tree 中选择可能相关的 chapter id，先搜索 scoped chapter URI，然后再做宽泛搜索。
3. 用 `wikigraph <uri> search` 定位 source、summary、chunk、entity 或 triple 对象。
4. 用 `wikigraph <uri> get` 检查单个对象。
5. 当对象需要回到原文证据时，使用 `wikigraph <uri> evidence`。
6. 用 `wikigraph <uri> related` 移动到附近同级对象。
7. 用户需要围绕已知 object 打包确定性上下文时，使用 `wikigraph <uri> pack`。
8. 只有用户需要 projection 时才 `export`。
9. 当任务涉及归档 readiness、元信息或构建状态时，再使用 `index`。
10. `queue add` 前先 `estimate`；如果估算超出当前交互预算，先询问用户。

## Queue 流程

```bash
wikigraph wkg://book.sdpub create ./book.epub
wikigraph wkg://book.sdpub index
wikigraph wkg://book.sdpub estimate --stage reading-summary
wikigraph wkg://book.sdpub/chapter/3 queue add --task reading-graph --accept-cost
wikigraph wkg-job://<job-id> watch --jsonl
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
