<p><a href="../en/quickstart.md">English</a> | 中文</p>

# Quick Start

这份文档面向 SpineDigest 的主要使用方式：直接运行 CLI。

## 1. 环境要求

- Node `>=22.12.0`
- 一个 SpineDigest 支持的 LLM provider

当前支持的 provider：

- `anthropic`
- `google`
- `openai`
- `openai-compatible`

## 2. 安装 CLI

对大多数用户，直接安装发布后的 CLI：

```bash
npm install -g spinedigest
```

如果你只是想临时执行一次，不做全局安装：

```bash
npx spinedigest --help
```

如果你更习惯 `pnpm`：

```bash
pnpm add -g spinedigest
```

## 3. 用于开发的源码 checkout

如果你是在仓库里开发，再克隆源码并安装依赖：

```bash
git clone https://github.com/oomol-lab/spinedigest.git
cd spinedigest
pnpm install
```

## 4. 配置 CLI

SpineDigest 会从以下位置读取配置：

- 默认路径：`~/.spinedigest/config.json`
- 覆盖路径：`SPINEDIGEST_CONFIG`
- 临时 inline LLM JSON：`--llm <json>`

最小配置文件示例：

```json
{
  "llm": {
    "provider": "openai",
    "model": "<your-model>"
  }
}
```

凭据建议优先通过环境变量提供：

```bash
export SPINEDIGEST_LLM_API_KEY="<your-api-key>"
```

如果使用 `openai-compatible`，还必须提供 base URL：

```bash
export SPINEDIGEST_LLM_BASE_URL="https://your-provider.example/v1"
```

如果你的环境更适合写进 `config.json`，也可以把这些字段写入配置文件。

如果只是自动化里临时运行一次，也可以直接传 inline LLM client JSON：

```bash
spinedigest --llm "$LLM_JSON" --input ./book.md --output ./out/digest.md
```

## 5. 跑第一条命令

如果你已经安装好了 CLI，可以直接运行：

```bash
spinedigest --input ./book.md --output ./out/digest.md
```

在源码仓库里，最直接的命令是：

```bash
pnpm dev -- --input ./test/fixtures/sources/sample-observatory-guide.md --output ./out/digest.md
```

执行完成后，可以查看结果：

```bash
cat ./out/digest.md
```

## 6. 常见输出模式

输出纯文本：

```bash
spinedigest --input ./book.epub --output ./digest.txt
```

输出 Markdown：

```bash
spinedigest --input ./book.txt --output ./digest.md
```

输出 EPUB：

```bash
spinedigest --input ./book.md --output ./digest.epub
```

输出可复用的 `.sdpub` 归档：

```bash
spinedigest --input ./book.epub --output ./book.sdpub
```

重新打开已有 `.sdpub` 并再次导出：

```bash
spinedigest --input ./book.sdpub --output ./digest.txt
```

## 7. 通过标准流处理

`stdin` 和 `stdout` 只支持文本格式。

从 `stdin` 读取：

```bash
cat ./chapter.txt | spinedigest --input-format txt --output ./digest.md
```

写到 `stdout`：

```bash
spinedigest --input ./chapter.md --output-format txt
```

双向管道：

```bash
cat ./chapter.txt | spinedigest --input-format txt --output-format markdown
```

## 8. 添加自定义 extraction prompt

如果只是临时跑一次，可以直接传 `--prompt`：

```bash
spinedigest --input ./book.md --output ./digest.md --prompt "Preserve key arguments, named entities, and decisive transitions."
```

如果希望作为长期默认值，可以写进配置：

```json
{
  "prompt": "Preserve key arguments, named entities, and decisive transitions."
}
```

对于主 digest 命令，`--prompt` 会覆盖 `SPINEDIGEST_PROMPT`，后者再覆盖 `config.json`。如果都没有设置，则使用内置默认 prompt。

这个 prompt 会用于处理源文件或文本流时的 digest 过程，不会用于重新打开已有 `.sdpub`。

## 9. 故障排查

如果看到缺少 LLM 配置的错误：

- 确认已经设置 `llm.provider` 和 `llm.model`
- 或者通过 `--llm` 传入 inline LLM 对象
- 确认对应 provider 的 API key 已经可用

如果格式推断失败：

- 添加 `--input-format`
- 添加 `--output-format`

如果省略了 `--input`，但又没有真正通过管道传入内容：

- SpineDigest 会拒绝从交互式 `stdin` 读取
- 请显式提供 `--input <path>`，或者通过管道输入文本

## 下一步

- [CLI Reference](./cli.md)
- [AI Agent Guide](./ai-agents.md)
- [Library Usage](./library.md)
