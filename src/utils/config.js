import { readFileSync } from 'fs';

const CONFIG_PATH = '.extport.json';

/**
 * Read and validate .extport.json from the repo root.
 * Returns the parsed config object with defaults applied.
 */
export function readConfig(configPath = CONFIG_PATH) {
    const raw = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);

    if (!config?.upstream?.repo) {
        throw new Error('.extport.json: upstream.repo is required');
    }
    if (!config?.upstream?.type) {
        throw new Error('.extport.json: upstream.type is required');
    }
    if (!config?.php_ext_name) {
        throw new Error('.extport.json: php_ext_name is required');
    }

    // Apply defaults
    config.source_dir = config.source_dir || 'src/';
    config.upstream.type = config.upstream.type || 'github';
    config.sync = config.sync || {};
    config.sync.prereleases = config.sync.prereleases ?? false;
    config.sync['initial-versions'] = config.sync['initial-versions'] ?? 5;
    config.sync['exclude-tags'] = config.sync['exclude-tags'] ?? [];

    // Hook defaults and validation
    config.hooks = config.hooks || {};
    config.hooks['post-extract'] = config.hooks['post-extract'] ?? [];

    if (!Array.isArray(config.hooks['post-extract'])) {
        throw new Error('.extport.json: hooks.post-extract must be an array');
    }
    for (const [i, entry] of config.hooks['post-extract'].entries()) {
        if (typeof entry !== 'string') {
            throw new Error(
                `.extport.json: hooks.post-extract[${i}] must be a string, got ${typeof entry}`
            );
        }
        if (entry.trim() === '') {
            throw new Error(
                `.extport.json: hooks.post-extract[${i}] must not be empty`
            );
        }
    }

    // Build config defaults
    config.build = config.build || {};
    config.build.enabled = config.build.enabled ?? false;
    config.build.os = config.build.os ?? ['linux', 'darwin'];
    config.build.arches = config.build.arches ?? ['x86_64', 'arm64'];
    config.build.zts = config.build.zts ?? ['nts', 'ts'];
    config.build.libc = config.build.libc ?? ['glibc', 'musl'];
    config.build['configure-flags'] = config.build['configure-flags'] ?? '';
    config.build['apk-packages'] = config.build['apk-packages'] ?? '';
    config.build['php-version-constraints'] = config.build['php-version-constraints']
        ?? [{ 'ext-versions': '*', 'php-versions': ['8.2', '8.3', '8.4', '8.5'] }];

    // Validate php-version-constraints structure
    if (!Array.isArray(config.build['php-version-constraints'])) {
        throw new Error('.extport.json: build.php-version-constraints must be an array');
    }
    for (const [i, entry] of config.build['php-version-constraints'].entries()) {
        if (typeof entry['ext-versions'] !== 'string' || !entry['ext-versions']) {
            throw new Error(
                `.extport.json: build.php-version-constraints[${i}].ext-versions must be a non-empty string`
            );
        }
        if (!Array.isArray(entry['php-versions']) || entry['php-versions'].length === 0) {
            throw new Error(
                `.extport.json: build.php-version-constraints[${i}].php-versions must be a non-empty array`
            );
        }
        for (const [j, v] of entry['php-versions'].entries()) {
            if (typeof v !== 'string') {
                throw new Error(
                    `.extport.json: build.php-version-constraints[${i}].php-versions[${j}] must be a string`
                );
            }
        }
    }

    return config;
}
