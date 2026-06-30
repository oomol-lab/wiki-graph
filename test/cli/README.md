# CLI Help Coverage

This note tracks how the CLI help system is expected to recover from common user-facing failures.

## Error Routing Coverage

| Problem family    | Representative failures                                                               | Expected help landing                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Command shape     | unexpected positional args, unsupported `help` flags                                  | `wikigraph help command` or `wikigraph --help`                                                                                               |
| Maintenance usage | missing URI target, unsupported archive-root/cover/chapter flags, invalid chapter URI | `wikigraph wkg://book.sdpub/ get --help`, `wikigraph wkg://book.sdpub/cover get --help`, or `wikigraph wkg://book.sdpub/chapter list --help` |
| Format rules      | unsupported `stdin`/`stdout` formats, missing format inference                        | `wikigraph help format`                                                                                                                      |
| Runtime rules     | interactive stdin refusal, `--verbose` with stdout output                             | `wikigraph help runtime`                                                                                                                     |
| LLM config        | missing provider/model, unsupported provider/baseURL combinations                     | `wikigraph help config`                                                                                                                      |
| Env overrides     | invalid provider values, invalid numeric/boolean/sampling env values                  | `wikigraph help env`                                                                                                                         |
| Config file       | invalid JSON, invalid schema fields                                                   | `wikigraph help config-file`                                                                                                                 |

## Current Test Coverage

- `test/cli/args.test.ts` covers command-shape and `sdpub` parsing failures.
- `test/cli/convert.test.ts` covers format and runtime failures in the convert path.
- `test/cli/config.test.ts` covers environment-variable and config-file parsing failures.
- `test/cli/llm.test.ts` covers LLM option validation failures.

## Help Acceptance Checklist

- Root help clearly explains the exploration rules and the difference between command help and topic help.
- Public command shapes, flags, and short aliases are visible in help text and match the actual parser.
- Common parse errors point to the next relevant help page instead of stopping at the raw error.
- Common runtime and configuration failures also point to the next relevant help page.
- Type labels in help are inputable as written, with syntax or examples where guessing would otherwise be required.
