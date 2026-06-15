<p><a href="../en/cli.md">English</a> | 中文</p>

# CLI Reference

SpineDigest 的设计重心是命令行使用。

## 命令形式

已安装 CLI 时：

```bash
spinedigest [--input <path>] [--output <path>] [--input-format <format>] [--output-format <format>] [--digest-dir <path>] [--llm <json>] [--prompt <text>] [--stage <stage>] [--verbose]
spinedigest --version
spinedigest status [--llm <json>]
spinedigest sdpub <info|toc|list|cat|cover|meta> --input <path> [--chapter <id>] [--json] [--llm <json>]
spinedigest sdpub stage <pending|advance> <path> [--to <stage>] [--chapter <id>] [--prompt <text>] [--llm <json>]
spinedigest sdpub chapter <list|status|add|remove|reset|set-source|set-summary> <path> [options]
spinedigest sdpub graph <status|log|show|grep|neighbors|blame|path> <path> --chapter <id> [options]
```

在源码仓库中运行时：

```bash
pnpm dev -- [--input <path>] [--output <path>] [--input-format <format>] [--output-format <format>] [--digest-dir <path>] [--llm <json>] [--prompt <text>] [--stage <stage>] [--verbose]
pnpm dev -- --version
pnpm dev -- status [--llm <json>]
pnpm dev -- sdpub <info|toc|list|cat|cover|meta> --input <path> [--chapter <id>] [--json] [--llm <json>]
pnpm dev -- sdpub stage <pending|advance> <path> [--to <stage>] [--chapter <id>] [--prompt <text>] [--llm <json>]
pnpm dev -- sdpub chapter <list|status|add|remove|reset|set-source|set-summary> <path> [options]
pnpm dev -- sdpub graph <status|log|show|grep|neighbors|blame|path> <path> --chapter <id> [options]
```

## 参数

- `--input <path>`：输入文件路径
- `--output <path>`：输出文件路径
- `--input-format <format>`：显式指定输入格式
- `--output-format <format>`：显式指定输出格式
- `--digest-dir <path>`：保留 digest 中间工作目录；每次运行前会先清空该目录
- `--llm <json>`：为当前这次调用传入 inline LLM client JSON
- `--prompt <text>`：为当前这次 digest 临时覆盖 extraction prompt
- `--stage <stage>`：把 `.sdpub` 输出生成到 `planned`、`sourced`、`graphed` 或 `summarized`
- `--json`：把 `sdpub list` 输出为结构化 JSON
- `--limit <n>`：限制 `sdpub graph log` 的输出数量
- `--verbose`：把诊断日志输出到 `stderr`
- `--version`：打印已安装包版本
- `-h`, `--help`：打印帮助文本

主转换命令不支持 positional arguments。

没有 subcommand 的 `spinedigest` 是便捷 digest/export 命令。它从 `--input <path>` 或 stdin 读取，并写入 `--output <path>` 或 stdout。在交互式终端中，裸 `spinedigest` 会打印 help，而不是尝试 digest stdin。

`sdpub` 接口本身使用 positional subcommands：`spinedigest sdpub <subcommand>`。

偏读取的 `sdpub` 子命令使用 `--input`，其中 `cat` 还要求提供 `--chapter`，`meta` 额外接受 metadata 编辑参数。`sdpub stage`、`sdpub chapter` 和 `sdpub graph` 会把归档路径作为 positional argument。

`--prompt` 影响从源输入生成 digest 的过程，也会影响 `spinedigest sdpub stage advance` 中的 graph 生成。

`--llm` 会覆盖环境变量和 `config.json` 中的 LLM 设置。不调用 LLM 的命令路径也接受这个参数，方便 wrapper 脚本统一传参。

## 支持的格式

支持以下格式：

- `sdpub`
- `epub`
- `txt`
- `markdown`

如果没有显式传格式参数，SpineDigest 会根据文件扩展名推断格式。

扩展名映射：

