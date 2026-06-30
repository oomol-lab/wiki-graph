<p><a href="../en/library.md">English</a> | 中文</p>

# Library Usage

SpineDigest 提供面向 Node 和 TypeScript 环境的程序化 API。

CLI 是当前处理 `.wikg` 知识库的主要、也是最完整的接口。Library API 更低层：当外围 Node 应用需要在进程内运行导入、构建、导出或打开归档流程时，再使用它。

## 环境要求

- Node `>=22.12.0`

## 安装

```bash
npm install spinedigest
```

## 公开入口

这个包会从顶层入口导出 `SpineDigestApp`、`SpineDigest` 以及语言辅助类型。

同时支持 ESM `import` 和 CommonJS `require()`。

## 当前 API 形态

当前公开 library API 仍然反映底层 digest session 模型。当你需要从 Node 代码直接控制流程时使用它；当你需要完整 LLM Wiki 检索界面时，使用 CLI，也就是 `list`、`page`、`find`、`read`、`links`、`pack` 等相关命令。

典型流程：

1. 用一个 LLM model 构造 `SpineDigestApp`。
2. 针对源文件或文本流打开 digest session，或打开已有 `.wikg`。
3. 使用提供的 `SpineDigest` 对象检查 metadata、导出 projection，或保存归档。

## 示例

```ts
import { createOpenAI } from "@ai-sdk/openai";
import { SpineDigestApp } from "spinedigest";

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const app = new SpineDigestApp({
  llm: {
    model: openai("<your-model>"),
  },
});

await app.digestEpubSession(
  {
    path: "./book.epub",
  },
  async (digest) => {
    await digest.exportText("./digest.txt");
    await digest.saveAs("./book.wikg");
  },
);
```

## CommonJS 示例

```js
const { createOpenAI } = require("@ai-sdk/openai");
const { SpineDigestApp } = require("spinedigest");
```

## 主要 session 方法

- `digestEpubSession`
- `digestMarkdownSession`
- `digestTxtSession`
- `digestTextStreamSession`
- `openSession`

`openSession` 面向已有的 `.wikg` 归档，不需要重新执行一轮新的 source digest。

## 进度回调

digest session 的 option 可以传入可选的 `onProgress` 回调。

这个回调在 LLM-backed generation 过程中会提供三种事件：

- `serials-discovered`：一次性报告所有已发现 serial 的 id、fragment 数量和总词数；如果当前输入无法提前发现，则会发出一次 `available: false` 且 `serials` 为空数组的事件
- `serial-progress`：报告某个 serial 当前已经完成的词数和 fragment 数量
- `digest-progress`：报告整个 digest 当前已完成词数，以及当前已知的总词数

## `SpineDigest` 能做什么

- `readMeta()`
- `readCover()`
- `readToc()`
- `listSerials()`
- `readSerialSummary(serialId)`
- `exportText(path)`
- `exportEpub(path)`
- `saveAs(path)`

## 补充说明

- LLM-backed digest 和 build 工作需要提供 LLM 配置。
- 已有 `.wikg` 可以在不重新导入源文件的情况下重新打开。
- 如果你是在评估项目是否可以直接使用，请先从 CLI 文档开始。

## 相关文档

- [Quick Start](./quickstart.md)
- [CLI Reference](./cli.md)
- [Architecture](./architecture.md)
