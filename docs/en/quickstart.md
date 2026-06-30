<p>English | <a href="../zh-CN/quickstart.md">中文</a></p>

# Quick Start

This guide shows the primary SpineDigest workflow: create a `.sdpub` knowledge-base archive, build derived knowledge when needed, then search, browse, read, and export projections from that archive.

## 1. Requirements

- Node `>=22.12.0`
- LLM provider credentials only when building Reading Graph, Reading Summary, or Knowledge Graph tasks

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
wikigraph wkg://book.sdpub create ./book.epub
cat ./article.md | wikigraph wkg://article.sdpub create --input-format markdown
```

Create creates or replaces a `.sdpub` archive at source stage. The archive now contains normalized source data, but generated Reading Graph, Reading Summary, and Knowledge Graph data are still absent.

## 4. Inspect And Estimate

```bash
wikigraph wkg://book.sdpub/state get
wikigraph wkg://book.sdpub/chapter/tree get
wikigraph wkg://book.sdpub estimate --stage reading-summary
```

Use the estimate before queueing broad Reading Graph, Reading Summary, or Knowledge Graph work.

## 5. Build Knowledge

```bash
wikigraph wkg://book.sdpub/chapter/3 queue add --task reading-graph --accept-cost
wikigraph wkg-job://<job-id> watch --jsonl
```

For Reading Summary work:

```bash
wikigraph wkg://book.sdpub/chapter/3 queue add --task reading-summary --accept-cost
wikigraph wkg-job:// list --input wkg://book.sdpub
```

## 6. Search, Browse, And Read

```bash
wikigraph wkg://book.sdpub/chapter/tree get --json
wikigraph wkg://book.sdpub/chunk search "central argument"
wikigraph wkg://book.sdpub/chapter/3 get
wikigraph wkg://book.sdpub/chunk/84 get
wikigraph wkg://book.sdpub/chunk/84 related
wikigraph wkg://book.sdpub/chunk/84 evidence
wikigraph wkg://book.sdpub/chunk/84 pack --budget 5000
```

Use URI lenses to choose a search target: `<archive-uri>/chunk` for Reading Graph structure, `<archive-uri>/summary` for quick overview, `<archive-uri>/source` for original source wording, or `<archive-uri>/entity` and `<archive-uri>/triple` for Knowledge Graph objects.

Object commands use Wiki Graph URIs. Read `wikigraph help uri` when constructing URIs manually.

Use `--json` when another tool will consume the output.

## 7. Output A Projection

Use projections when you need a portable view. For example, read one chapter into Markdown text, or export the full archive as an EPUB:

```bash
wikigraph wkg://book.sdpub/chapter/3/source get > ./chapter-3.md
wikigraph wkg://book.sdpub export --output-format epub --output ./digest.epub
```

## 8. Configure LLM Builds

Create config before running LLM-backed build stages:

```bash
mkdir -p ~/.wikigraph

cat > ~/.wikigraph/config.json <<'JSON'
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
wikigraph config status
```

## Next

- [CLI Reference](./cli.md)
- [AI Agent Guide](./ai-agents.md)
- [Library Usage](./library.md)
