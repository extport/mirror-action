import * as semver from 'semver';

/**
 * Resolve PHP versions for a given extension version using php-version-constraints.
 * First matching constraint wins. Throws if no constraint matches.
 *
 * @param {string} extVersion - Extension version (tag), e.g. "10.1.0" or "v1.2.3"
 * @param {object} buildConfig - The build section of .extport.json
 * @returns {string[]} PHP versions to build for
 */
export function resolvePhpVersions(extVersion, buildConfig) {
    const constraints = buildConfig['php-version-constraints'];
    const coerced = semver.coerce(extVersion);

    if (!coerced) {
        throw new Error(`Cannot coerce "${extVersion}" to semver`);
    }

    for (const constraint of constraints) {
        if (semver.satisfies(coerced, constraint['ext-versions'])) {
            return constraint['php-versions'];
        }
    }

    throw new Error(
        `No php-version-constraint matches "${extVersion}" (coerced: ${coerced}). ` +
        `Defined ranges: ${constraints.map(c => c['ext-versions']).join(', ')}`
    );
}

/**
 * Resolve the full build matrix for a given extension version.
 *
 * @param {string} extVersion - Extension version (tag)
 * @param {object} config - Full .extport.json config
 * @returns {{ enabled: boolean, matrix: object, buildPath: string }}
 */
export function resolveMatrix(extVersion, config) {
    const build = config.build;
    const enabled = build.enabled ?? false;

    if (!enabled) {
        return { enabled: false, matrix: null, buildPath: null };
    }

    const phpVersions = resolvePhpVersions(extVersion, build);

    // Validate source dimensions before building includes
    const dimensions = {
        os: build.os,
        arch: build.arches,
        php: phpVersions,
        zts: build.zts,
        libc: build.libc,
    };
    for (const [key, value] of Object.entries(dimensions)) {
        if (!Array.isArray(value)) {
            throw new Error(`Build matrix "${key}" must be an array, got ${typeof value}`);
        }
        for (const [i, item] of value.entries()) {
            if (typeof item !== 'string' && typeof item !== 'number') {
                throw new Error(
                    `Build matrix "${key}[${i}]" must be a string or number, got ${typeof item}`
                );
            }
        }
    }

    // Build includes list: darwin always uses bsdlibc, linux uses configured libc variants
    const include = [];
    for (const os of build.os) {
        const libcVariants = os === 'darwin' ? ['bsdlibc'] : build.libc;
        for (const arch of build.arches) {
            for (const php of phpVersions) {
                for (const zts of build.zts) {
                    for (const libc of libcVariants) {
                        include.push({ os, arch, php, zts, libc });
                    }
                }
            }
        }
    }

    const matrix = { include };

    const rawBuildPath = build['build-path'] ?? '.';
    const sourceDir = config.source_dir ?? 'src/';
    let buildPath;
    if (rawBuildPath === '.' || !rawBuildPath) {
        buildPath = sourceDir.replace(/\/$/, '');
    } else {
        buildPath = `${sourceDir.replace(/\/$/, '')}/${rawBuildPath}`;
    }

    return { enabled: true, matrix, buildPath };
}
