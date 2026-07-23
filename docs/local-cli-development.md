# Local CLI Development

This document explains how to run the current checkout as the Wiki Graph CLI
during development.

It covers two different workflows:

- install the current branch as the machine-level `wg` command;
- run the current branch through pnpm without installing it.

Use the pnpm workflow for day-to-day development and regression checks. Use the
install workflow only when you explicitly need to preview the packaged CLI as a
global command.

## Install The Current Branch

Use this workflow when you want the current branch to behave like an installed
release:

```bash
pnpm cli:install-local
```

The script builds and packs the workspace, then installs the generated
`wiki-graph` package through npm as a global package. After it finishes, `wg`
and `wikigraph` resolve through the machine-level npm installation.

This workflow is useful for:

- previewing an unreleased version outside the repository;
- checking package contents, `dist` output, shebangs, and `bin` entries;
- testing how a normal user will experience the CLI after installation.

It is not the default regression workflow for agents or parallel worktrees. A
global install is shared by all shells and worktrees on the same machine, so one
checkout can replace the `wg` command used by another checkout.

Remove the global preview install with:

```bash
pnpm cli:uninstall-local
```

## Run Without Installing

Use this workflow for normal development, local regression checks, and agent
worktree runs:

```bash
pnpm --filter wiki-graph dev --help
pnpm --filter wiki-graph dev wikg://book.wikg --help
pnpm --filter wiki-graph dev help uri
```

Do not add an extra argument separator after `dev`. For this package, write:

```bash
pnpm --filter wiki-graph dev wikg://book.wikg --help
```

Do not write:

```bash
pnpm --filter wiki-graph dev -- wikg://book.wikg --help
```

The extra `--` is passed to the CLI and changes the parsed command.

## Development State Directory

The installed CLI stores local runtime state under `~/.wikigraph`. The
development CLI entry point sets an internal `WIKIGRAPH_DEV` value that points
at the repository-level `.wikigraph/state` directory instead. Do not set this
variable manually; use the pnpm dev script so child processes such as build
workers and GC use the same checkout-local state.

Use repository-root `.wikigraph/` for local development data:

```bash
mkdir -p .wikigraph/state .wikigraph/out .wikigraph/input
pnpm --filter wiki-graph dev --help
```

`pnpm --filter wiki-graph dev` runs the package script from
`packages/cli`. When you want an archive under the repository-level
`.wikigraph/out/` directory, pass an absolute `wikg://` URI based on the
repository root:

```bash
pnpm --filter wiki-graph dev "wikg://$PWD/.wikigraph/out/regression.wikg" --help
```

Recommended subdirectories:

- `.wikigraph/state/`: runtime state, cache, queue, logs, and temporary files;
- `.wikigraph/out/`: generated `.wikg` archives and exported regression output;
- `.wikigraph/input/`: private or temporary local input files.

Remove all local development data with:

```bash
pnpm cli:clean-dev-state
```

This deletes repository-root `.wikigraph/`, including `.wikigraph/state/`,
`.wikigraph/out/`, and `.wikigraph/input/`. It does not affect the installed
CLI's machine-level `~/.wikigraph` directory.

For repeated shell use, define a local helper from the repository root:

```bash
wg-dev() {
  pnpm --filter wiki-graph dev "$@"
}
```

Then run:

```bash
wg-dev --help
wg-dev "wikg://$PWD/.wikigraph/out/regression.wikg" inspect
```

## Choosing The Workflow

Use pnpm without installing when validating source changes, CLI behavior, help
text, archive operations, state handling, or bug fixes in the current checkout.

Use the install workflow only when the question is about the packaged command
itself: global `wg` resolution, npm package layout, `dist` artifacts, executable
metadata, or previewing an unreleased branch outside this repository.
