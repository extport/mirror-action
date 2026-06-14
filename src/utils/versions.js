import semver from 'semver';

/**
 * Strip leading v/V prefix from a tag name.
 * "v7.4.1" → "7.4.1", "6.1.0" → "6.1.0"
 */
export function normalizeTag(tag) {
    return tag.replace(/^[vV]/, '');
}

/**
 * Check if a version string looks like a pre-release.
 */
export function isPreRelease(version) {
    return /[-.]?(alpha|beta|rc|dev|preview|snapshot)/i.test(version);
}

/**
 * Try to coerce a version string into a valid semver for comparison.
 * Returns null if not parseable.
 */
export function coerceVersion(version) {
    return semver.coerce(version);
}

/**
 * Compare two version strings. Returns:
 *   -1 if a < b, 0 if equal, 1 if a > b.
 * Uses semver.coerce for best-effort parsing.
 */
export function compareVersions(a, b) {
    const parsedA = semver.coerce(a);
    const parsedB = semver.coerce(b);

    if (!parsedA || !parsedB) {
        // Fallback: lexicographic comparison of dot-separated numeric segments
        return compareDotted(a, b);
    }

    return semver.compare(parsedA, parsedB);
}

/**
 * Fallback comparison for non-semver dot-separated version strings.
 * Compares segment by segment numerically.
 * "3.7.0.1" vs "3.7.0" → 1
 */
function compareDotted(a, b) {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);
    const len = Math.max(partsA.length, partsB.length);

    for (let i = 0; i < len; i++) {
        const segA = partsA[i] ?? 0;
        const segB = partsB[i] ?? 0;
        if (segA < segB) return -1;
        if (segA > segB) return 1;
    }
    return 0;
}

/**
 * Given a current version and a list of upstream tags, return only the tags
 * whose normalized version is strictly greater than currentVersion.
 * Results are sorted ascending (oldest first).
 *
 * @param {string} currentVersion - The current synced version (e.g. "6.0.0")
 * @param {string[]} upstreamTags - Array of raw tag names (e.g. ["v6.0.0", "v6.1.0", "v7.0.0RC1"])
 * @param {object} options
 * @param {boolean} options.includePrereleases - Include RC/alpha/beta tags
 * @param {string[]} options.excludePatterns - Regex patterns to skip tags
 * @returns {Array<{tag: string, version: string}>} Sorted array of {tag, version} objects
 */
export function filterNewerVersions(currentVersion, upstreamTags, options = {}) {
    const { includePrereleases = false, excludePatterns = [] } = options;

    const excludeRegexes = excludePatterns.map(p => new RegExp(p));

    return upstreamTags
        .map(tag => ({ tag, version: normalizeTag(tag) }))
        .filter(({ tag, version }) => {
            // Skip excluded tags
            if (excludeRegexes.some(re => re.test(tag))) return false;

            // Skip pre-releases unless opted in
            if (!includePrereleases && isPreRelease(version)) return false;

            // Skip if we can't parse for comparison
            if (!semver.coerce(version)) return false;

            // Keep only versions newer than current
            return compareVersions(version, currentVersion) > 0;
        })
        .sort((a, b) => compareVersions(a.version, b.version));
}

/**
 * Check if a version string represents an initial/unsynced state.
 */
export function isInitialVersion(version) {
    return !version || version === '0.0.0';
}
