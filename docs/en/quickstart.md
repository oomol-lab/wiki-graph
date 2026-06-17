<p>English | <a href="../zh-CN/quickstart.md">中文</a></p>

# Quick Start

This guide shows the primary archive-first SpineDigest workflow.

## 1. Requirements

- Node `>=22.12.0`
- LLM provider credentials only when building graph or summary stages

Supported providers:

- `anthropic`
- `google`
- `openai`
- `openai-compatible`

## 2. Install The CLI

```bash
npm install -g spinedigest
```

Or run without global install:

```bash
npx spinedigest --help
```

## 3. Import A Source

```bash
spinedigest import ./book.sdpub ./book.md
cat ./article.md | spinedigest import ./article.sdpub --input-format markdown
```

Import creates or replaces a `.sdpub` archive at source stage. It does not mean the archive is fully graph-built or summarized.

## 4. Inspect And Estimate

```bash
spinedigest status ./book.sdpub
spinedigest index ./book.sdpub
spinedigest estimate ./book.sdpub --stage ready
```

Use the estimate before full-archive graph, summary, or ready builds.

## 5. Build Knowledge

```bash
spinedigest build ./book.sdpub --stage graph --confirm
```

For scoped work:

```bash
spinedigest build ./book.sdpub --stage graph --chapter 3 --confirm
```

## 6. Search And Read

```bash
spinedigest list ./book.sdpub --type chapter
spinedigest page ./book.sdpub chapter:3
spinedigest find ./book.sdpub "central argument" --type node
spinedigest page ./book.sdpub node:84
spinedigest links ./book.sdpub node:84
```

Use untyped `find` for broad candidate discovery. For content understanding, choose a search lens: `--type node` for topology, `--type summary` for quick overview, or `--type fragment` for original source wording.

Use `--json` when another tool will consume the output.

## 7. Export A Projection

```bash
spinedigest export ./book.sdpub --output-format markdown --output ./digest.md
spinedigest export ./book.sdpub --output-format epub --output ./digest.epub
```

## 8. Configure LLM Builds

Create config before running LLM-backed build stages:

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

Then verify configuration:

```bash
spinedigest status
```

## Next

- [CLI Reference](./cli.md)
- [AI Agent Guide](./ai-agents.md)
- [Library Usage](./library.md)
