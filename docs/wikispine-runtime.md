# WikiSpine Runtime Guide

WikiGraph can create archives, build Reading Graph data, and build Reading Summary data without WikiSpine. WikiSpine is required only for Knowledge Graph generation.

The hosted provider requires a WikiGraph API key:

```bash
wg wikg://local/config/wikispine put provider fetch
wg wikg://local/config/wikispine put token --secret
wg wikg://local/config/wikispine test
```

or:

```bash
wg wikg://local/config/wikispine put provider cli
wg wikg://local/config/wikispine test
```

Use `fetch` for the fastest setup. Use `cli` when source text must stay local, network access is unavailable, or you need a controlled local runtime.

## Fetch Provider

`fetch` sends WikiSpine match requests to the hosted WikiGraph provider through the public API gateway. `pnpm dev` uses `https://pdf-craft-api.oomol.dev/v1/wikispine`; built CLI artifacts use `https://api.pdfcraft.ai/v1/wikispine`. Requests use the configured token as a Bearer API key.

```bash
wg wikg://local/config/wikispine put provider fetch
wg wikg://local/config/wikispine put token --secret
wg wikg://local/config/wikispine test
```

The test checks the built-in service metadata and performs a small match request.

Use this provider when:

- source text is safe to send to the built-in service;
- you want to avoid local runtime data downloads;
- temporary network or service dependency is acceptable.

If `fetch` fails:

- confirm the machine has network access;
- confirm the configured API key is valid;
- rerun `wg wikg://local/config/wikispine test --json` to capture the structured failure;
- try again later if the built-in service is unavailable;
- switch to `cli` if the text is private or the service is not reachable from the current environment.

## CLI Provider

`cli` runs a local `wikispine` command from `PATH`.

```bash
wg wikg://local/config/wikispine put provider cli
wg wikg://local/config/wikispine test
```

Install the WikiSpine CLI:

```bash
curl -fsSL https://raw.githubusercontent.com/Moskize91/wikispine/main/scripts/install.sh | sh
wikispine --version
```

Install or verify runtime data:

```bash
wikispine init
wikispine doctor
```

Use this provider when:

- source text must stay on the machine;
- you need offline or reproducible runs;
- you can install and maintain the local runtime data.

If `cli` fails:

- confirm `wikispine --version` works in the same shell that runs `wg`;
- run `wikispine doctor`;
- run `wikispine init` if runtime data is missing;
- make sure the runtime data is on a volume with enough free space;
- reinstall or update the WikiSpine CLI if output parsing fails.

## Runtime Data

The local runtime data package can be large. Before running `wikispine init`, check disk space and network stability.

If you already have the runtime archive, install from the local ZIP:

```bash
wikispine init --file /path/to/wikigraph-runtime-data-zh-en-20260702.zip
wikispine doctor
```

If your organization mirrors the archive, install from the mirror:

```bash
wikispine init \
  --version zh-en-20260702 \
  --url https://example.com/wikigraph-runtime-data-zh-en-20260702.zip
wikispine doctor
```

When you pass a known `--version`, WikiSpine verifies the downloaded archive against the built-in checksum.

## Self-Hosting

The `fetch` provider accepts a custom endpoint while retaining the same Bearer-token contract:

```bash
wg wikg://local/config/wikispine put endpoint https://wikispine.example.com/v1
wg wikg://local/config/wikispine put token --secret
wg wikg://local/config/wikispine test
```

The CLI configuration accepts `provider`, `endpoint`, and `token`. Runtime-only command and data-directory overrides remain SDK concerns and are not accepted as CLI configuration keys.

## Troubleshooting Flow

Start with:

```bash
wg wikg://local/config/wikispine
wg wikg://local/config/wikispine test --json
```

If the config object is empty, choose one provider:

```bash
wg wikg://local/config/wikispine put provider fetch
wg wikg://local/config/wikispine put token --secret
```

or:

```bash
wg wikg://local/config/wikispine put provider cli
```

Then rerun:

```bash
wg wikg://local/config/wikispine test --json
```

If Knowledge Graph jobs still fail after the test succeeds, inspect the archive and the job:

```bash
wg <archive-uri> inspect
wg wikg://local/job --help
wg wikg://local/job/<job-id> watch --jsonl
```
