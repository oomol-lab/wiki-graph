<p>English | <a href="../zh-CN/library.md">中文</a></p>

# Library Usage

SpineDigest exposes a programmatic API for Node and TypeScript environments.

The CLI is the primary and most complete interface for working with `.wikg` as a knowledge base. The library API is lower-level: it is useful when a surrounding Node application needs to run import, build, export, or archive-opening flows in process.

## Requirements

- Node `>=22.12.0`

## Install

```bash
npm install spinedigest
```

## Public Entry Point

The package exports `SpineDigestApp`, `SpineDigest`, and language helpers from the top-level entry point.

Both ESM `import` and CommonJS `require()` are supported.

## Current API Shape

The current public library API still reflects the underlying digest session model. Use it when you need direct control from Node code; use the CLI when you need the full LLM Wiki retrieval surface (`list`, `page`, `find`, `read`, `links`, `pack`, and related commands).

Typical flow:

1. Construct `SpineDigestApp` with an LLM model.
2. Open a digest session for a source file or text stream, or open an existing `.wikg`.
3. Use the provided `SpineDigest` object to inspect metadata, export projections, or save the archive.

## Example

```ts
import { createOpenAI } from "@ai-sdk/openai";
import { SpineDigestApp } from "spinedigest";

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const app = new SpineDigestApp({
  llm: {
    model: openai("<your-model>"),
  },
});

await app.digestEpubSession(
  {
    path: "./book.epub",
  },
  async (digest) => {
    await digest.exportText("./digest.txt");
    await digest.saveAs("./book.wikg");
  },
);
```

## CommonJS Example

```js
const { createOpenAI } = require("@ai-sdk/openai");
const { SpineDigestApp } = require("spinedigest");
```

## Main Session Methods

- `digestEpubSession`
- `digestMarkdownSession`
- `digestTxtSession`
- `digestTextStreamSession`
- `openSession`

`openSession` is for existing `.wikg` archives and does not require a fresh source digest run.

## Progress Callbacks

Digest session options accept an optional `onProgress` callback.

The callback reports three event shapes during LLM-backed generation:

- `serials-discovered`, which reports all discovered serial ids plus their fragment counts and total word counts in one batch; when discovery cannot be done up front, it is emitted once with `available: false` and an empty `serials` array
- `serial-progress`, which reports completed word count and completed fragment count for a specific serial id
- `digest-progress`, which reports completed word count against the current known total word count

## What `SpineDigest` Can Do

- `readMeta()`
- `readCover()`
- `readToc()`
- `listSerials()`
- `readSerialSummary(serialId)`
- `exportText(path)`
- `exportEpub(path)`
- `saveAs(path)`

## Notes

- LLM-backed digest and build work requires an LLM configuration.
- Existing `.wikg` archives can be reopened without re-running source import.
- If you are evaluating the project for direct use, start with the CLI docs instead.

## Related Docs

- [Quick Start](./quickstart.md)
- [CLI Reference](./cli.md)
- [Architecture](./architecture.md)
