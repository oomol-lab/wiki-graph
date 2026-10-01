[English](../en/sdk.md) | 中文

# Node.js SDK

`wiki-graph-sdk` 是 `wg` CLI 背后的程序化交付包。Node.js 应用如果需要使用与
CLI 相同的本地配置、library、文件系统默认实现和持久化任务，但不希望拼接命令或
解析 stdout，应使用这个包。

```bash
$ npm install wiki-graph-sdk
```

该包要求 Node.js `>=22.12.0`，并依赖运行时无关的 `wiki-graph-core`；应用无需再
单独安装 Core。

## 运行实例

每个应用运行上下文创建一个实例。测试和嵌入式应用应显式传入选项；默认值与 CLI
的 Node 环境一致。

```ts
import { createWikiGraphSDK } from "wiki-graph-sdk";

const wikiGraph = createWikiGraphSDK({
  cwd: process.cwd(),
  stateDir: "/var/lib/my-app/wiki-graph",
});

await wikiGraph.config.put("concurrent", "job", 2);
const libraries = await wikiGraph.libraries.list();
const jobs = await wikiGraph.jobs.list({ activeOnly: true });

wikiGraph.close();
```

SDK 暴露逐项、类型化的方法和 class 实例，并且有意不提供
`execute(command, args)`。argv 解析、help、终端 remediation、退出码以及
JSON/JSONL 渲染属于 `wiki-graph`。

## 持久化任务

任务管理器负责创建和查询持久化工作。`WikiGraphJob` 是任务 handle，其生命周期
不依赖任何观察者。

```ts
const job = await wikiGraph.jobs.create({
  archive: "/data/research.wikg",
  chapterId: 12,
  target: "reading-summary",
});

const unsubscribe = job.subscribe((event) => console.log(event));
await job.pause();
await job.resume();
console.log(await job.status());

unsubscribe(); // 只停止当前观察者，不会取消持久化任务。
await job.cancel(); // 显式取消任务。
```

事件也可以作为 async iterable 读取，并支持 `AbortSignal`：

```ts
for await (const event of job.events({ signal })) console.log(event);
```

`wikiGraph.config` 读写与 CLI 相同的本地配置，`wikiGraph.libraries` 返回类型化的
library 实例。SDK 返回对象，而不是序列化 JSON 或终端文本。

## 其他 JavaScript 宿主使用 Core

只有在实现浏览器、Chrome extension 等运行时适配器时，才应直接使用
`wiki-graph-core`。Core 不依赖 Node，也不负责本地配置发现、文件系统路径、CLI
help 或终端文案。宿主通过 `WikiGraphPlatform` 提供 `File`、`Directory`、数据库、
ZIP、模板、异步上下文和生命周期实现。

```ts
import {
  installWikiGraphPlatform,
  WikiGraph,
  type Directory,
  type ReadonlyFile,
  type WikiGraphPlatform,
} from "wiki-graph-core";

installWikiGraphPlatform(myPlatform satisfies WikiGraphPlatform);
const wikiGraph = new WikiGraph({
  storage: {
    library: myLibraryDirectory satisfies Directory,
    documentStore: myDocumentDirectory satisfies Directory,
  },
});

await wikiGraph.openSession(
  myArchiveFile satisfies ReadonlyFile,
  async (archive) => console.log(await archive.readMeta()),
);
```

浏览器适配器可以使用 OPFS、IndexedDB 或其他受限存储实现这些 capability。Core
把资源 identity 当作不透明协调键，并把 ZIP 与数据库访问留在宿主 provider 后面。

自行管理 worker 或清理进程的 Node 应用可以导入 `wiki-graph-sdk/worker` 和
`wiki-graph-sdk/gc`。这些函数在当前进程中执行，不会自行创建或调度进程。

## 相关文档

- [`.wikg` 归档标准](./wikg-standard.md)
- [WikiSpine Runtime](../wikispine-runtime.md)
