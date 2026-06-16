<div align=center>
  <h1>SpineDigest</h1>
  <p><a href="./README.md">English</a> | 中文</p>
  <p>
    <a href="https://www.npmjs.com/package/spinedigest"><img alt="npm version" src="https://img.shields.io/npm/v/spinedigest"></a>
    <a href="https://opensource.org/licenses/Apache-2.0"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/License-Apache%202.0-blue.svg"></a>
    <a href="https://nodejs.org/"><img alt="Node >=22.12.0" src="https://img.shields.io/badge/node-%3E%3D22.12.0-brightgreen"></a>
  </p>
</div>

![SpineDigest Terminal 演示](./docs/images/terminal-cn.png)

**SpineDigest 用来为 AI Agent 构建可携带的 LLM Wiki 归档。** 它把长文档导入 `.sdpub`，再让 Agent 通过 CLI 搜索、浏览、追溯证据、沿图链接导航，并在需要时导出投影视图，而不是解压归档读内部文件。

对 Agent 来说，探索 `.sdpub` 有三条主线：

- **搜索模式：** 用 `find` 做按空白拆分的多关键词发现，用 `grep` 检查连续精确文本。
- **结构模式：** 用 `list` 获取有界对象集合，用 `page` 打开带局部导航的单个详情对象。
- **阅读模式：** 用 `read` 将 chapter、summary、fragment、node 或 sentence 以连续纯文本输出。

对于综合理解、时间线、关系分析、过程梳理或概念结构任务，先走结构模式：`list --type chapter`，再 `page chapter:<id>` 并检查 `nodeGroups`。搜索用于定位候选内容或验证精确原文。

![Inkora 打开效果](./docs/images/app-screenshot-cn.png)

<div align=center>
  <sub><a href="http://inkora.oomol.com/download/sdpub">Inkora</a> 打开 .sdpub 效果</sub>
</div>

## 安装

运行前提：

- Node `>=22.12.0`
- 如果要构建 graph 或 summary：需要一个受支持的 LLM provider 及其凭据
- 如果只是搜索、阅读、导航或导出 `.sdpub`：不需要 LLM 访问权限

无需全局安装，直接试用：

```bash
npx spinedigest --help
```

全局安装：

```bash
npm install -g spinedigest
```

如果你想先了解这个 CLI 的能力边界，建议先执行：

```bash
spinedigest --help
spinedigest help ai
```

## 快速开始

SpineDigest 的主对象是 `.sdpub`：一份由 CLI 管理的知识归档，而不是一次性转换输出。

把源材料导入归档：

```bash
spinedigest import ./book.sdpub ./book.epub
cat ./article.md | spinedigest import ./article.sdpub --input-format markdown
```

在启动昂贵构建之前先查看和估算：

```bash
spinedigest status ./book.sdpub
spinedigest index ./book.sdpub
spinedigest estimate ./book.sdpub --stage ready
```

明确要花 LLM 成本时，再构建派生知识：

```bash
spinedigest build ./book.sdpub --stage graph --confirm
```

通过归档接口搜索和阅读：

```bash
spinedigest list ./book.sdpub --type chapter
spinedigest find ./book.sdpub "RAG"
spinedigest grep ./book.sdpub "exact source phrase"
spinedigest page ./book.sdpub node:84
spinedigest read ./book.sdpub chapter:12
spinedigest evidence ./book.sdpub node:84
spinedigest links ./book.sdpub node:84
spinedigest related ./book.sdpub node:84
spinedigest pack ./book.sdpub node:84 --budget 5000
```

只有需要便携视图时再导出 projection：

```bash
spinedigest export ./book.sdpub --output-format markdown --output ./digest.md
spinedigest export ./book.sdpub --output-format epub --output ./digest.epub
```

成本规则：

```text
Import 便宜。
Build 之前先 estimate。
Build 可能昂贵。
完成构建后，搜索、阅读、导航和导出都便宜。
```

完整参数说明见 [CLI Reference](./docs/zh-CN/cli.md)。

## 为什么要做这个项目

有人说，因为上下文窗口有限，你无法将一整本书传给 LLM 让它生成整书摘要。然而，别忘了，人类的短期记忆只有 7±2 个单位（Miller 定律），远比任何大语言模型的上下文窗口短得多。可是，人类却能读完整本书并写出摘要。

也许，瓶颈不在窗口，而在取舍。不要贪多，要接受“摘要不可能保留所有细节”，“舍”比“取”更难，也更关键。不敢大胆删减，摘要就写不成。更深一层，丢什么本来就没有公认的标准。它取决于你读这本书的目的：“作者给了哪些实用建议”、”作者的核心论点是什么”、”主角经历了怎样的转变”……每一个目的都会导向截然不同的取舍结果。强行让 AI 在没有前提的情况下做摘要，它其实不知道该怎么做。因为根本不存在一个所有人都认可的通用标准。

