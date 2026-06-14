# extport/mirror-action

## What this action does

This is a GitHub Action that handles syncing PHP extension source code from upstream repos into PIE-compatible mirror repos. It's called by each mirror repo's `sync.yml` workflow (dispatched by `extport/core`).

## Modes

### `sync`

Detects all upstream releases newer than the current mirror version and syncs them in order (oldest first).

For each new version:
1. Downloads source tarball from upstream
2. Extracts to `src/` (replacing previous contents)
3. Runs post-extract hooks (if configured in `.extport.json`)
4. Updates `composer.json` version
5. Commits, tags, and pushes to `main`
6. Creates a GitHub Release

**Initial sync:** When `composer.json` version is `0.0.0` (freshly created mirror), only the last N versions are synced (default 5, configurable via `sync.initial-versions` in `.extport.json`).

### `validate`

Checks that the mirror repo is PIE-compliant:
- `.extport.json` has required fields
- `composer.json` has `type: "php-ext"`, `php-ext.extension-name`, `version`
- Source directory exists

## Inputs

| Input          | Required | Default | Description                            |
|----------------|----------|---------|----------------------------------------|
| `mode`         | yes      | —       | `sync` or `validate`                   |
| `github-token` | yes      | —       | Token with `contents: write`           |
| `max-versions` | no       | `0`     | Limit versions per run (0 = unlimited) |
| `dry-run`      | no       | `false` | Log without making changes             |

## Outputs

| Output              | Description                          |
|---------------------|--------------------------------------|
| `synced-versions`   | JSON array of synced version strings |
| `latest-version`    | Highest version synced (or empty)    |
| `validation-passed` | `"true"` / `"false"` (validate mode) |

## Configuration (`.extport.json`)

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
            "node .scripts/fix.js"
        ]
    }
}
```

### Post-extract hooks

Commands listed under `hooks.post-extract` run after the upstream tarball is extracted but before `composer.json` is updated and the commit is created. Each entry is a shell command string executed via `sh -c`. To run a script file, write the full invocation (e.g., `node script.js` or `bash script.sh`).

Environment variables available to hook commands:
- `PIE_SYNC_TAG` — upstream tag being synced (e.g., `v4.29.3`)
- `PIE_SYNC_VERSION` — normalized semver version (e.g., `4.29.3`)
- `PIE_SOURCE_DIR` — configured source directory (e.g., `src/`)

## Local development

```bash
npm install
npm test                        # run tests
npm run build                   # bundle with ncc to dist/
```

## GitHub Actions pinning

Third-party actions in `.github/workflows/*.yml` must be pinned to a full
commit SHA with a `# vX.Y.Z` comment, e.g.:

```yaml
- uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6.0.3
```

Renovate (configured in `renovate.json`) reads the SHA + version comment and
opens PRs when a new release is available. Floating tags like `@v4` block
Renovate from tracking updates and weaken supply-chain hygiene.

## Key files

```
action.yml          — action definition
src/
  index.js          — entry point, routes by mode
  sync.js           — multi-version sync logic
  release.js        — GitHub Release creation
  validate.js       — PIE compliance checks
  utils/
    config.js       — reads .extport.json
    composer.js     — reads/writes composer.json
    github.js       — Octokit wrapper, tarball download
    versions.js     — version normalization/comparison
    git.js          — git operations (commit, tag, push)
    hooks.js        — post-extract hook execution
```
