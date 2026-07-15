[English](../en/sdk.md) | 中文

# SDK

本文档说明如何在 Node.js 代码中通过 `wiki-graph-core` 使用 Wiki Graph。当应用需要创建、读取、检索或维护 `.wikg` 归档，并且不希望 shell out 到 `wg` CLI 时，应使用 SDK。

## Packages

代码需要程序化访问时，安装 SDK 包：

```bash
$ npm install wiki-graph-core
```

用户需要获得 `wg` 命令时，安装 CLI 包：

```bash
$ npm install -g wiki-graph
```

CLI 包依赖 `wiki-graph-core`。应用代码应直接依赖 `wiki-graph-core`。

## Main SDK

主入口是 `wiki-graph-core`。它暴露 archive session、archive query helpers、章节操作、队列控制和共享类型。

```ts
import { WikiGraph } from "wiki-graph-core";

const wikiGraph = new WikiGraph({});

await wikiGraph.digestTextStreamSession(
  {
    stream: ["Alpha is connected to beta.\n"],
    targetStage: "planned",
    title: "Research note",
  },
  async (archive) => {
    await archive.saveAs("research.wikg");
  },
);

await wikiGraph.openSession("research.wikg", async (archive) => {
  console.log(await archive.readMeta());
});
```

`targetStage: "planned"` 会创建归档，但不会调用 LLM。需要构建 Reading Graph、Summary 或 Knowledge Graph 的阶段必须配置 LLM。

## LLM 配置

`WikiGraph` 接受任意 AI SDK `LanguageModel`。SDK 不读取 CLI 配置文件；应用需要自己传入模型和运行参数。

```ts
import { createOpenAI } from "@ai-sdk/openai";
import { WikiGraph } from "wiki-graph-core";

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const wikiGraph = new WikiGraph({
  llm: {
    cacheDirPath: ".wikigraph-cache",
    concurrent: 3,
    logDirPath: ".wikigraph-logs",
    model: openai("gpt-4.1-mini"),
  },
});
```

## 队列控制

队列控制属于主 SDK，因为应用进程可能需要添加、查看、暂停、恢复、取消和清理任务。

```ts
import { addBuildJob, listBuildJobs } from "wiki-graph-core";

const job = await addBuildJob({
  archivePath: "research.wikg",
  chapterId: 1,
  target: "knowledge-graph",
});

console.log(job.jobId);
console.log(await listBuildJobs({ archivePath: "research.wikg" }));
```

添加任务不会启动 worker。进程管理有意留给应用或 CLI 处理。

## Worker SDK

`wiki-graph-core/worker` 只应在一个已经被设计为执行队列任务的进程里使用。这个入口不会创建进程。

```ts
import { runBuildJobWorker } from "wiki-graph-core/worker";

await runBuildJobWorker({
  concurrency: 1,
  executeJob: async (job, reporter, context) => {
    // 应用在这里提供任务执行策略。
    // CLI 会把这里接到 Wiki Graph 内置的生成管线上。
    context.signal.throwIfAborted();
    await reporter.stepStarted(job.target);
    await reporter.stepCompleted(job.target);
  },
});
```

大多数应用应直接使用 CLI 做后台生成；如果需要自己的后台 worker，应创建自己的进程入口，并在其中调用这个 SDK 函数。

## GC SDK

`wiki-graph-core/gc` 用于在当前进程中执行本地 Wiki Graph 清理。

```ts
import { tryRunWikiGraphGc } from "wiki-graph-core/gc";

const report = await tryRunWikiGraphGc({
  dryRun: false,
  force: false,
});

console.log(report);
```

GC SDK 会在当前进程中运行清理，不会启动或调度另一个进程。

## 进程边界

SDK 有三套 process-local surface：

- `wiki-graph-core`：应用和队列控制 API。
- `wiki-graph-core/worker`：给已经启动的 worker 进程使用的构建 API。
- `wiki-graph-core/gc`：给已经启动的 GC 进程使用的清理 API。

创建进程不属于 SDK。`wg` CLI 使用自己的私有 worker 入口执行后台任务；应用如果需要后台 worker，也应采用类似方式自行管理进程。

## 相关文档

- [`.wikg` Archive Standard](../wikg-standard.md)
- [WikiSpine Runtime](../wikispine-runtime.md)
