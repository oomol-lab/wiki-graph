# Releasing packages

The `Release` GitHub Actions workflow publishes every package in the release
plan in dependency order and creates a Git tag only after all package publishes
succeed. Run it from `main` after updating package versions.

`wiki-graph-core`, `wiki-graph-sdk`, and `wiki-graph` must use the same version.
The release tag uses the `wiki-graph` version, for example `v0.7.0`.

## First release of a new package

npm trusted publishing cannot create a package. When a release contains a new
package name:

1. Create a granular npm access token with read/write package permission and
   permission to publish without an interactive 2FA prompt.
2. Add it temporarily as the `NPM_TOKEN` Actions repository secret.
3. Run the `Release` workflow on `main` with `authentication` set to
   `bootstrap-token`.
4. For every released package, configure npm Trusted Publisher with:
   - provider: GitHub Actions
   - organization: `oomol-lab`
   - repository: `wiki-graph`
   - workflow filename: `release.yml`
   - environment: unset
   - direct `npm publish`: allowed
5. Delete the `NPM_TOKEN` repository secret.

The release script is restartable. If publishing stops partway through, rerun
the same workflow after fixing the failure. Packages whose identical version is
already present in npm are skipped.

## Later releases

Run the `Release` workflow on `main` with the default `trusted-publishing`
authentication. No npm token is required.
