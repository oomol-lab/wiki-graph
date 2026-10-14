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

## Wikipedia 请求隔离与取消

`archive.page("wikg://entity/Q42/wikipage", { signal })` 和
`wikiGraph.libraries.page(libraryUri, "wikg://entity/Q42/wikipage", { signal })`
会先释放 Archive／Library 本地读取 session，再请求远程 Wikipedia 数据。
远程请求挂起或失败不会阻塞其他本地读取、搜索或写入；本地事务协调机制保持有效。

Wikimedia 解析默认限时 120 秒，覆盖 fetch、响应流、缓存等待及重试。
超时会抛出 `code` 为 `"WIKIMEDIA_TIMEOUT"` 的错误，主动取消则保留 signal 的 reason。
应用应传入自己的取消信号，而不是仅放弃等待外层 Promise：

```ts
const page = await archive.page("wikg://entity/Q42/wikipage", {
  signal: AbortSignal.timeout(15_000),
});
```

## Schema 版本与显式维护

SDK 同步构造不会启动后台 I/O。异步打开 Archive、获取 Library 会在返回对象前
检查版本，后续存储访问也会检查，替换资源不会绕过门禁。Library 注册结构属于
Home schema；获取 Library 不扫描成员，每个成员在实际访问时单独检查 manifest。

普通访问不自动升级旧数据，也不隐式重建缺失或 dirty 的搜索索引。全新 Home 初始化、
中断事务恢复仍保留。升级必须显式 maintenance；派生搜索索引通过
`ensureSearchIndex()` 或 index sync 显式构建。

```ts
import {
  createWikiGraphSDK,
  isWikiGraphSchemaVersionError,
} from "wiki-graph-sdk";

const sdk = createWikiGraphSDK({ stateDir: "/var/lib/my-app/wiki-graph" });
try {
  await sdk.libraries.get("wikg://lib");
} catch (error) {
  if (!isWikiGraphSchemaVersionError(error)) throw error;
  console.error(error.target, error.actualVersion, error.supportedVersion);
  if (error.reason === "upgrade-required") {
    // 提示操作者显式执行 maintenance，不在 catch 里自动升级。
    console.error("需要手动升级 schema", error.target);
  } else {
    console.error("请更新 Wiki Graph 软件以读取较新版本的数据");
  }
} finally {
  sdk.close();
}
```

`WikiGraphSchemaVersionError` 继承 Core 错误体系，稳定 code 为
`schema_version_incompatible`。官方 guard 支持本地实例、重复安装包的实例以及完整保留
code、target、两个版本和 reason 的结构化记录，不依赖错误文案。结构化记录不会恢复
Error 方法和 stack。文件缺失、损坏、权限和数据库 I/O 错误不会归类为版本错误。
只有 `upgrade-required` 表示可手动升级；`newer-version` 要求更新软件。

操作者确认后，可对保留的 `upgrade-required` 错误目标显式调用
`await sdk.maintenance.upgrade(error.target)`。CLI 根据错误目标执行
`wg maintenance upgrade home`、`wg maintenance upgrade <archive-path>` 或
`wg maintenance upgrade <library-uri>`。Home v4 必须先手动升级到 v5；Archive schema
仍为 v5。

目录 Archive 直接读取 manifest 和目标路径。ZIP 查找按需遍历中央目录
（O(文件数)），不保留全量条目内存 map，查询数据库也可能需要物化 SQLite；目录只读查询不复制或哈希整个
数据库。已有搜索缓存也在会话锁保护下直接读取，显式缓存写入保留事务快照。
全量扫描和 sync 是显式操作。绕过 SDK 的外部修改需要 scan/sync 检出，实际访问
的成员仍进行局部检查。

Archive 查询预检读取与同步 revision 绑定的覆盖度摘要。无范围查询不枚举章节；
chapter URI 查询使用同步时生成的路径索引，`skipUnindexed` 在结果 SQL 内筛选
可查询章节。部分 sync 仍保存完整章节拓扑，单独标记已投影和可查询的章节：strict
检查 URI 指向的真实子树，`skipUnindexed` 只筛选查询资格。缺少摘要或完整拓扑标记
的旧派生缓存需要显式 index sync。

## 持久化任务

任务管理器负责创建和查询持久化工作。`WikiGraphJob` 是任务 handle，其生命周期
不依赖任何观察者。

