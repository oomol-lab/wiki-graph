<div align=center>
  <h1>SpineDigest</h1>
  <p><a href="./README.md">English</a> | 中文</p>
  <p>
    <a href="https://www.npmjs.com/package/wikigraph"><img alt="npm version" src="https://img.shields.io/npm/v/wikigraph"></a>
    <a href="https://opensource.org/licenses/Apache-2.0"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/License-Apache%202.0-blue.svg"></a>
    <a href="https://nodejs.org/"><img alt="Node >=22.12.0" src="https://img.shields.io/badge/node-%3E%3D22.12.0-brightgreen"></a>
  </p>
</div>

![SpineDigest Terminal 演示](./docs/images/terminal-cn.png)

**SpineDigest 是一个面向 AI Agent 优化的知识库 CLI。** 它把 EPUB、Markdown 和纯文本导入 `.sdpub`，并可用 LLM 从中提取知识图谱和摘要，再把这份归档暴露成可搜索、可浏览、可阅读、可追溯证据、可沿图导航、可打包上下文的 [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)。

它不是一个把书一次性压成摘要的转换器。摘要、EPUB、Markdown 和 JSON 输出只是 `.sdpub` 知识库的投影视图。真正的主对象是 `.sdpub` 本身：一份可以被持续构建、维护、检索和复用的便携知识归档。

探索 `.sdpub` 有三条主线：

- **搜索模式：** 用 `search` 发现可 URI 寻址的 source、summary、chunk、entity 和 triple 对象。
- **结构模式：** 用 `wkg://.../chapter/tree get --json` 查看目录层级，再用 `list` 或带范围的 `search` 检查局部对象集合。
- **阅读模式：** 选定对象后，用 `get` 读取 source、chapter、summary、chunk、entity 或 triple URI。

