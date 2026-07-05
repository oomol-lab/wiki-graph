# Configure WikiSpine for Knowledge Graph

WikiGraph can create archives, build Reading Graph data, and build Reading Summary data without WikiSpine. WikiSpine is required only when you build Knowledge Graph data.

Knowledge Graph builds need one WikiSpine provider:

- `fetch`: call a WikiSpine HTTP service endpoint.
- `cli`: run a local `wikispine` command with local runtime data.

After configuring either provider, run:

```bash
wikigraph wikg://local/config/wikispine test
```

## Choose a Provider

Use `fetch` when you want the fastest setup and the source text is safe to send to the endpoint. This avoids the large local runtime data download, but it depends on network access and on the endpoint owner's availability and pricing.

Use `cli` when you process private text, need offline or reproducible runs, or do not want chapter text sent to a remote service. This requires installing the WikiSpine CLI and downloading the runtime data package.

For team or production use, self-host a WikiSpine service and configure WikiGraph with `provider: fetch` and your own endpoint. That gives the same HTTP integration without relying on the public convenience endpoint.

## Fetch Provider

Configure an HTTP endpoint:

```bash
wikigraph wikg://local/config/wikispine put provider fetch
wikigraph wikg://local/config/wikispine put endpoint https://wikispi-service-cxbfjlteab.cn-hangzhou.fcapp.run
wikigraph wikg://local/config/wikispine test
```

The endpoint must implement the WikiSpine runtime API:

- `GET /readyz`
- `GET /metadata`
- `POST /match`

`POST /match` receives chapter text. Do not use a third-party endpoint for private, customer, paid, or internal source text unless that is acceptable for your use case.

The public endpoint above is a convenience endpoint. It may be rate limited, unavailable, changed, removed, or moved behind paid access. For long-term or high-volume use, run your own WikiSpine service.

## CLI Provider

Install the WikiSpine CLI:

```bash
curl -fsSL https://raw.githubusercontent.com/Moskize91/wikispine/main/scripts/install.sh | sh
wikispine --version
```

Install the runtime data package:

```bash
wikispine init
wikispine doctor
```

Then configure WikiGraph:

```bash
wikigraph wikg://local/config/wikispine put provider cli
wikigraph wikg://local/config/wikispine put command wikispine
wikigraph wikg://local/config/wikispine test
```

The runtime data package is large. Before running `wikispine init`, make sure you have enough disk space and a stable network connection.

## Put Runtime Data in a Known Directory

For local CLI use, prefer an explicit data directory when you want to control disk placement:

```bash
wikispine init --data-dir /path/to/wikispine-runtime
wikispine doctor --data-dir /path/to/wikispine-runtime

wikigraph wikg://local/config/wikispine put provider cli
wikigraph wikg://local/config/wikispine put command wikispine
wikigraph wikg://local/config/wikispine put dataDir /path/to/wikispine-runtime
wikigraph wikg://local/config/wikispine test
```

Use a path on a volume with enough free space. Avoid putting the runtime data inside a source repository.

## Install from an Existing Archive or Mirror

If you already have the runtime archive, install from the local ZIP instead of downloading it again:

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

## Self-Host a WikiSpine Service

Run WikiSpine as a service when multiple machines or users need Knowledge Graph builds:

```bash
wikispine serve --data-dir /path/to/wikispine-runtime --bind 0.0.0.0:9000
```

Then configure WikiGraph clients:

```bash
wikigraph wikg://local/config/wikispine put provider fetch
wikigraph wikg://local/config/wikispine put endpoint http://your-host:9000
wikigraph wikg://local/config/wikispine test
```

Self-hosting avoids repeated runtime data downloads and lets you control privacy, availability, and cost.

## Troubleshooting

If WikiGraph says WikiSpine is not configured, choose `fetch` or `cli` and run the config test:

```bash
wikigraph wikg://local/config/wikispine
wikigraph wikg://local/config/wikispine test
```

If `provider: cli` fails:

- Confirm `wikispine --version` works.
- Run `wikispine doctor`.
- If you configured `dataDir`, run `wikispine doctor --data-dir <dir>`.
- If the runtime data is missing, run `wikispine init` or install from a local ZIP or mirror.

If `provider: fetch` fails:

- Confirm the endpoint URL is reachable.
- Open `<endpoint>/readyz`; it should return `ready`.
- Open `<endpoint>/metadata`; it should return runtime metadata.
- Confirm the endpoint supports `POST /match`.

After changing any WikiSpine setting, run:

```bash
wikigraph wikg://local/config/wikispine test
```
