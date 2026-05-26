<p>English | <a href="../zh-CN/quickstart.md">中文</a></p>

# Quick Start

This guide is for the primary SpineDigest workflow: running the CLI directly.

## 1. Requirements

- Node `>=22.12.0`
- access to an LLM provider supported by SpineDigest

Supported providers:

- `anthropic`
- `google`
- `openai`
- `openai-compatible`

## 2. Install The CLI

For most users, install the published CLI:

```bash
npm install -g spinedigest
```

If you prefer a one-off run without a global install:

```bash
npx spinedigest --help
```

If you prefer `pnpm`:

```bash
pnpm add -g spinedigest
```

## 3. Source Checkout For Development

If you are developing against the repository itself, clone it and install dependencies:

```bash
git clone https://github.com/oomol-lab/spinedigest.git
cd spinedigest
pnpm install
```

## 4. Configure The CLI

SpineDigest reads configuration from:

- default path: `~/.spinedigest/config.json`
- override path: `SPINEDIGEST_CONFIG`
- one-shot inline LLM JSON: `--llm <json>`

A minimal config file looks like this:

```json
{
  "llm": {
    "provider": "openai",
    "model": "<your-model>"
  }
}
```

Set credentials with environment variables when possible:

```bash
export SPINEDIGEST_LLM_API_KEY="<your-api-key>"
```

For `openai-compatible`, you must also set a base URL:

```bash
export SPINEDIGEST_LLM_BASE_URL="https://your-provider.example/v1"
```

You can also place these fields in `config.json` if your environment requires it.

For one-off automation, pass inline LLM client JSON instead of writing config:

```bash
spinedigest --llm "$LLM_JSON" --input ./book.md --output ./out/digest.md
```

## 5. Run Your First Digest

From an installed CLI:

```bash
spinedigest --input ./book.md --output ./out/digest.md
```

From a local clone, the easiest command is:

```bash
pnpm dev -- --input ./test/fixtures/sources/sample-observatory-guide.md --output ./out/digest.md
```

After the command completes, inspect:

```bash
cat ./out/digest.md
```

## 6. Common Output Patterns

Write plain text:

```bash
spinedigest --input ./book.epub --output ./digest.txt
```

Write Markdown:

```bash
spinedigest --input ./book.txt --output ./digest.md
```

Write EPUB:

```bash
spinedigest --input ./book.md --output ./digest.epub
```

Write a reusable `.sdpub` archive:

```bash
spinedigest --input ./book.epub --output ./book.sdpub
```

Re-open an existing `.sdpub` and export it again:

```bash
spinedigest --input ./book.sdpub --output ./digest.txt
```

## 7. Pipe Through Standard Streams

`stdin` and `stdout` are only supported for text formats.

Read from `stdin`:

```bash
cat ./chapter.txt | spinedigest --input-format txt --output ./digest.md
```

Write to `stdout`:

```bash
spinedigest --input ./chapter.md --output-format txt
```

Pipe both directions:

```bash
cat ./chapter.txt | spinedigest --input-format txt --output-format markdown
```

## 8. Add A Custom Extraction Prompt

For a one-off run, pass `--prompt`:

```bash
spinedigest --input ./book.md --output ./digest.md --prompt "Preserve key arguments, named entities, and decisive transitions."
```

For a persistent default, set it in config:

```json
{
  "prompt": "Preserve key arguments, named entities, and decisive transitions."
}
```

For the main digest command, `--prompt` overrides `SPINEDIGEST_PROMPT`, which overrides `config.json`. If none is set, SpineDigest uses its built-in default prompt.

This prompt is applied when digesting source files or text streams. It is not used when reopening an existing `.sdpub`.

## 9. Troubleshooting

If you see a missing LLM configuration error:

- make sure `llm.provider` and `llm.model` are set
- or pass an inline LLM object with `--llm`
- make sure the corresponding API key is available

If format inference fails:

- add `--input-format`
- add `--output-format`

If you omit `--input` and nothing is piped in:

- SpineDigest refuses to read from interactive `stdin`
- provide `--input <path>` or pipe text into the process

## Next

- [CLI Reference](./cli.md)
- [AI Agent Guide](./ai-agents.md)
- [Library Usage](./library.md)
