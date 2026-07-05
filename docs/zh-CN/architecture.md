<p><a href="../en/architecture.md">English</a> | 中文</p>

# Architecture

这份文档从系统层面解释 SpineDigest。它的优先级刻意低于 CLI 文档；如果你的目标是先把工具跑起来，请从 [Quick Start](./quickstart.md) 开始。

## 系统模型

SpineDigest 围绕一个主对象构建：`.wikg` 知识库归档。EPUB、Markdown、纯文本、直接 transform 输出，以及导出的 EPUB/Markdown 文件，都是围绕这份归档的输入或投影视图。

从高层看，SpineDigest 有四层：

1. Source layer：读取 EPUB、Markdown、纯文本或 stdin，并规范化成带来源的章节数据。
2. Knowledge layer：从 source fragment 构建 Reading Graph chunk 和 summary，并构建 Knowledge Graph entity mention、mention link 和 entity-level relation。
3. Retrieval layer：通过 `chapter list`、`chapter state`、`chapter tree`、`search`、`list`、`get`、`related`、`evidence`、`pack` 等 CLI primitive 暴露已有归档数据。
4. Projection layer：导出 Markdown、txt、EPUB、JSON 风格命令输出，或一次性的 `transform` 结果。

归档是持久对象。Projection 是有用的视图，但当你需要图链接、来源片段和可重复检索时，它们不能替代 `.wikg`。

## 主要模块

- `facade`：面向用户的顶层入口，覆盖归档创建、归档查看、图操作和导出
- `cli`：命令行装配、参数解析、help 路由和配置加载
- `source`：EPUB、Markdown 和纯文本读取器
- `document`：磁盘文档状态、归档 I/O、metadata、fragment 和 schema 归属
- `llm`：provider 配置、模型请求、请求缓存、请求日志、采样参数和 provider 错误归一化
- `guaranteed`：当 LLM 返回必须满足 schema 时使用的共享结构化输出重试流程
- `evidence-selection`：Reading Graph 和 Knowledge Graph 共用的 sentence evidence 定位模块
- `reader`：基于 LLM 的文本流信息提取
- `topology`：根据 reader 输出构建图结构
- `editor`：基于 topology 分组生成 summary / projection
- `wikimatch`：Knowledge Graph 的 surface screening、Wikidata/Wikipedia candidate enrichment 和 LLM grounding decision
- `wikilink`：Knowledge Graph mention-link windowing 和 relation discovery 支撑
- `wikipage`：Wikipedia page / QID 解析、缓存、规范化和请求限流
- `progress`：LLM-backed build 工作中的进度统计与事件回调
- `serial.ts`：负责粘合 source serial、reader 输出、topology 和 summary

## 构建阶段

面向用户的 stage 描述归档中已经构建了多少知识：

- `source`：已有规范化源数据和 metadata
- `reading-graph`：已有面向阅读的 chunk、link 和 source-backed knowledge unit
- `reading-summary`：已有可读章节 summary 和 export projection 所需数据
- `knowledge-graph`：已有 grounded entity mention 和 source-backed relation，可用于 URI 化搜索与证据追踪

`source` 便宜，不需要 LLM 访问。Reading Graph、Reading Summary 和 Knowledge Graph generation job 可能调用 LLM provider，整份归档构建前应先 inspect。

Knowledge Graph 构建以 source 为基础。它先从源文本筛选 mention candidate，把 mention grounding 到 QID，再让模型在 grounded mention ID 之间发现 relation。Relation evidence 通过共享的 evidence-selection 协议定位：模型返回 sentence ID 和简短原文 quote，程序用 quote 校正 sentence 漂移；因此 Reading Graph 和 Knowledge Graph 可以复用同一套证据定位逻辑，而不需要互相持有对方的业务对象。

## 为什么需要 `.wikg`

`.wikg` 的作用，是让长文档变成可复用的知识库，而不是一次性输出。

它保存：

- 从源材料派生出的章节结构
- 支持后续阅读和证据追溯的 source fragment
- 用于导航的 graph node 和 link
- summary 以及其他可读 projection 数据
- metadata 和 cover 信息

因此，同一份归档可以支持后续不同任务：结构浏览、精确原文检查、连续阅读、上下文打包、导出和外部渲染。

## 公开边界与内部边界

公开表面故意保持得很小：

- CLI
- `SpineDigestApp`
- `SpineDigest`

CLI 是当前最完整的知识库操作界面。Library API 更低层，也更直接地反映 digest session 内部结构。

除此以外的大多数模块都属于内部实现，可以更自由地演进。

## 设计倾向

SpineDigest 优先优化的是：

- CLI-first 的知识库使用方式
- 长篇阅读材料
- 可携带的 `.wikg` 归档
- 面向人和 Agent 的确定性检索 primitive
- 小而稳定的公开入口，以及更丰富的内部结构

它不以以下目标为优先：

- 原始源包的精确 round-tripping
- 内置自然语言问答层
- 把每个内部模块都变成公开 API
