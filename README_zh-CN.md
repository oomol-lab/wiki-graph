![](./docs/images/terminal-cn.png)

<div align="center">
  <h1>Wiki Graph</h1>
  <p><a href="./README.md">English</a> | 中文</p>
  <p>
    <a href="https://www.npmjs.com/package/wiki-graph"><img alt="npm version" src="https://img.shields.io/npm/v/wiki-graph"></a>
    <a href="https://opensource.org/licenses/Apache-2.0"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/License-Apache%202.0-blue.svg"></a>
    <a href="https://nodejs.org/"><img alt="Node >=22.12.0" src="https://img.shields.io/badge/node-%3E%3D22.12.0-brightgreen"></a>
  </p>
</div>

Wiki Graph 是一个面向 [Andrej Karpathy](https://github.com/karpathy) 的 [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 思路和 Google [OKF](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing) 方向构建的开源长文本知识库管理 CLI。

它将纯文本写入 `.wikg` 归档，并按需生成可检索、可追溯证据的 Knowledge Graph。这为 Karpathy 所说的 LLM Wiki 落地为可执行的知识生产流程，提供了一套可运行的 CLI。

在 Agent 场景中，PDF、网页、EPUB、字幕、会议录音、视频课程或内部文档都可以先由外部工具转成文本，再交给 Wiki Graph。Wiki Graph 负责的是后半段：把这些长文本落入知识库，抽取 Entity 和 Triple，并保留能追到章节与原句的证据线索；需要压缩阅读时，也可以先生成阅读图谱，再基于它产出摘要。

Karpathy 的核心想法是：不要让 AI 每次提问都从原始材料重新检索，而是把知识编译成可持续维护的 Wiki。OKF 则把这类 Wiki 实践推向开放、可移植的知识格式。Wiki Graph 负责把这条链路中属于 OKF 的 source layer 这部分做实：把长文本变成 Wiki 和 OKF 可以继续消费的知识原料，包括实体、关系，以及能追回原文的证据。

[![观看视频](./docs/images/bilibili-cover.png)](https://www.bilibili.com/video/BV1cwMV6ZEpJ/)

## 快速开始

运行前提 Node.js `>=22.12.0`

安装：

```bash
$ npm install -g wiki-graph
```

主命令是 `wg`，也可使用 `wikigraph`。

创建一份空的 `.wikg` 知识库：

```bash
$ wg wikg://quickstart.wikg create
```

导入两个章节的文本：

```bash
$ printf "Alpha is connected to beta.\n" | wg wikg://quickstart.wikg/chapter add --title "First note" --input -

$ printf "Beta mentions gamma.\n" > tmp.txt && wg wikg://quickstart.wikg/chapter add --title "Second note" --input ./tmp.txt
```

查看章节树：

```bash
$ wg wikg://quickstart.wikg/chapter/tree

├─ First note  wikg://chapter/first-note
└─ Second note  wikg://chapter/second-note
```

开启并构建 FTS 全文索引（开启后才可使用 `--query` 进行全文搜索）：

```bash
$ wg wikg://quickstart.wikg/index enable
```

把内容搜出来：

```bash
$ wg wikg://quickstart.wikg --query alpha

@@ wikg://chapter/first-note/source#1 @@
Alpha is connected to beta.
```

## 手动 LLM eval

`pnpm eval:llm` 会用真实大语言模型跑一组手动的 summarize/compressor 评估。它不会被 `pnpm test`、`pnpm test:run` 或 CI 自动触发。脚本会输出 case 名称、模型信息、原始输出、最终用户可见输出和基础启发式检查结果，方便在改 prompt 或切模型前人工判断。

运行时会使用 `--llm` JSON 或本地 LLM 配置，并且可能产生模型调用费用。内置 case 使用了脱敏的自言自语回归样本，用来覆盖 summarize 压缩链路；它会对比 #117 之前风格的 legacy prompt 和当前 `<final>` 协议 prompt，方便人工确认回归是否仍存在。prompt 演进后可以继续补充或调整。

## 为什么要做 Wiki Graph

Wiki Graph 解决的是长文本知识化问题：LLM 如何读取大规模源材料、保留可追溯证据，并把其中更持久的实体和关系编译成可维护的知识库。它通过公共实体 grounding、源文证据和图结构，让长文本变得可检索、可追溯、可复用。

摘要仍然有用，但摘要只是长文本的一种投影；更值得沉淀的是文本里的实体、关系和证据。Wiki Graph 把长文本视为 source material：它不应该只被一次性压扁，而应该被组织成可以反复进入、追问和验证的结构。

![Reading flowchart](./docs/images/flowchart.svg)

Karpathy 的 LLM Wiki 给出了一个很重要的方向：知识不应该每次都从原始材料重新检索，而应该被编译成可维护的 Wiki。在这个方案里，除了原始材料和 Wiki 本身，还会有一层 schema：它是一份写给 Agent 的知识库维护规约，用来约定 Wiki 的组织方式、页面格式、交叉引用和摄入流程。由于这份规约会由你和 LLM 围绕自己的领域、偏好和材料一起演化，它天然会形成私人 schema；当 Wiki 还主要依赖私人实体时，Agent 往往需要反复阅读、抽取和修正，才能尽可能多地找出实体、关系和结构。也就是说，抽取效果不仅取决于模型能力，还取决于这套规约是否足够清晰、稳定；一旦规约漂移，信息就更容易被漏掉，幻觉也更容易写进知识库。

Wiki Graph 选择从更确定的地方开始：公共实体。Wikipedia / Wikidata 像一部人类共享的公共词典，已经给大量人物、组织、地点、概念、术语、法条和事件提供了相对稳定的语义边界。Wiki Graph 通过 [WikiSpine](https://github.com/moskize91/wikispine) 扫描文本，召回可能对应 Wikipedia / Wikidata 的实体，再用 LLM 做消歧和筛选。它更像是先用公共词典召回候选实体，再让模型做消歧和筛选，而不是让模型从零决定实体边界；公共实体抽取也不依赖一份需要用户和 Agent 共同维护的私人 schema。

因为这条路线依赖 Wikipedia / Wikidata 的既有收录，所以它不能覆盖所有私人实体，例如员工手册里的内部代号、电话簿里的普通姓名，或新创作小说里的非知名角色。这是一种有意识的取舍：Wiki Graph 不急着覆盖所有实体，而是先换取公共实体抽取的稳定性和可复用性。只要实体能对齐到同一个 QID，关系和证据就可以跨章节、跨书、跨材料累积到同一个知识对象上。

Wiki Graph 要做的，就是把长文本中可以稳定对齐的公共知识先沉淀成 source layer，让它们成为可检索、可追溯、可继续生长的知识库底座。

## 核心概念

### `.wikg`

`.wikg` 是 Wiki Graph 用来创建、维护和分享知识库的归档文件。它可以保存源文本、章节树、Knowledge Graph、Reading Graph、Summary、索引策略和元数据，并用树形章节组织知识库内容。

在 LLM Wiki 的描述下，知识库常常接近一个人的第二大脑：私人、持续增长，并且混合着大量个人 schema。`.wikg` 是对这个方向的一个可携带补充：它给知识库加上明确 scope，让它可以像一本书、一个网站、一门课程或一组会议记录那样被组织和交付。

你既可以把它当成私人知识库来逐步整理，也可以保留原始材料的结构，例如书籍章节、网站目录、课程单元或视频分段。生产知识库的人和消费知识库的人不必是同一个人；一个 `.wikg` 文件可以被复制、发送、上传、备份和分享。

### Knowledge Graph

Knowledge Graph 是 Wiki Graph 的主要生成结果。它把长文本中分散出现的人物、组织、概念、事件和它们之间的关系抽取出来，让知识库不再只是可以全文搜索的文本集合，而是可以沿着实体和关系继续追问的结构化知识网络。

这些关系会以三元组（triple）的形式投影出来，也就是 `subject --predicate--> object`。因此可以从一个实体出发，继续追问它和哪些对象有关、关系类型是什么，以及这些关系由哪些原文证据支持。

这对长文本尤其重要：同一个概念可能分散在不同章节，同一段关系可能被多个片段反复支撑。Knowledge Graph 可以把这些分散线索收拢到同一个知识对象上，从而发现“谁和谁有关”“这个判断来自哪里”“哪些章节共同支撑了同一个知识点”。

典型问题包括：

- 文档里出现了哪些重要实体？
- 某个实体和哪些对象有关系？
- 某条关系由哪些原文支持？
- 哪些章节或段落支撑了同一个知识点？

Wiki Graph 的 Knowledge Graph 主要由 Entity、Triple 和 Evidence 组成。Entity 是归一化后的公共实体，通常会通过 [WikiSpine](https://github.com/moskize91/wikispine) 对齐到 Wikipedia / Wikidata 中的 QID，例如人物、组织、地点、概念、术语或法条；私人姓名、内部代号或未公开设定则不属于它的主要覆盖范围。Triple 是一条实体级关系，形如：

```text
subject --predicate--> object
```

Evidence 是支持实体或关系的原文依据。Wiki Graph 的 Knowledge Graph 不是只给出结论，还要能回到 source text。

### 摘要生成

Wiki Graph 也可以为章节生成中文摘要，把长文本压缩成更短、更容易携带和复用的阅读结果。

它的摘要不是直接把全文一次性压扁，而是先生成 Reading Graph：根据[米勒定律](https://en.wikipedia.org/wiki/The_Magical_Number_Seven,_Plus_or_Minus_Two)中认知区块的思路，把长文本拆成可追溯的[区块](<https://en.wikipedia.org/wiki/Chunking_(psychology)>)，按概念相关性连接，再按原文顺序组织成阅读链路。中文摘要基于 Reading Graph 生成，因此压缩后的文本仍然能回到原文依据。

### Wiki Graph URI

Wiki Graph 用 URI 作为归档、scope 和 object 的稳定句柄。一个 URI 要么指向 scope，要么指向 object：scope 用来枚举或检索一组对象，object 用来读取或操作一个具体对象。

```bash
$ wg wikg://book.wikg/chapter
$ wg wikg://book.wikg/chapter/part
$ wg wikg://book.wikg/chapter/part/chunk
$ wg wikg://book.wikg/entity
$ wg wikg://book.wikg/triple/Q8018/discusses
```

上面这些都是 scope URI。直接调用 scope URI 会列出对象；加上 `--query` 会在这个 scope 内搜索；加上 `--limit` 可以限制返回数量；加上 `--all` 会取回完整结果，适合明确需要全量导出或清点时使用。

```bash
$ wg wikg://book.wikg/chapter/part --query "memory"
$ wg wikg://book.wikg/entity --query "neural network" --limit 5
$ wg wikg://book.wikg/chapter --all --json
```

object URI 默认读取一个具体对象：

```bash
$ wg wikg://book.wikg/chapter/part/title
$ wg wikg://book.wikg/chapter/part/source#4..8
$ wg wikg://book.wikg/chapter/part/chunk/12
$ wg wikg://book.wikg/entity/Q8018
$ wg wikg://book.wikg/triple/Q8018/discusses/Q123
```

大多数对象都可以落在某个章节下，例如 `chapter/part/source#4..8`、`chapter/part/chunk/12`、`chapter/part/entity/Q8018`。也有一些对象可以在章节外按整个归档访问，例如 `entity/Q8018` 和 `triple/Q8018/discusses/Q123`；同一个实体或关系可能由多个章节共同支撑。

URI 前半段是归档地址。绝对地址、相对地址和 Windows 路径要写成 Wiki Graph URI，而不是裸文件路径：

```bash
$ wg wikg:///Users/me/books/book.wikg
$ wg wikg://book.wikg
$ wg wikg://C:/Users/me/books/book.wikg
```

命令输出里经常出现短地址，例如：

```text
wikg://chapter/part/source#4..8
wikg://entity/Q8018
wikg://triple/Q8018/discusses/Q123
```

这些短地址只是 archive-relative handle，用来让输出更短，本身不是完整命令 target。再次使用时要补上归档地址：

```bash
$ wg wikg://book.wikg/chapter/part/source#4..8
$ wg wikg:///Users/me/books/book.wikg/entity/Q8018
```

命令形态通常是“URI + 谓语”。URI 放在前面，但它是命令要处理的对象；后面的谓语说明要对它做什么。没有谓语时，scope URI 通常执行 list，object URI 通常执行 read。

```bash
$ wg wikg://book.wikg/entity/Q8018
$ wg wikg://book.wikg/entity/Q8018 evidence
$ wg wikg://book.wikg/entity/Q8018 related --query "memory"
$ wg wikg://book.wikg/entity/Q8018 pack --budget 5000 --json
```

更多 URI 规则和边界以 CLI help 为准。可以先看 URI 专题，也可以直接对某个 URI 或 URI 谓语查 help：

```bash
$ wg help uri
$ wg wikg://book.wikg/entity/Q8018 --help
$ wg wikg://book.wikg/entity/Q8018 evidence --help
```

## 常用工作流

### 创建知识库

```bash
$ wg wikg://book.wikg create
$ wg wikg://book.wikg create --import ./book.epub
```

不带 `--import` 时会创建一份空的 `.wikg` 知识库。`--import` 只接受 EPUB，用于创建知识库并导入 EPUB 的元数据、封面、章节树和源文本。

### 检查归档状态

```bash
wg wikg://book.wikg inspect
wg wikg://book.wikg inspect --json
```

`inspect` 会告诉你当前归档有哪些内容，哪些能力还没准备好，以及下一步应该读哪个 help 或执行哪个命令。

### 生成 Knowledge Graph

```bash
wg wikg://local/job add --input wikg://book.wikg --task knowledge-graph --accept-cost
wg wikg://local/job add --input wikg://book.wikg/chapter/part --task knowledge-graph --accept-cost
wg wikg://local/job/<job-id> watch --jsonl
```

生成任务可能调用 LLM，耗时和成本取决于材料长度、模型和配置。启动前先读 `inspect` 和 job help。

### 检索实体和关系

```bash
wg wikg://book.wikg/entity --query "neural network" --evidence 2
wg wikg://book.wikg/triple --query "attention memory" --evidence 2
wg wikg://book.wikg/chapter/part/entity --query "attention"
wg wikg://book.wikg/chapter/part/triple --query "memory"
```

尽量选择最窄的 URI scope。已知章节时，从章节 scope 查；需要全书视角时，再查 archive scope。

### 追溯原文证据

```bash
wg wikg://book.wikg/entity/Q8018 evidence
wg wikg://book.wikg/triple/Q8018/discusses/Q123 evidence
wg wikg://book.wikg/entity/Q8018 evidence --query "memory"
```

当你需要确认一个实体、关系或回答是否有原文依据时，优先使用 `evidence`。

### 扩展相关对象

```bash
wg wikg://book.wikg/entity/Q8018 related --evidence 2
wg wikg://book.wikg/entity/Q8018 related --query "memory" --evidence 2
```

`related` 用于从一个已选对象扩展到附近对象。Entity 的 related 结果主要是相关 triples。

### 准备上下文

```bash
wg wikg://book.wikg/entity/Q8018 pack --budget 5000
```

`pack` 用于把一个已选 chunk 或 entity 周围的上下文整理成可直接携带的文本。需要严格核验时，先用 `evidence`。

## 面向 AI Agent

Wiki Graph 把 CLI help 作为产品契约维护。安装后从根 help 开始即可；命令、URI、谓语、配置、运行时和格式约束都会在 help 网络中继续下钻，不需要依赖 README 猜命令形态。

```bash
$ wg --help
```

关于归档结构、标准条目、校验和兼容性规则，请阅读 [`.wikg` 归档标准](./docs/zh-CN/wikg-standard.md)。

关于在 Node.js 中通过代码使用 Wiki Graph，请阅读 [SDK 文档](./docs/zh-CN/sdk.md)。

## License

Apache-2.0