```ts
const job = await wikiGraph.jobs.create({
  archive: { kind: "standalone", path: "/data/research.wikg" },
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

归档目标必须显式声明。游离 WIKG 使用 `{ kind: "standalone", path }`，资料库托管
归档使用 `{ kind: "library", uri }` 和归档 UUID URI。SDK 会拒绝把注册资料库内的
文件声明为游离归档，归档 handle 和快照也不会暴露托管归档的物理路径。

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

自定义 ZIP adapter 必须支持 WIKG 的
`zip.open(file, { entryNameMode: "normalized" })`：归一化名称，按原始名称首次
出现的顺序选择最后一个名称，再读取它最后一次出现的内容。默认/raw 模式保留
EPUB 等容器的精确名称查找。包装 adapter 时必须转发 options，无需全量目录 cache。

自行管理 worker 或清理进程的 Node 应用可以导入 `wiki-graph-sdk/worker` 和
`wiki-graph-sdk/gc`。这些函数在当前进程中执行，不会自行创建或调度进程。两个入口
都会自行安装 Node platform，并可通过 `stateDir` 选用与 `WikiGraphSDK` 实例相同的
状态根目录：

```ts
import { tryRunWikiGraphGc } from "wiki-graph-sdk/gc";
import { runBuildJobWorker } from "wiki-graph-sdk/worker";

await tryRunWikiGraphGc({ dryRun: true, stateDir: "/srv/wiki-graph" });
await runBuildJobWorker({
  concurrency: 2,
  executeJob,
  stateDir: "/srv/wiki-graph",
});
```

省略 `stateDir` 时默认使用 `~/.wikigraph`。存储上下文按每次调用隔离，因此使用不同
状态根目录的并发调用不会相互串用存储。

## 相关文档

- [`.wikg` 归档标准](./wikg-standard.md)
- [WikiSpine Runtime](../wikispine-runtime.md)

## 公共对象与原始检索分数

SDK 统一导出 Core 公共业务模型：`WikiGraphObjectIdentity`、`WikiGraphObject`、
`WikiGraphObjectSummary`、`WikiGraphSearchableSummary`、`WikiGraphObjectListItem`
与 `WikiGraphObjectDetails`。概要仅描述已有投影中的事实，不为了填满类型额外读取
正文、mentions 或证据。`ArchiveFindHit` 将按 `type` 判别的概要与搜索匹配属性组合，
后者包括 `score`、`snippet`、命中词、位置和证据。列表、related 与详情使用同一模型
体系下适合自身的投影；返回值仍是普通对象，不会为每项构造 class 实例。

`archive`／`chapter` 是 scope 投影，`archive-title`／`chapter-title` 才是对应的
标题 object。reading graph 的 chunk 保留历史判别值 `type: "node"`，公共类型名为
`WikiGraphChunkSummary`／`WikiGraphChunkDetails`，标识符仍使用 chunk URI。

```ts
import type { ArchiveFindHit, WikiGraphTripleSummary } from "wiki-graph-sdk";

function inspectHit(hit: ArchiveFindHit) {
  if (hit.type === "triple") {
    const triple: WikiGraphTripleSummary = hit;
    console.log(triple.triple.predicate); // 收窄后是必有字段
  } else if (hit.type === "source" || hit.type === "summary") {
    console.log(hit.score, hit.ftsScore, hit.embeddingScore);
  }
  for (const evidence of hit.evidence?.sources ?? []) {
    console.log(evidence.ftsScore, evidence.embeddingScore);
  }
}

const hits = await archive.search("查询内容", { sourceContext: 0 });
for (const hit of hits) inspectHit(hit);
const evidence = await archive.evidence("wikg://entity/Q1", {
  query: "查询内容",
  sourceContext: 0,
});
for (const source of evidence)
  console.log(source.ftsScore, source.embeddingScore);
```

原始分数只出现在 source／summary 的句子搜索命中，以及可以明确对应单个命中句子的
source evidence 上。Entity、Triple、Chunk 自身不提供或聚合它们；无 query 的普通
证据枚举没有分数。Archive、Library、首屏及 cursor 翻页遵循相同规则。多个命中句子
或 segment 合并为展示范围时，省略原始分数，不任意取一项代表整段。单次命中周围的
context 仅用于展示，其分数依旧指向该次命中。

当前 `ftsScore` 是 SQLite BM25 原始值，越小越好；BM25 跨查询不能作为统一绝对
阈值。`embeddingScore` 是 cosine similarity 原始值，越大越相似；句子继承所属
embedding segment 的分数，并非独立计算的单句分数。重叠 segment 沿用既有排名
选取规则。Cosine 与模型、切分有关。缺失通道为 `undefined`，不能当成 0；真实的
零值会保留。这些字段仅供参考，不是命中概率，也没有增加阈值过滤 API。将来更换
算法需要同步更新此处说明。最终 `score`、召回、四桶排序、证据排序和分页不变，
CLI 不对外暴露这些 SDK 字段。
