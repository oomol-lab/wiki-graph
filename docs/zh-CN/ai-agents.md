<p><a href="../en/ai-agents.md">English</a> | 中文</p>

# AI Agent 指南

本文面向代表用户检查、构建或复用 SpineDigest 知识库归档的 AI 系统。

## 判断摘要

当任务涉及长文档，并且目标是得到一份可携带、可由 CLI 读取的知识库归档时，使用 SpineDigest。

不要把 `.wikg` 当作常规 ZIP 内容包来检索。应把它当作由 SpineDigest 管理的 LLM Wiki 归档，先使用 CLI。

## 优先接口

归档 metadata 使用 archive command，内容探索优先使用 URI-first object command：

```bash
wikigraph wikg://book.wikg/chapter/tree
wikigraph wikg://book.wikg/chunk --query "keyword"
wikigraph wikg://book.wikg/entity --query "keyword"
wikigraph wikg://book.wikg/chapter/3/source#0..8
wikigraph <uri> related
wikigraph <uri> evidence
wikigraph wikg://book.wikg/entity/Q9957 pack --budget 5000
wikigraph wikg://book.wikg/chapter
```

当 Agent 已经拿到 URI，但不确定它支持哪些操作时，使用 `wikigraph <uri> --help`。需要某个谓词的具体用法时，使用 `wikigraph <uri> <predicate> --help`；谓词不脱离 URI target 单独解释。

优先先选择三种探索模式之一。对于综合理解、时间线、关系分析、过程梳理或概念结构任务，先走结构模式：用 `wikg://.../chapter/tree` 查看压缩后的目录地图，再选择可能相关的 chapter id，并用 scoped URI 加 `--query` 或对象 URI 展开局部。搜索模式使用 scope URI，例如 `wikg://.../chunk --query <query>` 或 `wikg://.../entity --query <query>` 做候选定位。阅读模式适合在选定 source URI 后直接输出连续文本。
Search result 可能显示短 object URI，例如 `wikg://entity/Q9957`；把它继续传给 object command 前，需要补上 archive locator，例如 `wikg://book.wikg/entity/Q9957`。

在 URI 中显式选择 scope 或 object：`/chunk` 用于 Reading Graph 结构，`/entity` 和 `/triple` 用于 Knowledge Graph 对象；`/source` 和 `/summary` 是可读对象，默认读取内容。Lens 位置决定 scope：用 `<archive-uri>/entity` 枚举整本归档的 entity；只有需要单章 entity 时，才用 `<chapter-uri>/entity`。使用 `wikg://book.wikg/chapter/3/entity` 这类 scoped chapter lens URI 控制检索范围。

当用户要找已知 entity 提及、grounding 或支持它的原文时，从 entity URI 开始：`<archive-uri>/entity/<qid> evidence`。不要把按 entity label 做 source search 当成主路径；label 可能有别名、翻译、变体，grounded mention 也可能不匹配字面文本。source search 只作为次要的字面文本检查。

围绕已知 entity、chunk 或 triple 调查某个具体 aspect 时，可以先把 aspect 作为 `evidence` 的可选 query 传入。`related` query 只用于 chunk 和 entity URI。两条路径都会使用当前 FTS index 在保留当前 object anchor 的同时过滤并排序候选：

```bash
wikigraph <archive-uri>/entity/Q830077 evidence --query "objectivity"
wikigraph <archive-uri>/entity/Q830077 related --query "objectivity" --evidence 2
```

当 recall 或完整性比缩窄范围更重要时，直接使用 scope URI。选择分页和输出格式参数前，先读 `wikigraph help retrieval`。

Source search hit 和 evidence preview 默认带附近原文上下文。需要精确引用范围时用 `--context 0`；只需要小范围上下文时调整 `--context <n>`，不要直接切到整段 source 输出。

