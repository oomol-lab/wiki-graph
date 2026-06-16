<p><a href="../en/quickstart.md">English</a> | 中文</p>

# Quick Start

本文展示 SpineDigest 的 archive-first 主流程。

## 1. 运行要求

- Node `>=22.12.0`
- 只有构建 graph 或 summary 阶段时才需要 LLM provider 凭据

支持的 provider：

- `anthropic`
- `google`
- `openai`
- `openai-compatible`

## 2. 安装 CLI

```bash
npm install -g spinedigest
```

或无需全局安装直接运行：

```bash
npx spinedigest --help
```

## 3. 导入源材料

```bash
spinedigest import ./book.sdpub ./book.md
cat ./article.md | spinedigest import ./article.sdpub --input-format markdown
```

Import 会创建或替换 source 阶段的 `.sdpub` 归档。这不表示归档已经完成 graph 构建或 summary 构建。

## 4. 查看和估算

```bash
spinedigest status ./book.sdpub
spinedigest index ./book.sdpub
spinedigest estimate ./book.sdpub --stage ready
```

整份归档的 graph、summary 或 ready 构建之前，先看 estimate。

## 5. 构建知识

```bash
spinedigest build ./book.sdpub --stage graph --confirm
```

如果只需要局部构建：

```bash
spinedigest build ./book.sdpub --stage graph --chapter 3 --confirm
```

## 6. 搜索和阅读

```bash
spinedigest find ./book.sdpub "central argument"
spinedigest page ./book.sdpub node:84
spinedigest evidence ./book.sdpub node:84
spinedigest links ./book.sdpub node:84
```

输出要交给其他工具消费时，使用 `--json`。

## 7. 导出 projection

```bash
spinedigest export ./book.sdpub --output-format markdown --output ./digest.md
spinedigest export ./book.sdpub --output-format epub --output ./digest.epub
```

## 8. 配置 LLM 构建

运行 LLM-backed build stage 前，创建配置：

```bash
mkdir -p ~/.spinedigest

cat > ~/.spinedigest/config.json <<'JSON'
{
  "llm": {
    "provider": "openai-compatible",
    "model": "your-model",
    "baseURL": "https://your-provider.example/v1",
    "apiKey": "your-api-key"
  }
}
JSON
```

然后验证配置：

```bash
spinedigest status
```

## 下一步

- [CLI Reference](./cli.md)
- [AI Agent Guide](./ai-agents.md)
- [Library Usage](./library.md)