SpineDigest 用一套分阶段的流程来解决这件事。首先，AI 逐段阅读原文，模拟人类阅读时被重点"吸引"的过程，从中识别出若干 [chunk](<https://en.wikipedia.org/wiki/Chunking_(psychology)>)（认知心理学对短期记忆信息单元的称呼）。每一个 chunk 是一个注意力的落点，对应原文中的一个独立知识点。

接下来，就得靠传统算法了。我以 chunk 为节点构建知识图谱，根据概念相关性建立连接，再通过图遍历与社区发现，把语义上内聚的 chunk 聚合在一起。每一组聚合结果按原文顺序串联成线索——我把它叫做 snake，因为它在图中把属于同一主题的知识点首尾相连，像一条蛇一样穿行在原文之中。

最后，到了做摘要阶段，又切回了基于 LLM 的方案。我用了一个对抗性的 Multi-Agent 框架，角色分为两类：负责生成摘要的答辩人，以及负责审查的教授。

**每一位教授手里，都攥着一条 snake。**

想象一场毕业论文答辩。答辩人站在台上，所有的教授同时围坐在场。每位教授攥着自己负责的那段原文，对照你给出的提取目标，轮流质询答辩人：这里你漏了，那里你没有公平对待。答辩人必须逐一回应，不能完全忽视任何一方，却也不可能让所有人都满意。经过多轮来回，答辩人最终交出摘要了，却也是在所有质询下被迫做出的折中：每一段原文在摘要里都得到了某种程度的体现，或许只是短短一句，但不会被彻底抹去。

![SpineDigest 架构图](./docs/images/flowchart.svg)

以上流程中，你的意志是贯穿一切的主轴。在阅读阶段，AI 的注意力方向就已经被塑造：你告诉它关注什么，它在读原文时就对什么敏感；chunk 的提取，本质上是你的兴趣在原文里的落点。到了答辩阶段，教授们也用同一个标准来审查：符合你意愿的内容会被多名教授共同保护；不符合你的意愿的内容，由于无人庇护，在答辩人承受的多轮质询压力下会被逐渐舍弃。你在开始时用自然语言说出的要求，在两个阶段都在发挥作用。

## `.sdpub` 格式

`.sdpub` 是 SpineDigest 的核心知识归档对象。它保存源材料派生出的章节式页面、graph node、证据指针、summary 和元数据，并通过 CLI 以 Agent 可读的 LLM Wiki 形式暴露出来。

有了这份归档，Agent 可以直接搜索和导航知识结构：

```bash
spinedigest index ./book.sdpub
spinedigest list ./book.sdpub --type chapter
spinedigest list ./book.sdpub --type node --chapter 12
spinedigest find ./book.sdpub "central argument"
spinedigest page ./book.sdpub chapter:12
spinedigest read ./book.sdpub chapter:12
```

Markdown、EPUB、txt 和 JSON 风格输出都是归档的 projection。它们适合携带和阅读，但当你需要图链接和证据追溯时，不能替代 `.sdpub` 本身。

打开 `.sdpub` 文件，可以使用 **[Inkora](http://inkora.oomol.com/download/sdpub)**——这是专门为它设计的免费应用，提供章节拓扑图和知识关系图两个视图。

想了解 `.sdpub` 的内部结构或自行解析，参见[格式规格文档](./docs/sdpub.md)。

## 输入与输出

| 格式                | 导入源 | 导出投影 |
| ------------------- | ------ | -------- |
| `.epub`             | ✓      | ✓        |
| `.md`               | ✓      | ✓        |
| `.txt`              | ✓      | ✓        |
| `.sdpub`            | 归档   | 归档     |
| `stdin`（txt / md） | 兼容   | —        |
| `stdout`            | —      | ✓        |

运行要求：Node `>=22.12.0`。graph 和 summary 构建需要 LLM 凭据；`.sdpub` 的查看、搜索、证据追溯、导航和导出不需要 LLM 访问权限。

## 作为库使用

SpineDigest 也提供程序化 API，适合把摘要流程嵌入自己的 Node 或 TypeScript 代码。CLI 之外的集成方式见 [Library Usage](./docs/zh-CN/library.md)。

## 相关项目

- [PDF Craft](https://github.com/oomol-lab/pdf-craft)：如果你的源材料是扫描版 PDF，可以先用 PDF Craft 转成 EPUB 或 Markdown，再交给 SpineDigest 做提炼。
- [EPUB Translator](https://github.com/oomol-lab/epub-translator)：如果你的目标是双语阅读而不是摘要，EPUB Translator 可以在保留原始排版的前提下，把 EPUB 转成双语版本。

## 面向 AI Agent

CLI 优先的设计让 SpineDigest 可以把 `.sdpub` 作为托管的 LLM Wiki 归档暴露给 Agent。

- **把 `.sdpub` 当作主对象。** 先使用归档命令，不要先解压或读取内部文件。
- **先选择探索模式。** 综合理解和结构理解先用 `list/page`；候选定位和精确原文检查用 `find/grep`；选定相关对象后再用 `read` 连续阅读。
- **把 help 当作探索入口。** 把 `spinedigest --help` 当作根入口，再继续读取 `spinedigest help ai`、相关专题页或命令级 `--help`，不要先猜行为。
- **优先使用 `--json`。** 当输出要交给其他工具处理时使用 JSON。
- **Build 之前先 estimate。** 不要在没有估算的情况下启动整份归档的 graph、summary 或 ready 构建。
- **退出码。** 成功返回 `0`；失败返回非零退出码，并在 `stderr` 输出纯文本错误信息。
- **不要常规读取 `database.db`。** 使用 `list`、`page`、`read`、`evidence` 和图导航命令。

常用 help 入口：

```bash
spinedigest help ai
spinedigest help task
spinedigest help config
spinedigest help env
spinedigest help config-file
spinedigest help sdpub
```

完整 agent 操作参考见 [AI Agent Guide](./docs/zh-CN/ai-agents.md)。