通过这三种模式，可以把长文档当作可导航的知识库使用：先看结构，再定位相关内容，最后回到原文和知识点中深入阅读。

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
wikigraph --help
wikigraph help overview
wikigraph help ai
```

## 快速开始

SpineDigest 的主对象是 `.sdpub`：一份由 CLI 管理的知识库归档，而不是一次性导出结果。

用源材料创建知识库：

```bash
wikigraph wkg://book.sdpub create ./book.epub
cat ./article.md | wikigraph wkg://article.sdpub create --input-format markdown
```

在启动昂贵构建之前先查看和估算：

```bash
wikigraph wkg://book.sdpub status
wikigraph wkg://book.sdpub index
wikigraph wkg://book.sdpub estimate --stage reading-summary
```

明确要花 LLM 成本时，再构建派生知识：

```bash
wikigraph wkg://book.sdpub/chapter/12 queue add --task reading-graph --accept-cost
wikigraph wkg-job://<job-id> watch --jsonl
```

通过知识库接口搜索、浏览和阅读：

```bash
wikigraph wkg://book.sdpub/chapter/tree get --json
wikigraph wkg://book.sdpub search "RAG" --type chunk
wikigraph wkg://book.sdpub/chapter/12 search "exact source phrase" --type source
wikigraph wkg://book.sdpub/chapter/12 get
wikigraph wkg://book.sdpub/chunk/84 get
wikigraph wkg://book.sdpub/chunk/84 related
wikigraph wkg://book.sdpub/chunk/84 evidence
wikigraph wkg://book.sdpub/chunk/84 pack --budget 5000
```

只有需要便携视图时再输出 projection。比如只需要某一章的 `.md` 文本，可以读取该章；需要完整电子书视图时再导出 EPUB：

```bash
wikigraph wkg://book.sdpub/chapter/12/source/ get > ./chapter-12.md
wikigraph wkg://book.sdpub export --output-format epub --output ./digest.epub
```

成本规则：

```text
Create 便宜。
Queue reading-graph、reading-summary 或 knowledge-graph 任务之前先 estimate。
只有成本和等待时间可接受时，才 queue reading-graph、reading-summary 或 knowledge-graph 任务。
完成构建后，搜索、读取、导航、证据追踪、打包和导出都便宜。
```

完整参数说明见 [CLI Reference](./docs/zh-CN/cli.md)。

## 为什么要做这个项目

知识库对长文档很有用，因为它把材料变成可以反复进入的结构：先看目录，再找概念，再回到证据，而不是把所有内容一次性塞进上下文。问题是，知识库通常需要人来整理页面边界、概念关系和引用来源。书是最典型的长文本，如果能把一本书 Wiki 化，EPUB、Markdown 和纯文本也就可以用同一套方式进入知识库。

这就是 SpineDigest 最初关心“整本书”的原因。大家常说，LLM 不能真正读完整本书，因为上下文窗口不够长。可是，人类的短期记忆只有 7±2 个单位（[Miller 定律](https://zh.wikipedia.org/wiki/%E7%A5%9E%E5%A5%87%E7%9A%84%E6%95%B0%E5%AD%97%EF%BC%9A7%C2%B12)），远比任何 LLM 的上下文窗口短得多。人类仍然可以读完一本书，带着问题来回翻找，在脑中建立结构，再用这些结构回答具体问题。

瓶颈不只是窗口大小，而是工作记忆的组织方式。

如果把一本书直接塞进上下文，得到的只是一条很长的文本流。它可以被临时总结，可以被关键词搜索，也可以被截取片段，但很难稳定地回答：哪些概念属于同一组，某个判断来自哪里，两个章节之间有什么关系，哪些原文证据支撑了某个知识点。上下文窗口越长，这些问题越不消失，反而越需要结构。

SpineDigest 的目标，是把长文档变成外部工作记忆。

第一步，LLM 逐段阅读原文，模拟人类阅读时被重点“吸引”的过程，从中识别出若干 [chunk](<https://en.wikipedia.org/wiki/Chunking_(psychology)>)。这里的 chunk 不是最终摘要，而是一个注意力落点：原文中可以被再次引用、追溯和组合的独立知识单元。

接下来，传统算法接手。我以 chunk 为节点构建知识图谱，根据概念相关性建立连接，再通过图遍历与社区发现，把语义上内聚的 chunk 聚合在一起。每一组聚合结果按原文顺序串联成线索，我把它叫做 snake。它像一条穿过原文的知识链，把分散在不同位置、但属于同一主题的知识点连起来。

最后，LLM 再回到这个结构上工作。旧的用法会把这些结构压缩成 summary；现在更重要的用法，是把它们保存进 `.sdpub`。之后可以像使用 Wiki 一样打开 chapter 和 chunk 对象、追溯 source evidence、跟随 related object，并在回答问题前打包一个有证据边界的上下文。

**每一位教授手里，都攥着一条 snake。**

想象一场毕业论文答辩。答辩人站在台上，教授们围坐在场。每位教授都攥着自己负责的那条知识链，提醒答辩人：这里有证据，那里有关系，这个概念不能和另一个概念混在一起。过去，这个故事的终点是一份更公平的摘要；现在，它的终点是一间可以反复进入的资料室。使用者不需要一次性记住整本书，而是可以随时叫出相关教授，沿着线索回到证据，再组织自己的回答。

![SpineDigest 架构图](./docs/images/flowchart.svg)

你的意图仍然贯穿整个过程。在构建阶段，prompt 会影响哪些知识单元被关注；在检索阶段，任务会决定先看结构、先找关键词，还是先读原文片段。同一份 `.sdpub` 可以服务不同问题：今天用来梳理时间线，明天用来追踪概念关系，后天用来为写作打包上下文。知识库不是一次性答案，而是一个可以反复阅读、定位和复用的操作界面。

## `.sdpub` 格式

`.sdpub` 是 SpineDigest 的核心知识库归档对象。它保存源材料派生出的章节式页面、graph node、证据指针、summary 和元数据，并通过 CLI 以 LLM Wiki 的形式暴露出来。

有了这份归档，就可以直接搜索和导航知识结构：

```bash
wikigraph wkg://book.sdpub index
wikigraph wkg://book.sdpub/chapter/tree get --json
wikigraph wkg://book.sdpub/chapter/12 list --type chunk
wikigraph wkg://book.sdpub search "central argument" --type chunk
wikigraph wkg://book.sdpub/chapter/12 get
wikigraph wkg://book.sdpub/chapter/12/source/ get
```

Markdown、EPUB、txt 和 JSON 风格输出都是归档的 projection。它们适合携带和阅读，但当你需要图链接和证据追溯时，不能替代 `.sdpub` 本身。

打开 `.sdpub` 文件，可以使用 **[Inkora](http://inkora.oomol.com/download/sdpub)**。这是专门为它设计的免费应用，提供章节拓扑图和知识关系图两个视图。

想了解 `.sdpub` 的内部结构或自行解析，参见[格式规格文档](./docs/sdpub.md)。

## 直接转换

如果你只需要一次性的 digest 或格式转换，也可以使用 `transform`。它不会留下可复用的 `.sdpub` 知识库，除非显式选择 `--output-format sdpub`。

```bash
cat chapter.txt | wikigraph transform --input-format txt --output-format markdown
wikigraph transform --input book.epub --output digest.md --output-format markdown
```

这种用法适合纯转换需求；如果材料后续还要被检索、导航、追溯证据或继续构建，优先创建 `.sdpub`。

## 作为库使用

SpineDigest 也提供程序化 API，适合把底层导入、构建和导出流程嵌入自己的 Node 或 TypeScript 代码。CLI 仍然是当前最完整的知识库操作界面。CLI 之外的集成方式见 [Library Usage](./docs/zh-CN/library.md)。

## 相关项目

- [PDF Craft](https://github.com/oomol-lab/pdf-craft)：如果你的源材料是扫描版 PDF，可以先用 PDF Craft 转成 EPUB 或 Markdown，再导入 SpineDigest 知识库。
- [EPUB Translator](https://github.com/oomol-lab/epub-translator)：如果你的目标是双语阅读而不是构建知识库，EPUB Translator 可以在保留原始排版的前提下，把 EPUB 转成双语版本。

## 面向 AI Agent

CLI 优先的设计让 SpineDigest 可以把 `.sdpub` 作为托管的 LLM Wiki 归档暴露给 Agent。

- **把 `.sdpub` 当作主对象。** 先使用归档命令，不要先解压或读取内部文件。
- **先选择探索模式。** 综合理解和结构理解先用 `wkg://.../chapter/tree get --json`；候选定位和精确原文检查用 `search`；选定相关 URI 后再用 `get` 连续阅读。
- **把 help 当作探索入口。** 把 `wikigraph --help` 当作根入口，再继续读取 `wikigraph help overview`、`wikigraph help ai`、相关专题页或命令级 `--help`，不要先猜行为。
- **优先使用 `--json`。** 当输出要交给其他工具处理时使用 JSON。
- **Queue 任务之前先 estimate。** 不要在没有估算的情况下排入大范围 graph 或 summary 任务。
- **退出码。** 成功返回 `0`；失败返回非零退出码，并在 `stderr` 输出纯文本错误信息。
- **不要常规读取 `database.db`。** 使用 `search`、`list`、`get` 和图导航命令。

常用 help 入口：

```bash
wikigraph help overview
wikigraph help ai
wikigraph help task
wikigraph help config
wikigraph help env
wikigraph help config-file
wikigraph help command
```

完整 agent 操作参考见 [AI Agent Guide](./docs/zh-CN/ai-agents.md)。
