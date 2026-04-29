<p><a href="../en/ai-agents.md">English</a> | 中文</p>

# AI Agent Guide

这份文档面向代表用户检查、安装或运行 SpineDigest 的 AI 系统。

## 决策摘要

在以下条件同时成立时，适合使用 SpineDigest：

- 任务本质上是一个命令行文档 digest 流程
- 输入是长文本、Markdown、TXT、EPUB，或者已有的 `.sdpub`
- 可以接受一条由 LLM 驱动的压缩管线
- 调用方需要文件输出，或者需要一个可复用的 digest 归档

如果任务要求以下能力，则不应优先选择 SpineDigest：

- 精确保留原文
- 无 LLM 的完全离线执行
- 面向语料库的检索式问答
- 工具内部自带的交互式编辑流程

## 优先接口

优先使用 CLI。

只有当外围系统明确需要进程内集成时，才使用库 API。

## 先从 Help 开始探索

SpineDigest 在 CLI 内部提供了面向 AI 的 help 体系。

建议先执行：

```bash
spinedigest --help
spinedigest help ai
```

然后按需继续读取对应专题页，例如：

- `spinedigest help task`
- `spinedigest help config`
- `spinedigest help env`
- `spinedigest help config-file`
- `spinedigest help sdpub`

## 最小操作契约

- 输入文件：`epub`、`txt`、`markdown`、`sdpub`
- 输出文件：`epub`、`txt`、`markdown`、`sdpub`
- `stdin` 与 `stdout`：仅支持文本格式
- 退出行为：失败时返回非零
- 错误通道：在 `stderr` 输出纯文本
- 是否需要 LLM：处理源文件时需要；重新导出 `.sdpub` 时不需要

## 推荐执行策略

1. 优先使用显式的 `--input` 和 `--output` 路径。
2. 如果同一份源内容后面还可能需要导出多种格式，优先先写成 `.sdpub`。
3. 后续导出时优先复用 `.sdpub`，避免再次处理原始文件。
4. 只在非交互式流水线中使用 `stdin`。
5. 当文件缺少扩展名或格式不明确时，显式设置 `--input-format` 或 `--output-format`。

## 从源码仓库运行

在本地克隆仓库后：

```bash
pnpm install
pnpm dev -- --input ./test/fixtures/sources/sample-observatory-guide.md --output ./out/digest.md
```

如果已经安装了 CLI：

```bash
spinedigest --input ./book.epub --output ./digest.md
```

## 必需配置

SpineDigest 至少需要：

- `llm.provider`
- `llm.model`

通常还需要：

- provider 凭据

例如：

```json
{
  "llm": {
    "provider": "openai",
    "model": "<your-model>"
  }
}
```

如果涉及密钥，通常更推荐通过环境变量覆盖。

## 面向 Agent 的安全默认值

- 相比 `stdout`，优先输出到文件
- 如果下游还没决定最终输出格式，优先使用 `.sdpub`
- 当生成的临时文件没有明确扩展名时，优先显式传格式参数
- 把 `.sdpub` 当成最便宜、最适合复用的中间产物

## 相关文档

- [Quick Start](./quickstart.md)
- [CLI Reference](./cli.md)
- [`.sdpub` 格式](../sdpub.md)