- `.sdpub` -> `sdpub`
- `.epub` -> `epub`
- `.txt` -> `txt`
- `.md` 或 `.markdown` -> `markdown`

## 标准流规则

当省略 `--input` 时：

- SpineDigest 会从 `stdin` 读取
- 仅支持 `txt` 和 `markdown`
- 交互式 `stdin` 会被拒绝

当省略 `--output` 时：

- SpineDigest 会写到 `stdout`
- 仅支持 `txt` 和 `markdown`
- 不能同时使用 `--verbose`

## 调试日志

- 默认情况下，CLI 不向终端输出诊断日志。
- 传入 `--verbose` 后，诊断日志会写到 `stderr`。
- 如果配置了 `paths.debugLogDir`，每次运行会在该目录下创建 `<runId>/`，其中包含：
  - `events.log`：可直接阅读的事件日志
  - `artifacts/llm/`：LLM 请求日志
  - `artifacts/editor/`：压缩过程日志

## 常见命令

把 EPUB 压缩为 Markdown：

```bash
spinedigest --input ./book.epub --output ./digest.md
```

把文本文件压缩为 EPUB：

```bash
spinedigest --input ./book.txt --output ./digest.epub
```

生成 `.sdpub` 归档：

```bash
spinedigest --input ./book.md --output ./book.sdpub
```

生成不触发 LLM 的 staged `.sdpub` 归档：

```bash
spinedigest --input ./book.epub --output ./book.sdpub --stage sourced
```

复用已有 `.sdpub`：

```bash
spinedigest --input ./book.sdpub --output ./digest.txt
```

检查 `.sdpub` 归档：

```bash
spinedigest sdpub info --input ./book.sdpub
spinedigest sdpub toc --input ./book.sdpub
spinedigest sdpub list --input ./book.sdpub
spinedigest sdpub cat --input ./book.sdpub --chapter 12
spinedigest sdpub cover --input ./book.sdpub > ./cover.png
spinedigest sdpub meta --input ./book.sdpub
spinedigest sdpub stage pending ./book.sdpub
spinedigest sdpub chapter list ./book.sdpub
```

编辑并推进 `.sdpub` 归档：

```bash
spinedigest sdpub chapter add ./book.sdpub --title "Appendix"
spinedigest sdpub chapter set-source ./book.sdpub --chapter 3 --input ./appendix.md --input-format markdown
spinedigest sdpub stage advance ./book.sdpub --to summarized
```

通过管道处理：

```bash
cat ./chapter.txt | spinedigest --input-format txt --output-format markdown
```

临时覆盖 extraction prompt：

```bash
spinedigest --input ./book.md --output ./digest.md --prompt "Preserve named entities and decisive transitions."
```

临时传入 LLM client JSON：

```bash
spinedigest --llm "$LLM_JSON" --input ./book.md --output ./digest.md
```

## 配置

默认配置路径：

```text
~/.spinedigest/config.json
```

覆盖路径：

```text
SPINEDIGEST_CONFIG
```

配置字段：

```json
{
  "llm": {
    "provider": "openai",
    "model": "<your-model>",
    "apiKey": "<optional>",
    "baseURL": "<optional>",
    "name": "<optional>"
  },
  "paths": {
    "cacheDir": "<optional>",
    "debugLogDir": "<optional>"
  },
  "prompt": "<optional>",
  "request": {
    "concurrent": 2,
    "retryIntervalSeconds": 2,
    "retryTimes": 1,
    "temperature": 0.7,
    "timeout": 60000,
    "topP": 0.9
  }
}
```

`request.timeout` 的单位是毫秒。

Inline LLM JSON 可以直接是 LLM 对象，也可以包含一个 `llm` 字段。它支持 `provider`、`model`、`apiKey`、`baseURL`、`baseUrl`、`chatCompletionsUrl` 和 `name`。如果省略 `provider` 但提供了 base URL，则按 `openai-compatible` 处理。

