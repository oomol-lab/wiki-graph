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

**把书读薄：** SpineDigest 把长篇书籍喂给 AI，自动提炼核心内容。处理结果不只是文字摘要——它同时生成章节拓扑与知识脉络图，让整本书的结构一眼可见。

![Inkora 打开效果](./docs/images/app-screenshot-cn.png)

<div align=center>
  <sub><a href="http://inkora.oomol.com/download/sdpub">Inkora</a> 打开 .sdpub 效果</sub>
</div>

## 安装

运行前提：

- Node `>=22.12.0`
- 如果要从 EPUB、Markdown 或 TXT 生成新的 digest：需要一个受支持的 LLM provider 及其凭据
- 如果只是重新导出 `.sdpub` 或查看 `.sdpub` 信息：不需要 LLM 访问权限

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

下面前两个例子都会从源输入创建新的 digest，因此需要先完成 LLM 配置。
如果需要配置说明，先运行：

```bash
spinedigest help config
```

把一本 EPUB 摘要成 Markdown：

```bash
spinedigest --input ./book.epub --output ./digest.md --prompt "重点保留主主角、配角的情绪变化细节"
```

先保存归档，之后再导出：

```bash
spinedigest --input ./book.epub --output ./book.sdpub
spinedigest --input ./book.sdpub --output ./book.epub
```

从 stdin 读取，从 stdout 输出：

```bash
cat ./chapter.txt | spinedigest --input-format txt --output-format markdown
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

SpineDigest 每次处理完都会生成一份 `.sdpub` 文件。可以把它理解成一份"处理存档"：里面装的不只是摘要文字，还有 SpineDigest 在整个流程中建立的完整知识结构（chunk、snake、概念关系图）。

有了这份存档，你可以随时将它导出成 EPUB、Markdown 或纯文本，不需要重新调用 LLM 跑一遍原始流程。注意，导出为其他格式后，会丢失 `.sdpub` 特有的章节拓扑图和知识关系。换句话说，`.sdpub` 是唯一能完整保留 SpineDigest 处理结果的形式——如果你将来还想重新导出，或者想在可视化工具里查看这本书的结构，就应该把它留着。

打开 `.sdpub` 文件，可以使用 **[Inkora](http://inkora.oomol.com/download/sdpub)**——这是专门为它设计的免费应用，提供章节拓扑图和知识关系图两个视图。

想了解 `.sdpub` 的内部结构或自行解析，参见[格式规格文档](./docs/sdpub.md)。

## 输入与输出

| 格式                | 输入 | 输出 |
| ------------------- | ---- | ---- |
| `.epub`             | ✓    | ✓    |
| `.md`               | ✓    | ✓    |
| `.txt`              | ✓    | ✓    |
| `.sdpub`            | ✓    | ✓    |
| `stdin`（txt / md） | ✓    | —    |
| `stdout`            | —    | ✓    |

运行要求：Node `>=22.12.0`，以及任意受支持的 LLM provider 及其凭据。输入为 `.sdpub` 时不需要 LLM 访问权限。

## 作为库使用

SpineDigest 也提供程序化 API，适合把摘要流程嵌入自己的 Node 或 TypeScript 代码。CLI 之外的集成方式见 [Library Usage](./docs/zh-CN/library.md)。

## 面向 AI Agent

CLI 优先的设计让 SpineDigest 可以被直接调用，无需额外集成代码。

- **CLI 优先。** 除非明确需要代码级集成，否则优先使用 CLI。
- **把 help 当作探索入口。** 先运行 `spinedigest --help`，再读取 `spinedigest help ai` 和相关专题页，不要先猜行为。
- **信任 `--help`。** CLI 中每个命令都可以通过 `--help` 查询用法。
- **行为确定性。** 用显式的 `--input` 和 `--output` 保证每次运行结果一致。
- **退出码。** 成功返回 `0`；失败返回非零退出码，并在 `stderr` 输出纯文本错误信息。
- **stdin 支持。** 仅接受 `txt` 和 `md`，且只用于非交互式流程。
- **无 LLM 依赖。** 输入为 `.sdpub` 时不调用任何 LLM provider。
- **优先保留归档。** 如果同一份摘要将来还需要再次导出，把 `.sdpub` 作为中间产物。

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
