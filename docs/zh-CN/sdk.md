[English](../en/sdk.md) | 中文

# SDK

本文档说明如何通过 `wiki-graph-core` 使用 Wiki Graph。当应用需要创建、读取、检索或维护 `.wikg` 归档，并且不希望 shell out 到 `wg` CLI 时，应使用 SDK。Core 是与运行时无关的 TypeScript 库：由宿主提供 `File` 和 `Directory` 实现；仅 CLI 私下负责 Node 文件系统、SQLite 和 ZIP 的组装。

## Packages

代码需要程序化访问时，安装 SDK 包：

```bash
$ npm install wiki-graph-core
# 或
$ pnpm add wiki-graph-core
```

用户需要获得 `wg` 命令时，安装 CLI 包：

```bash
$ npm install -g wiki-graph
# 或
$ pnpm add --global wiki-graph
```

正常使用 `wg` 时，安装后的 CLI 命令是自包含的。应用代码需要 core SDK 时，应直接依赖
`wiki-graph-core`。如果应用使用 `wiki-graph` 包提供的 programmatic CLI runner
入口，应同时安装 `wiki-graph` 和 `wiki-graph-core`，让 runner 与应用共享同一份
core 包。

## Main SDK

主入口是 `wiki-graph-core`。它暴露 archive session、archive query helpers、章节操作、队列控制和共享类型。

### 宿主存储

打开或创建归档前，宿主需要提供两个目录根：

```ts
import {
  installWikiGraphPlatform,
  WikiGraph,
  type Directory,
  type File,
  type WikiGraphPlatform,
} from "wiki-graph-core";

installWikiGraphPlatform(myPlatform satisfies WikiGraphPlatform);

const storage = {
  library: myLibraryDirectory satisfies Directory,
  documentStore: myDocumentDirectory satisfies Directory,
};
const wikiGraph = new WikiGraph({ storage });

const archive = myArchiveFile satisfies File;
await wikiGraph.openSession(archive, (session) => session.readMeta());
```

`File`/`Directory` 是平台原语，Core 不解析它们背后的 URI 或绝对路径。浏览器、Extension 等宿主可以使用 IndexedDB、OPFS 或其他受限存储；`wiki-graph` CLI 提供 Node 适配器。
每个 `File.identity` 和 `Directory.identity` 都是稳定、不透明的协调标识，而不是路径或 URI。归档使用的 SQLite 工作区只会创建在传入的 `documentStore` 下，并在会话完成后清理。派生搜索索引也保存在该目录中，但使用不含路径的 opaque key 作为持久缓存；它不会写入 `.wikg`，且随时可以重建。
宿主需要实现四种彼此独立的 `File` 访问方式：`read()` 读取完整文件；`openReader()` 返回按字节范围读取的 reader；writer 的 `write()` 顺序追加数据；`writeAt()` 在该 writer 的绝对 offset 写入字节。reader 会拒绝超出其 `size` 的范围。writer 只有在 `commit()` 时才原子发布完整 snapshot，`abort()` 会放弃 snapshot；位置写入不会推进顺序 `write()` 的位置。ZIP 和 SQLite 仍是独立的平台 provider，其底层存储策略由宿主自行决定，不属于 `File` 的职责。
`WikiGraphPlatform` 是进程级宿主基础设施，负责异步上下文、数据库、ZIP、资源解析和执行实例存活探测；应用在 import 后安装一次即可。ZIP reader 按需读取小 entry，并通过 `copyEntry()` 将可能很大的单个 entry 复制到事务式 host `File`；ZIP 写入同时接受 byte-backed 和 file-backed entry。如何流式处理、缓存或物化 ZIP 数据由宿主负责，Core 不会把大型 entry 或 workspace snapshot 聚合成单个 buffer。lifecycle provider 为每个运行中的宿主实例提供 opaque ID，并能判断先前记录的实例是否仍然存活，使 archive session 可以在进程异常退出后接管已发布的工作。两个存储目录根则归各自的 `WikiGraph` 实例所有，并发运行多个实例时不会互相覆盖。

```ts
import { WikiGraph, type File } from "wiki-graph-core";

const wikiGraph = new WikiGraph({ storage });
const outputArchive = myOutputArchiveFile satisfies File;

await wikiGraph.digestTextStreamSession(
  {
    stream: ["Alpha is connected to beta.\n"],
    targetStage: "planned",
    title: "Research note",
  },
  async (archive) => {
    await archive.saveAs(outputArchive);
  },
);

await wikiGraph.openSession(outputArchive, async (archive) => {
  console.log(await archive.readMeta());
});
```

`targetStage: "planned"` 会创建归档，但不会调用 LLM。需要构建 Reading Graph、Summary 或 Knowledge Graph 的阶段必须配置 LLM。

### Source locators

Source text、evidence 与 query 结果专注于可读原文。调用方需要导入文件的
provenance 时，Core 提供与 CLI 相同的独立 locator collection：

```ts
import {
  listArchiveSourceLocators,
  readArchivePage,
  WikiGraphArchiveFile,
} from "wiki-graph-core";

const archiveFile = new WikiGraphArchiveFile(myArchiveFile);
await archiveFile.readDocument(async (document) => {
  const page = await listArchiveSourceLocators(
    document,
    "wikg://chapter/<chapter-path>/source/locators#1..3",
    { limit: 20 },
  );
  const location = await readArchivePage(document, page.items[0]!.uri);
});
```

每个 item 将从 1 开始、闭区间的 Unicode 字符 `range` 映射到 artifact
locator `uri`。URI 的可选 fragment 会先选择 source 句子；分页使用
`nextCursor`。

## LLM 配置

`WikiGraph` 接受任意 AI SDK `LanguageModel`。SDK 不读取 CLI 配置文件；应用需要自己传入模型和运行参数。

```ts
import { createOpenAI } from "@ai-sdk/openai";
import { WikiGraph, type Directory } from "wiki-graph-core";

const openai = createOpenAI({
  apiKey: "<your-openai-api-key>",
});

const wikiGraph = new WikiGraph({
  llm: {
    cacheDirectory: myCacheDirectory satisfies Directory,
    concurrent: 3,
    logDirectory: myLogDirectory satisfies Directory,
    model: openai("gpt-4.1-mini"),
  },
  storage,
});
```

Wiki Graph 不会自动读取 `OPENAI_API_KEY` 或任何 CLI provider 配置。应用负责加载
凭据，并且必须通过 `WikiGraph` 的 `llm` option 传入已配置好的 AI SDK
`LanguageModel`。

## 队列控制

队列控制属于主 SDK，因为应用进程可能需要添加、查看、暂停、恢复、取消和清理任务。

```ts
import { addBuildJob, listBuildJobs } from "wiki-graph-core";

const job = await addBuildJob({
  archivePath: "research.wikg",
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

- [`.wikg` 归档标准](./wikg-standard.md)
- [WikiSpine Runtime](../wikispine-runtime.md)
