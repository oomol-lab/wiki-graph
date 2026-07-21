[English](../en/wikg-standard.md) | 中文

# `.wikg` 归档标准

本文档定义公开的 `.wikg` 归档布局。它说明 `.wikg` 文件是什么、内部可以出现哪些文件、这些文件分别表示什么，以及 reader 和 writer 应遵守哪些兼容性规则。

这是一份格式标准，不是 CLI 教程。命令语法请使用 CLI help。

## Container

`.wikg` 文件是一个使用 `.wikg` 文件扩展名的 ZIP 归档。

归档 entry 路径必须使用 `/` 分隔符，并且必须是相对路径。Reader 会通过裁剪空白、把 `\` 转成 `/`、移除开头的 `/`、折叠 `.` 路径段来归一化传入的 ZIP entry 名。标准 reader 会忽略 `.wikg` 白名单之外的 entry，标准 writer 也不会保留这些 entry。

当前标准 writer 以不压缩方式存储 ZIP entry。标准 reader 接受 stored ZIP entry 和 deflated ZIP entry。

## Entry Table

只有以下归档 entry 属于标准布局：

| Entry                          | Required | Type            | Meaning                                         |
| ------------------------------ | -------- | --------------- | ----------------------------------------------- |
| `.wikg-mutation-token`         | Yes      | UTF-8 text      | 归档 mutation token。必须是第一个 ZIP entry。   |
| `manifest.json`                | Yes      | JSON            | 归档格式 manifest。                             |
| `database.db`                  | Yes      | SQLite database | 主文档、图谱、元数据和 readiness 数据库。       |
| `toc.json`                     | No       | JSON            | 章节树。                                        |
| `cover/info.json`              | No       | JSON            | 封面元数据。                                    |
| `cover/data.bin`               | No       | Binary          | 封面二进制内容。存在 `cover/info.json` 时必需。 |
| `texts/source/<serialId>.txt`  | No       | UTF-8 text      | 某个 chapter serial 的 source text stream。     |
| `texts/summary/<serialId>.txt` | No       | UTF-8 text      | 某个 chapter serial 的 summary text stream。    |
| `fts.db`                       | No       | SQLite database | 内嵌全文搜索索引。                              |

当前没有其他标准 entry。非标准 entry 的例子包括 SQLite journal 文件、任意 JSON sidecar，以及 `texts/source/` 或 `texts/summary/` 之外的文本文件。

## Required Entries

### `.wikg-mutation-token`

`.wikg-mutation-token` 必须是第一个 ZIP entry。它的内容是 UTF-8 文本：

```text
wikg-mutation-token:v1
<token>
```

标准 writer 会以换行结尾。Reader 必须校验 magic line 和 token line，可以接受带有或不带最终结尾换行的 payload。`<token>` 是一个 43 字符的 base64url 字符串，匹配：

```text
[A-Za-z0-9_-]{43}
```

Writer 每次重写归档时都必须刷新这个 token。Reader 使用它检测归档 mutation，并协调缓存的 materialization。

### `manifest.json`

`manifest.json` 标识归档格式版本。当前格式的完整 JSON 形状是：

```json
{
  "formatVersion": 1
}
```

Reader 必须拒绝缺少 `manifest.json` 的归档、`manifest.json` 中包含无效 JSON 的归档，以及 `formatVersion` 不受支持的归档。

### `database.db`

`database.db` 是主 SQLite 数据库。它拥有归档的结构化状态，包括：

- chapter serial records 和 revision state；
- Reading Graph chunks、edges、snakes 和 sentence groups；
- Knowledge Graph mentions、mention links、entity projections、triple projections 和 evidence references；
- object metadata，包括 archive-level book metadata；
- generation parameter hashes 和 readiness state；
- index embedding policy。

Book metadata 不存为顶层 `meta.json` 文件。它作为 archive-level object metadata 存在 `database.db` 中。

Schema 是当前 reader 和 writer 的实现契约的一部分。外部工具应优先使用公开 CLI/API 访问，而不是直接修改这个数据库。

## Optional Entries

### `toc.json`

`toc.json` 存储章节树。当前 JSON 形状是：

```json
{
  "version": 1,
  "items": [
    {
      "title": "Chapter title",
      "serialId": 1,
      "children": []
    }
  ]
}
```

规则：

- `version` 必须是 `1`。
- `items` 是 chapter tree node 数组。
- `title` 可选，可以是 `null`。
- `serialId` 可选；存在时必须是非负整数。
- 每个 node 都必须有 `children`，并且它是 child node 数组。
- `serialId` 把 TOC node 关联到同一个 chapter serial 的 source、summary、database rows 和 generated graph state。

### `cover/info.json` and `cover/data.bin`

封面由一个元数据文件和一个二进制 payload 表示。归档不会在封面原始内部路径上保留封面。相反，原始或逻辑路径记录在 `cover/info.json` 中，字节内容存储在 `cover/data.bin` 中。

`cover/info.json` 的形状是：

```json
{
  "mediaType": "image/png",
  "path": "cover.png"
}
```

规则：

- `mediaType` 是非空 MIME type 字符串。
- `path` 是原始或逻辑封面路径字符串。
- `cover/data.bin` 包含对应的二进制 payload。
- 如果存在 `cover/info.json`，也必须存在 `cover/data.bin`。

提取封面时，读取并校验 `cover/info.json`，再把 `cover/data.bin` 复制到目标输出路径。使用 `mediaType` 选择或校验文件类型，只把 `path` 用作来源元数据或建议逻辑名。不要在 `.wikg` 归档内部的 `cover/info.json.path` 位置寻找封面图片。

当 `cover/info.json` 不存在时，归档没有封面。这种情况下 `cover/data.bin` 也应不存在。如果存在 `cover/info.json` 但缺少 `cover/data.bin`，这是封面 entry 损坏，而不是没有封面。

### `texts/source/<serialId>.txt`

Source streams 以 UTF-8 文本文件形式存储在 `texts/source/` 下。

路径规则：

- `<serialId>` 是十进制 chapter serial id。
- 文件名必须精确等于 `<serialId>.txt`。
- `texts/source/` 下的非数字文件名不是标准 entry。

Source stream 是事实 grounding layer。生成的 graph objects 和 summaries 应能追溯回从这些文件派生出的 source sentence ranges。

### `texts/summary/<serialId>.txt`

Summary streams 以 UTF-8 文本文件形式存储在 `texts/summary/` 下。

路径规则和 source streams 相同：文件名必须是 `<serialId>.txt`，其中 `<serialId>` 是十进制 chapter serial id。

Summaries 是生成投影。它们不会替代 source text 作为 grounding layer。

### `fts.db`

`fts.db` 是可选的 SQLite 全文搜索索引。

只有当归档 index policy 标记搜索索引为 embedded 时，writer 才会包含 `fts.db`。否则，搜索索引可以作为本地 cache 存在，并且不得被视为必需归档内容。

Reader 必须能打开不包含 `fts.db` 的归档。缺失或过期的搜索索引状态应作为 readiness 信息处理，而不是归档损坏。

## Path Whitelist

标准 reader 和 writer 只识别这些路径模式：

```text
.wikg-mutation-token
manifest.json
database.db
fts.db
toc.json
cover/data.bin
cover/info.json
texts/source/<digits>.txt
texts/summary/<digits>.txt
```

Writer 不得包含临时 SQLite 文件，例如：

```text
database.db-journal
database.db-wal
database.db-shm
fts.db-journal
fts.db-wal
fts.db-shm
```

除非未来格式版本把任意 sidecar 文件加入标准，否则 writer 不得包含它们。

## Ordering

`.wikg-mutation-token` 必须是第一个 ZIP entry。

在这个 entry 之后，标准 writer 按字典序排列归档路径。除 mutation token 外，reader 不得依赖 entry 的字典序。

## Read Compatibility

符合标准的 reader 应该：

- 要求 `.wikg-mutation-token` 是第一个 entry；
- 要求支持的 `manifest.json`；
- 忽略非标准 entry 路径；
- 拒绝不支持的 ZIP 压缩方法；
- 接受缺少 optional entries 的归档；
- 把 `fts.db` 视为可选；
- 使用 JSON entry 前先校验；
- 提取归档 entry 时防止 path traversal。

## Write Compatibility

符合标准的 writer 应该：

- 首先写入 `.wikg-mutation-token`；
- 用当前支持的格式版本写入 `manifest.json`；
- 只包含标准 entry 路径；
- 每次重写归档时刷新 `.wikg-mutation-token`；
- 省略临时数据库文件；
- 只有归档声明内嵌搜索索引时才包含 `fts.db`；
- 以 UTF-8 保留 source 和 summary text；
- 保持 `database.db` 与 `toc.json`、text stream serial ids 一致。

## Semantic Layers

文件布局很小，但归档承载多个语义层：

- Source layer：`texts/source/*.txt`、chapter serials 和 source sentence records。
- Reading Graph：`database.db` 中的 chunks、reading edges、snakes 和 sentence groups。
- Knowledge Graph：`database.db` 中的 mentions、mention links、entity projections、triple projections 和 evidence references。
- Summary layer：`texts/summary/*.txt` 加上 summary sentence records。
- Search layer：可选的 `fts.db` 和 `database.db` 中的 index settings。
- Metadata layer：`database.db` 中的 archive、chapter、chunk、entity 和 triple metadata，以及可选 cover files。

Reading Graph objects 和 Knowledge Graph objects 是不同层。Chunks 是阅读单元；entities 和 triples 是知识对象。Source text 是两者共同的 grounding layer。

## Versioning

当前 `.wikg` 格式版本是 `1`。

未来不兼容的布局变化必须递增 `manifest.json` 的 `formatVersion`。不理解某个 format version 的 reader 必须拒绝归档，而不是猜测如何解释它。

只有当旧 reader 可以安全忽略时，才可以引入兼容新增项。因为当前标准 reader 会忽略白名单之外的 entry，新的标准 entry 需要 reader 更新或格式版本变化，具体取决于旧 reader 在重写时是否可以安全丢弃它们。

## 相关文档

- [WikiSpine Runtime Guide](../wikispine-runtime.md)
- [README_zh-CN](../../README_zh-CN.md)
