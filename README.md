# ExtPort Mirror Action

Sync, validate, build, and release PIE-compatible PHP extension mirrors.

[![CI](https://github.com/extport/mirror-action/actions/workflows/ci.yml/badge.svg)](https://github.com/extport/mirror-action/actions/workflows/ci.yml)

## What it does

This is a composite GitHub Action that handles the lifecycle of PIE-compatible mirror repositories for PHP extensions. It's called from each mirror repo's `sync.yml` workflow, dispatched by `extport/core`.

A "mirror repo" is a PIE-compatible package that tracks an upstream PHP extension repository, syncs new releases from upstream, and (optionally) builds binary artifacts for distribution via PIE.

## Modes

The action's behavior is selected via the `mode` input.

### `sync`

Detects all upstream releases newer than the current mirror version and syncs them in order (oldest first). For each new version it: downloads the upstream tarball, extracts it to `src/`, runs any configured post-extract hooks, updates `composer.json`, commits + tags + pushes, and creates a GitHub Release.

```yaml
- uses: extport/mirror-action@v1
  with:
    mode: sync
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

Initial sync (when `composer.json` version is `0.0.0`) is limited to the last N versions (default 5, configurable via `sync.initial-versions` in `.extport.json`).

### `validate`

Checks that the mirror repo is PIE-compliant: `.extport.json` has required fields, `composer.json` has `type: "php-ext"` (or `php-ext-zend`), `php-ext.extension-name`, `version`, and the source directory exists with a recognised build file (`config.m4`, `config.w32`, `configure.ac`, or `CMakeLists.txt`). Sets `validation-passed` and fails the job on any error.

```yaml
- uses: extport/mirror-action@v1
  with:
    mode: validate
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

### `resolve-matrix`

Resolves the build matrix (os / arch / php / zts / libc combinations) for a release tag, based on the `build` section of `.extport.json`. Used by downstream matrix-build workflows to decide what to build.

```yaml
- uses: extport/mirror-action@v1
  with:
    mode: resolve-matrix
    github-token: ${{ secrets.GITHUB_TOKEN }}
    release-tag: ${{ github.event.release.tag_name }}
```

### `build`

Delegates to `extport/pie-ext-binary-builder` to compile a single binary artifact for the matrix entry currently running. Inputs `configure-flags`, `build-path`, `docker-image`, and `apk-packages` are passed through.

```yaml
- uses: extport/mirror-action@v1
  with:
    mode: build
    github-token: ${{ secrets.GITHUB_TOKEN }}
    release-tag: ${{ github.event.release.tag_name }}
    docker-image: php:8.3-cli-alpine
```

## Inputs

| Input             | Required | Default | Description                                                                                              |
|-------------------|----------|---------|----------------------------------------------------------------------------------------------------------|
| `mode`            | yes      | —       | `sync`, `validate`, `build`, or `resolve-matrix`                                                         |
| `github-token`    | yes      | —       | GitHub token with `contents: write`                                                                      |
| `max-versions`    | no       | `0`     | Cap on versions synced per run (0 = unlimited)                                                           |
| `dry-run`         | no       | `false` | Log what would happen without making changes (sync mode)                                                 |
| `release-tag`     | no       | `''`    | Release tag to operate on (build / resolve-matrix modes)                                                 |
| `configure-flags` | no       | `''`    | Flags passed to `./configure` during build (build mode only)                                             |
| `build-path`      | no       | `.`     | Path to extension source directory containing `config.m4`, relative to repo root (build mode only)       |
| `docker-image`    | no       | `''`    | Docker image to run the build inside (e.g. `php:8.2-cli-alpine`). When set, build runs via `docker run`. |
| `apk-packages`    | no       | `''`    | Extra Alpine packages for Docker builds, space-separated (build mode only)                               |

## Outputs

| Output              | Description                                                          |
|---------------------|----------------------------------------------------------------------|
| `synced-versions`   | JSON array of version strings synced (sync mode)                     |
| `latest-version`    | Highest version synced, or empty string (sync mode)                  |
| `validation-passed` | `"true"` / `"false"` (validate mode)                                 |
| `enabled`           | `"true"` / `"false"` — whether builds are enabled (resolve-matrix)   |
| `matrix`            | JSON build matrix object (resolve-matrix mode)                       |
| `build-path`        | Resolved build path (resolve-matrix mode)                            |
| `configure-flags`   | Configure flags read from `.extport.json` (resolve-matrix mode)      |
| `apk-packages`      | Alpine packages read from `.extport.json` (resolve-matrix mode)      |
| `package-path`      | Path to the built binary ZIP (build mode)                            |

## Configuration (`.extport.json`)

Each mirror repo carries a `.extport.json` at the repo root that describes how to sync, validate, and (optionally) build the extension.

```json
{
    "upstream": {
        "repo": "phpredis/phpredis",
        "type": "github"
    },
    "php_ext_name": "redis",
    "source_dir": "src/",
    "sync": {
        "prereleases": false,
        "initial-versions": 5,
        "exclude-tags": []
    },
    "hooks": {
        "post-extract": [
            "cp -r deps/ src/",
            "node .pie-scripts/fix.js"
        ]
    },
    "build": {
        "enabled": true,
        "os": ["linux", "darwin"],
        "arches": ["x86_64", "arm64"],
        "zts": ["nts", "ts"],
        "libc": ["glibc", "musl"],
        "configure-flags": "--enable-redis",
        "apk-packages": "openssl-dev",
        "php-version-constraints": [
            { "ext-versions": ">=8.0.0", "php-versions": ["8.2", "8.3", "8.4", "8.5"] },
            { "ext-versions": "*",       "php-versions": ["8.2", "8.3"] }
        ]
    }
}
```

### Post-extract hooks

Commands listed under `hooks.post-extract` run after the upstream tarball is extracted but before `composer.json` is updated and the commit is created. Each entry is a shell command string executed via `sh -c`. To run a script file, write the full invocation (e.g. `node script.js` or `bash script.sh`).

Available environment variables:

- `PIE_SYNC_TAG` — upstream tag being synced (e.g. `v4.29.3`)
- `PIE_SYNC_VERSION` — normalized semver version (e.g. `4.29.3`)
- `PIE_SOURCE_DIR` — configured source directory (e.g. `src/`)

## Local development

Requires Node 20+.

```bash
npm install
npm test           # run tests
npm run test:cov   # tests + coverage report
npm run build      # bundle with ncc to dist/
```

## License

MIT — see [LICENSE](./LICENSE).
