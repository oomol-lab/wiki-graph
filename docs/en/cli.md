<p>English | <a href="../zh-CN/cli.md">中文</a></p>

# CLI Reference

SpineDigest is designed to be used from the command line first.

## Command Form

Installed CLI:

```bash
spinedigest [--input <path>] [--output <path>] [--input-format <format>] [--output-format <format>] [--digest-dir <path>] [--llm <json>] [--prompt <text>] [--verbose]
spinedigest status [--llm <json>]
spinedigest sdpub <info|toc|list|cat|cover> --input <path> [--serial <id>] [--llm <json>]
```

From a source checkout:

```bash
pnpm dev -- [--input <path>] [--output <path>] [--input-format <format>] [--output-format <format>] [--digest-dir <path>] [--llm <json>] [--prompt <text>] [--verbose]
pnpm dev -- status [--llm <json>]
pnpm dev -- sdpub <info|toc|list|cat|cover> --input <path> [--serial <id>] [--llm <json>]
```

## Flags

- `--input <path>`: input file path
- `--output <path>`: output file path
- `--input-format <format>`: input format override
- `--output-format <format>`: output format override
- `--digest-dir <path>`: keep the digest workspace; the directory is cleared before each run
- `--llm <json>`: inline LLM client JSON for this invocation
- `--prompt <text>`: one-off extraction prompt override for the current digest run
- `--verbose`: write diagnostic logs to `stderr`
- `-h`, `--help`: print help text

The main conversion command does not support positional arguments.

The `sdpub` inspection interface uses positional subcommands: `spinedigest sdpub <subcommand>`.

The `sdpub` inspection subcommands only accept `--input`, and `cat` also requires `--serial`.

`--prompt` only affects digest generation from source inputs. It does not apply when reopening `.sdpub` archives or using `spinedigest sdpub ...`.

`--llm` overrides LLM settings from environment variables and `config.json`. It is accepted by command paths that do not call an LLM so wrapper scripts can pass one consistent option set.

## Formats

Supported formats:

- `sdpub`
- `epub`
- `txt`
- `markdown`

If a format flag is omitted, SpineDigest tries to infer the format from the file extension.

Extension mapping:

- `.sdpub` -> `sdpub`
- `.epub` -> `epub`
- `.txt` -> `txt`
- `.md` or `.markdown` -> `markdown`

## Standard Stream Rules

When `--input` is omitted:

- SpineDigest reads from `stdin`
- only `txt` and `markdown` are allowed
- interactive `stdin` is rejected

When `--output` is omitted:

- SpineDigest writes to `stdout`
- only `txt` and `markdown` are allowed
- `--verbose` cannot be used at the same time

## Diagnostic Logs

- By default, the CLI stays quiet and does not print diagnostic logs to the terminal.
- With `--verbose`, diagnostic logs are written to `stderr`.
- When `paths.debugLogDir` is configured, each run creates `<runId>/` under that directory, including:
  - `events.log`: human-readable event log
  - `artifacts/llm/`: LLM request logs
  - `artifacts/editor/`: compression logs

## Common Commands

Digest an EPUB to Markdown:

```bash
spinedigest --input ./book.epub --output ./digest.md
```

Digest a text file to EPUB:

```bash
spinedigest --input ./book.txt --output ./digest.epub
```

Create an `.sdpub` archive:

```bash
spinedigest --input ./book.md --output ./book.sdpub
```

Reuse an existing `.sdpub` archive:

```bash
spinedigest --input ./book.sdpub --output ./digest.txt
```

Inspect an `.sdpub` archive:

```bash
spinedigest sdpub info --input ./book.sdpub
spinedigest sdpub toc --input ./book.sdpub
spinedigest sdpub list --input ./book.sdpub
spinedigest sdpub cat --input ./book.sdpub --serial 12
spinedigest sdpub cover --input ./book.sdpub > ./cover.png
```

Use pipes:

```bash
cat ./chapter.txt | spinedigest --input-format txt --output-format markdown
```

Use a one-off extraction prompt:

```bash
spinedigest --input ./book.md --output ./digest.md --prompt "Preserve named entities and decisive transitions."
```

Use one-shot LLM client JSON:

```bash
spinedigest --llm "$LLM_JSON" --input ./book.md --output ./digest.md
```

## Configuration

Default config path:

```text
~/.spinedigest/config.json
```

Override path:

```text
SPINEDIGEST_CONFIG
```

Config fields:

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

`request.timeout` is in milliseconds.

Inline LLM JSON can be either a direct LLM object or an object with an `llm` field. It supports `provider`, `model`, `apiKey`, `baseURL`, `baseUrl`, `chatCompletionsUrl`, and `name`. A base URL implies `openai-compatible` when `provider` is omitted.

```json
{
  "model": "<your-model>",
  "apiKey": "<optional>",
  "baseUrl": "https://your-provider.example/v1"
}
```

For the main digest command, `--prompt` has the highest priority for the current run. Otherwise, `SPINEDIGEST_PROMPT` overrides `config.json`, and missing values fall back to the built-in default prompt.

For LLM settings, `--llm` overrides `SPINEDIGEST_LLM_*` variables, which override `config.json`.

## Environment Variables

SpineDigest can override config values with environment variables:

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

`openai-compatible` requires a base URL from `--llm`, config, or `SPINEDIGEST_LLM_BASE_URL`.

## `.sdpub` Behavior

`.sdpub` is a portable archive of a processed digest document.

When the input is `.sdpub`:

- SpineDigest opens the saved digest state
- no LLM configuration is required
- you can export to `.txt`, `.md`, or `.epub`
- you can inspect metadata, TOC, serials, serial text, and cover data through `spinedigest sdpub ...`

When the output is `.sdpub`:

- SpineDigest saves the processed digest document for later reuse

## Failure Modes

Expect a plain-text error message on `stderr` and a non-zero exit code when:

- the input format cannot be inferred
- the output format cannot be inferred
- `stdin` or `stdout` is used with a non-text format
- `--verbose` is used while writing output to `stdout`
- no LLM configuration is available for a digest operation
- `spinedigest sdpub cat` is used without `--serial`
- `sdpub` inspection subcommands are used with unsupported flags such as `--output`, `--output-format`, `--prompt`, or `--verbose`
- `spinedigest sdpub cover` tries to write binary data to an interactive terminal
- `spinedigest sdpub cover` is used on an archive without a cover
- provider-specific configuration is invalid

## Related Docs

- [Quick Start](./quickstart.md)
- [AI Agent Guide](./ai-agents.md)
- [Library Usage](./library.md)
