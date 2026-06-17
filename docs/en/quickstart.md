<p>English | <a href="../zh-CN/quickstart.md">中文</a></p>

# Quick Start

This guide shows the primary SpineDigest workflow: create a `.sdpub` knowledge-base archive, build derived knowledge when needed, then search, browse, read, and export projections from that archive.

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

## 3. Create A Knowledge Base

```bash
spinedigest create ./book.sdpub ./book.epub
cat ./article.md | spinedigest create ./article.sdpub --input-format markdown
```

Create creates or replaces a `.sdpub` archive at source stage. The archive now contains normalized source data, but it is not yet fully graph-built or summarized.

## 4. Inspect And Estimate

```bash
spinedigest status ./book.sdpub
spinedigest index ./book.sdpub
spinedigest estimate ./book.sdpub --stage summary
```

Use the estimate before full-archive graph or summary builds.

## 5. Build Knowledge

```bash
spinedigest build ./book.sdpub --stage graph --confirm
```

For scoped work:

```bash
spinedigest build ./book.sdpub --stage graph --chapter 3 --confirm
```

## 6. Search, Browse, And Read

```bash
spinedigest list ./book.sdpub --type chapter
spinedigest page ./book.sdpub --chapter 3
spinedigest find ./book.sdpub "central argument" --type node
spinedigest page ./book.sdpub --node 84
spinedigest read ./book.sdpub --chapter 3
spinedigest links ./book.sdpub --node 84
spinedigest pack ./book.sdpub --node 84 --budget 5000
```

Use `--type` to choose a search lens: `--type node` for topology, `--type summary` for quick overview, or `--type fragment` for original source wording.

Use `--json` when another tool will consume the output.

## 7. Output A Projection

Use projections when you need a portable view. For example, read one chapter into Markdown text, or export the full archive as an EPUB:

```bash
spinedigest read ./book.sdpub --chapter 3 > ./chapter-3.md
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
