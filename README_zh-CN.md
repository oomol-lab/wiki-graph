<div align="center">
  <h1>Wiki Graph</h1>
  <p><a href="./README.md">English</a> | 中文</p>
  <p>
    <a href="https://www.npmjs.com/package/wikigraph"><img alt="npm version" src="https://img.shields.io/npm/v/wikigraph"></a>
    <a href="https://opensource.org/licenses/Apache-2.0"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/License-Apache%202.0-blue.svg"></a>
    <a href="https://nodejs.org/"><img alt="Node >=22.12.0" src="https://img.shields.io/badge/node-%3E%3D22.12.0-brightgreen"></a>
  </p>
</div>

Wiki Graph 是一个面向 [Andrej Karpathy](https://github.com/karpathy) 的 [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 思路和 Google [OKF](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing) 方向构建的开源长文本知识库管理 CLI。

它将文本写入 `.wikg` 归档，并按需生成可检索、可追溯证据的 Knowledge Graph。这为 Karpathy 所说的 LLM Wiki 落地为可执行的知识生产流程，提供了一套可运行的 CLI。

在 Agent 场景中，PDF、网页、EPUB、字幕、会议录音、视频课程或内部文档都可以先由外部工具转成文本，再交给 Wiki Graph。Wiki Graph 负责的是后半段：把这些长文本落入知识库，抽取 Entity 和 Triple，并保留能追到章节与原句的证据线索；需要压缩阅读时，也可以先生成阅读图谱，再基于它产出摘要。

Karpathy 的核心想法是：不要让 AI 每次提问都从原始材料重新检索，而是把知识编译成可持续维护的 Wiki。OKF 则把这类 Wiki 实践推向开放、可移植的知识格式。Wiki Graph 负责把这条链路中属于 OKF 的 source layer 这部分做实：把长文本变成 Wiki 和 OKF 可以继续消费的知识原料，包括实体、关系，以及能追回原文的证据。

## 快速开始

运行前提 Node.js `>=22.12.0`

安装：

```bash
$ npm install -g wikigraph
```

创建一份空的 `.wikg` 知识库：

```bash
$ wikigraph wikg://quickstart.wikg create
```

导入两个章节的文本：

```bash
$ printf "Alpha is connected to beta.\n" | wikigraph wikg://quickstart.wikg/chapter add --title "First note" --input -

$ printf "Beta mentions gamma.\n" > tmp.txt && wikigraph wikg://quickstart.wikg/chapter add --title "Second note" --input ./tmp.txt
```

查看章节树：

```bash
$ wikigraph wikg://quickstart.wikg/chapter/tree

├─ First note  wikg://chapter/1
└─ Second note  wikg://chapter/2
```

开启并构件 FTS 全文索引（开启后才可使用 `--query` 进行全文搜索）：

```bash
$ wikigraph wikg://quickstart.wikg/index enable
```

把内容搜出来：

```bash
$ wikigraph wikg://quickstart.wikg --query alpha

@@ wikg://chapter/1/source#1 @@
Alpha is connected to beta.
```

## 为什么需要 Wiki Graph

TODO：这一节最后写。

可以讨论的问题：

- 为什么长文本不应该只被压缩成摘要？
- 为什么知识库比一次性问答更适合反复使用？
- 为什么 Knowledge Graph 要保留 source evidence？
- 为什么 Reading Graph 和 Summary 是辅助层，而不是最终目标？
- 为什么 CLI 和 URI 对 AI Agent 特别重要？

## 核心概念

### `.wikg`

`.wikg` 是 Wiki Graph 管理的知识库归档。它可以保存源文本、章节结构、Knowledge Graph、Reading Graph、Summary、索引策略和元数据。

`.wikg` 是托管归档，不是让用户手工解压和编辑的文件格式。日常读取、检索、生成和维护都应通过 `wikigraph` CLI 完成。

### Knowledge Graph

Knowledge Graph 是 Wiki Graph 的主要生成结果。它从源文本中抽取实体、关系和证据，让长文本可以被查询、验证和复用。

典型问题包括：

- 文档里出现了哪些重要实体？
- 某个实体和哪些对象有关系？
- 某条关系由哪些原文支持？
- 哪些章节或段落支撑了同一个知识点？

### Entity、Triple 和 Evidence

Entity 是归一化后的知识对象，例如人物、组织、地点、概念或术语。

Triple 是一条实体级关系，形如：

```text
subject --predicate--> object
```

Evidence 是支持实体或关系的原文依据。Wiki Graph 的 Knowledge Graph 不是只给出结论，还要能回到 source text。

### Reading Graph 和 Summary

Reading Graph 与 Summary 是辅助能力。Reading Graph 用于保存阅读过程中的注意力结构，Summary 用于生成压缩后的可读文本。

它们仍然有价值，但不是 README 的主线。当前产品心智以 Knowledge Graph 和 source-backed retrieval 为中心。

### Wiki Graph URI

Wiki Graph 用 URI 作为归档和对象的稳定句柄。CLI 命令围绕 URI 工作：

```bash
wikigraph wikg://book.wikg
wikigraph wikg://book.wikg/chapter
wikigraph wikg://book.wikg/entity
wikigraph wikg://book.wikg/entity/Q8018
wikigraph wikg://book.wikg/triple/Q8018/discusses/Q123
```

Scope URI 默认枚举对象，也可以加 `--query` 检索。Object URI 默认读取一个具体对象。对象支持哪些操作，由对象自己的 help 决定：

```bash
wikigraph <uri> --help
wikigraph <uri> <predicate> --help
```

### Local Index、Local Job 和 Local Config

Wiki Graph 把归档内容和本机运行状态分开：

- `<archive-uri>/index` 管理 `.wikg` 的搜索索引策略。
- `wikg://local/job` 管理本机生成任务。
- `wikg://local/config` 下的 section 管理本机 LLM、并发和 WikiSpine 配置。

这些本地状态不等同于归档内容。复制 `.wikg` 文件时，接收方可能需要在自己的机器上重新启用索引或配置 provider。

## 常用工作流

### 创建知识库

```bash
wikigraph wikg://book.wikg create ./book.epub
wikigraph wikg://report.wikg create ./report.md
cat ./notes.txt | wikigraph wikg://notes.wikg create --input-format txt
```

创建命令只导入 source stage。Knowledge Graph、Reading Graph 和 Summary 需要后续生成任务。

### 检查归档状态

```bash
wikigraph wikg://book.wikg inspect
wikigraph wikg://book.wikg inspect --json
```

`inspect` 会告诉你当前归档有哪些内容，哪些能力还没准备好，以及下一步应该读哪个 help 或执行哪个命令。

### 生成 Knowledge Graph

```bash
wikigraph wikg://local/job add --input wikg://book.wikg --task knowledge-graph --accept-cost
wikigraph wikg://local/job add --input wikg://book.wikg/chapter/3 --task knowledge-graph --accept-cost
wikigraph wikg://local/job/<job-id> watch --jsonl
```

生成任务可能调用 LLM，耗时和成本取决于材料长度、模型和配置。启动前先读 `inspect` 和 job help。

### 检索实体和关系

```bash
wikigraph wikg://book.wikg/entity --query "neural network" --evidence 2
wikigraph wikg://book.wikg/triple --query "attention memory" --evidence 2
wikigraph wikg://book.wikg/chapter/3/entity --query "attention"
wikigraph wikg://book.wikg/chapter/3/triple --query "memory"
```

尽量选择最窄的 URI scope。已知章节时，从章节 scope 查；需要全书视角时，再查 archive scope。

### 追溯原文证据

```bash
wikigraph wikg://book.wikg/entity/Q8018 evidence
wikigraph wikg://book.wikg/triple/Q8018/discusses/Q123 evidence
wikigraph wikg://book.wikg/entity/Q8018 evidence --query "memory"
```

当你需要确认一个实体、关系或回答是否有原文依据时，优先使用 `evidence`。

### 扩展相关对象

```bash
wikigraph wikg://book.wikg/entity/Q8018 related --evidence 2
wikigraph wikg://book.wikg/entity/Q8018 related --query "memory" --evidence 2
```

`related` 用于从一个已选对象扩展到附近对象。Entity 的 related 结果主要是相关 triples。

### 打包上下文

```bash
wikigraph wikg://book.wikg/entity/Q8018 pack --budget 5000
```

`pack` 用于把一个已选 chunk 或 entity 周围的上下文打包给 AI Agent。需要严格核验时，先用 `evidence`。

### 导出投影

```bash
wikigraph wikg://book.wikg export --output-format markdown --output book.md
wikigraph wikg://book.wikg export --output-format txt > book.txt
```

导出结果是 `.wikg` 的可读投影，不替代 `.wikg` 归档本身。

## 面向 AI Agent

Wiki Graph 的 CLI help 是产品契约的一部分。Agent 不应该猜命令形态，而应该从 help 网络继续下钻：

```bash
wikigraph --help
wikigraph help recipe
wikigraph help readiness
wikigraph help uri
wikigraph help format
wikigraph help config
wikigraph help runtime
```

拿到一个陌生归档时，第一步是：

```bash
wikigraph <archive-uri> inspect
```

拿到一个 URI 但不知道它能做什么时：

```bash
wikigraph <uri> --help
```

拿到一个 URI 和一个 predicate，但不知道参数时：

```bash
wikigraph <uri> <predicate> --help
```

Agent 使用原则：

- 不要解压 `.wikg`，不要直接改内部 SQLite 或归档文件。
- 不要把裸文件路径当作 URI target，先转成 `wikg://...`。
- 命令返回的短 URI 是 archive-relative handle，复用前要补上 archive locator。
- 需要稳定字段时优先使用 `--json`。
- 需要遍历大量对象或读取进度流时使用 `--jsonl`。
- 需要回答内容问题时，优先从 `inspect`、scope query、object read、`evidence`、`related` 和 `pack` 组合出上下文。
- 需要生成新数据时，先确认 LLM、WikiSpine、index 和 job readiness。

## 状态

Wiki Graph 仍在快速迭代。当前推荐的稳定入口是 `wikigraph` CLI 和它的内建 help 系统。

程序化 API 和 `.wikg` 内部格式暂时不是 README 的主要文档面。它们可能已经随包暴露，但不建议外部用户在没有明确需求时依赖。

## License

Apache-2.0