调查已知 entity 时，按这个顺序：`<entity-uri>`、`<entity-uri> evidence`、`<entity-uri> related --evidence <n>`，然后 `<entity-uri>/wikipage`。不要根据 label 或 Wikidata QID 推断 Wikipedia URL；用 `/entity/<qid>/wikipage` 读取 canonical mapped pages。只有 mapped wikipage 缺失或不足时，再使用外部 web search。

当任务从原文出发追踪证据、逻辑链或关系时，用 `wikigraph <uri> evidence` 把已知对象带回 source range，再用 `wikigraph <uri> related` 或 `wikigraph <graph-object-uri> pack` 回到附近图对象。目标是连续阅读 prose 时，使用 source URI。

需要章节 readiness 时，使用 `<archive-uri>/chapter`。有些章节是用来组织子章节的目录结构节点；不能只因为缺少生成产物就判断它异常。对于 `chapter tree` 之后的内容探索，先选择少量 chapter id，再用 scoped chapter URI 展开局部，通常比回到归档级入口更节省上下文。

只有外围系统明确需要进程内集成时，才使用 library API。

## 最小操作契约

- 主对象：`.wikg`
- 创建源：EPUB、Markdown、TXT 和文本管道
- 可读对象：Wiki Graph URI，例如 `wikg://chapter/1/source#0..3`、`wikg://chunk/42`、`wikg://entity/Q9957` 和 `wikg://triple/...`
- 便宜操作：`<archive-uri>/chapter`、`<chapter-uri>/state`、scope URI + `--query`、object URI、`related`、`evidence`、`pack`、`export`
- 昂贵操作：Reading Graph、Reading Summary 或 Knowledge Graph `wikg://local/job add`
- 先检查：`wikigraph <archive-uri> inspect`
- 检索策略：用 `wikigraph help retrieval` 判断 scope、lens、分页和输出格式

## 推荐执行策略

1. 对内容理解任务，先用 `<archive-uri>/chapter/tree` 作为压缩后的全局地图。
2. 从 tree 中选择可能相关的 chapter id，先搜索 scoped chapter URI，然后再做宽泛搜索。
3. 用 `wikigraph <scope-uri> --query <query>` 定位 chunk、entity 或 triple 对象。
4. 用 `wikigraph <object-uri>` 检查单个对象。
5. 已知 entity 需要回到原文证据时，使用 `<archive-uri>/entity/<qid> evidence`。
6. 用 `wikigraph <uri> related` 移动到附近同级对象。
7. 调查已知 entity 时，先使用 `<archive-uri>/entity/<qid>/wikipage`，再考虑外部 web search。
8. 用户需要围绕已知 chunk 或 entity 打包确定性上下文时，使用 `wikigraph <graph-object-uri> pack`。
9. 只有用户需要 projection 时才 `export`。
10. 当任务涉及章节 readiness 或构建状态时，使用 `<archive-uri>/chapter`。
11. `wikg://local/job add` 前先 `inspect`；如果规划成本超出当前交互预算，先询问用户。

## Generation Job 流程

```bash
wikigraph wikg://book.wikg create ./book.epub
wikigraph wikg://book.wikg/chapter
wikigraph wikg://book.wikg inspect
wikigraph wikg://local/job add --input wikg://book.wikg/chapter/3 --task reading-graph --accept-cost
wikigraph wikg://local/job/<job-id> watch --jsonl
```

Create/source 是安全第一步。Reading Graph、Reading Summary 和 Knowledge Graph 任务可能调用 LLM provider。

## 避免

- 不要为了常规检索解压 `.wikg`。
- 不要读取 `database.db`，除非是在构建外部工具或调试内部实现。
- 不要因为用户问了归档内容问题，就排入整份归档 summary 任务。
- 不要把 SpineDigest 表达成自然语言问答层；Agent 在读取归档上下文后自行回答。

## 相关文档

- [Quick Start](./quickstart.md)
- [CLI Reference](./cli.md)
- `.wikg` 格式规格