```json
{
  "model": "<your-model>",
  "apiKey": "<optional>",
  "baseUrl": "https://your-provider.example/v1"
}
```

对于主 digest 命令，`--prompt` 的优先级最高，只影响当前这次运行。否则，`SPINEDIGEST_PROMPT` 会覆盖 `config.json`，再没有时使用内置默认 prompt。

对于 LLM 设置，`--llm` 会覆盖 `SPINEDIGEST_LLM_*` 环境变量，后者再覆盖 `config.json`。

## 环境变量

SpineDigest 支持通过环境变量覆盖配置值：

- `SPINEDIGEST_CONFIG`
- `SPINEDIGEST_PROMPT`
- `SPINEDIGEST_LLM_PROVIDER`
- `SPINEDIGEST_LLM_MODEL`
- `SPINEDIGEST_LLM_BASE_URL`
- `SPINEDIGEST_LLM_NAME`
- `SPINEDIGEST_LLM_API_KEY`
- `SPINEDIGEST_CACHE_DIR`
- `SPINEDIGEST_DEBUG_LOG_DIR`
- `SPINEDIGEST_REQUEST_CONCURRENT`
- `SPINEDIGEST_REQUEST_TIMEOUT`
- `SPINEDIGEST_REQUEST_RETRY_TIMES`
- `SPINEDIGEST_REQUEST_RETRY_INTERVAL_SECONDS`
- `SPINEDIGEST_REQUEST_TEMPERATURE`
- `SPINEDIGEST_REQUEST_TOP_P`

`openai-compatible` 必须通过 `--llm`、配置或 `SPINEDIGEST_LLM_BASE_URL` 提供 base URL。

## `.sdpub` 行为

`.sdpub` 是处理后 digest 文档的可移植归档格式。它在物理上是 ZIP 文件，但常规自动化应把它视为由 SpineDigest 管理的文档，通过 `spinedigest sdpub ...` 命令操作，而不是直接编辑 ZIP 内部文件。

当输入是 `.sdpub` 时：

- SpineDigest 会直接打开已经保存的 digest 状态
- 不需要 LLM 配置
- 如果归档已经 summarized，可以导出为 `.txt`、`.md` 或 `.epub`
- 也可以通过 `spinedigest sdpub ...` 检查元信息、TOC、章节树、封面数据、未完成章节和章节阶段

当输出是 `.sdpub` 时：

- SpineDigest 会保存这份处理后的 digest 文档，以便后续复用
- `--stage planned|sourced|graphed|summarized` 控制归档预先处理到哪个阶段

章节阶段：

- `planned`：章节已经存在于 TOC，但还没有原文
- `sourced`：已经保存规范化后的原文
- `graphed`：已经保存 graph 数据，但还没有最终摘要
- `summarized`：已经有最终摘要，可以重新导出或用 `sdpub cat` 读取

归档模型、阶段生命周期、id 规则、原地修改安全性和命令路由，见 `spinedigest help sdpub`。

## 失败场景

在以下情况下，你可以预期看到 `stderr` 的纯文本错误信息和非零退出码：

- 无法推断输入格式
- 无法推断输出格式
- 对非文本格式使用了 `stdin` 或 `stdout`
- 在写入 `stdout` 时同时使用了 `--verbose`
- digest 操作缺少 LLM 配置
- `spinedigest sdpub cat` 缺少 `--chapter`
- `sdpub` 子命令使用了不支持的参数，例如 `--output`、`--output-format`、`--prompt` 或 `--verbose`
- `spinedigest sdpub cover` 试图向交互式终端输出二进制数据
- `spinedigest sdpub cover` 针对一个没有封面的归档运行
- `.sdpub` 重新导出或 `sdpub cat` 的目标章节还没有 summarized
- provider 相关配置不合法

## 相关文档

- [Quick Start](./quickstart.md)
- [AI Agent Guide](./ai-agents.md)
- [Library Usage](./library.md)
