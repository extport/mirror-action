import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePhpVersions, resolveMatrix } from '../src/utils/matrix.js';

describe('resolvePhpVersions', () => {
    it('matches a wildcard constraint', () => {
        const build = {
            'php-version-constraints': [
                { 'ext-versions': '*', 'php-versions': ['8.2', '8.3', '8.4'] },
            ],
        };
        const result = resolvePhpVersions('1.0.0', build);
        assert.deepEqual(result, ['8.2', '8.3', '8.4']);
    });

    it('matches a single constraint', () => {
        const build = {
            'php-version-constraints': [
                { 'ext-versions': '>=10.0.0', 'php-versions': ['8.2', '8.3', '8.4', '8.5'] },
                { 'ext-versions': '*', 'php-versions': ['8.2', '8.3', '8.4'] },
            ],
        };
        const result = resolvePhpVersions('10.1.0', build);
        assert.deepEqual(result, ['8.2', '8.3', '8.4', '8.5']);
    });

    it('first matching constraint wins', () => {
        const build = {
            'php-version-constraints': [
                { 'ext-versions': '>=10.0.0', 'php-versions': ['8.3', '8.4', '8.5'] },
                { 'ext-versions': '>=9.0.0', 'php-versions': ['8.2', '8.3', '8.4'] },
                { 'ext-versions': '*', 'php-versions': ['8.2', '8.3'] },
            ],
        };
        // 10.1.0 matches first and second, first wins
        assert.deepEqual(resolvePhpVersions('10.1.0', build), ['8.3', '8.4', '8.5']);
        // 9.5.0 matches second and wildcard, second wins
        assert.deepEqual(resolvePhpVersions('9.5.0', build), ['8.2', '8.3', '8.4']);
        // 1.0.0 matches only wildcard
        assert.deepEqual(resolvePhpVersions('1.0.0', build), ['8.2', '8.3']);
    });

    it('throws when no constraint matches', () => {
        const build = {
            'php-version-constraints': [
                { 'ext-versions': '>=10.0.0', 'php-versions': ['8.3', '8.4', '8.5'] },
            ],
        };
        assert.throws(
            () => resolvePhpVersions('9.0.0', build),
            /No php-version-constraint matches/
        );
    });

    it('throws when version cannot be coerced', () => {
        const build = {
            'php-version-constraints': [
                { 'ext-versions': '*', 'php-versions': ['8.2'] },
            ],
        };
        assert.throws(
            () => resolvePhpVersions('not-a-version', build),
            /Cannot coerce/
        );
    });

    it('handles compound semver ranges', () => {
        const build = {
            'php-version-constraints': [
                { 'ext-versions': '>=8.0.0 <9.0.0', 'php-versions': ['8.2', '8.3'] },
                { 'ext-versions': '*', 'php-versions': ['8.1', '8.2'] },
            ],
        };
        assert.deepEqual(resolvePhpVersions('8.5.0', build), ['8.2', '8.3']);
        // 9.0.0 is outside the range, falls through to wildcard
        assert.deepEqual(resolvePhpVersions('9.0.0', build), ['8.1', '8.2']);
    });

    it('normalizes extension versions with v prefix', () => {
        const build = {
            'php-version-constraints': [
                { 'ext-versions': '>=2.0.0', 'php-versions': ['8.3', '8.4'] },
                { 'ext-versions': '*', 'php-versions': ['8.2', '8.3'] },
            ],
        };
        const result = resolvePhpVersions('v2.1.0', build);
        assert.deepEqual(result, ['8.3', '8.4']);
    });

    it('handles versions without patch (e.g. 10.0)', () => {
        const build = {
            'php-version-constraints': [
                { 'ext-versions': '>=10.0.0', 'php-versions': ['8.3', '8.4'] },
                { 'ext-versions': '*', 'php-versions': ['8.2'] },
            ],
        };
        const result = resolvePhpVersions('10.0', build);
        assert.deepEqual(result, ['8.3', '8.4']);
    });

    it('handles less-than constraint', () => {
        const build = {
            'php-version-constraints': [
                { 'ext-versions': '<10.0.0', 'php-versions': ['8.2', '8.3'] },
                { 'ext-versions': '*', 'php-versions': ['8.2', '8.3', '8.4'] },
            ],
        };
        assert.deepEqual(resolvePhpVersions('9.9.9', build), ['8.2', '8.3']);
        assert.deepEqual(resolvePhpVersions('10.0.0', build), ['8.2', '8.3', '8.4']);
    });

    it('handles gRPC-style constraints', () => {
        const build = {
            'php-version-constraints': [
                { 'ext-versions': '<1.78.0', 'php-versions': ['8.2', '8.3', '8.4'] },
                { 'ext-versions': '>=1.78.0', 'php-versions': ['8.2', '8.3', '8.4', '8.5'] },
            ],
        };
        assert.deepEqual(resolvePhpVersions('1.70.0', build), ['8.2', '8.3', '8.4']);
        assert.deepEqual(resolvePhpVersions('1.78.0', build), ['8.2', '8.3', '8.4', '8.5']);
        assert.deepEqual(resolvePhpVersions('1.80.0', build), ['8.2', '8.3', '8.4', '8.5']);
    });
});

describe('resolveMatrix', () => {
    const baseConfig = {
        source_dir: 'src/',
        build: {
            enabled: true,
            os: ['linux', 'darwin'],
            arches: ['x86_64', 'arm64'],
            zts: ['nts', 'ts'],
            libc: ['glibc', 'musl'],
            'php-version-constraints': [
                { 'ext-versions': '*', 'php-versions': ['8.2', '8.3', '8.4'] },
            ],
        },
    };

    it('returns enabled=false when build is disabled', () => {
        const config = { ...baseConfig, build: { ...baseConfig.build, enabled: false } };
        const result = resolveMatrix('1.0.0', config);
        assert.equal(result.enabled, false);
        assert.equal(result.matrix, null);
        assert.equal(result.buildPath, null);
    });

    it('returns full matrix with wildcard constraint', () => {
        const result = resolveMatrix('1.0.0', baseConfig);
        assert.equal(result.enabled, true);

        // Matrix uses includes format with libc dimension
        assert.ok(Array.isArray(result.matrix.include));

        // Linux entries should have glibc and musl variants
        const linuxEntries = result.matrix.include.filter(e => e.os === 'linux');
        const linuxGlibc = linuxEntries.filter(e => e.libc === 'glibc');
        const linuxMusl = linuxEntries.filter(e => e.libc === 'musl');
        assert.equal(linuxGlibc.length, linuxMusl.length);
        assert.ok(linuxGlibc.length > 0);

        // Darwin entries should always be bsdlibc
        const darwinEntries = result.matrix.include.filter(e => e.os === 'darwin');
        assert.ok(darwinEntries.every(e => e.libc === 'bsdlibc'));
        assert.ok(darwinEntries.length > 0);

        // Total: linux(2 arches * 3 php * 2 zts * 2 libc) + darwin(2 arches * 3 php * 2 zts * 1 libc)
        assert.equal(result.matrix.include.length, 24 + 12);
    });

    it('uses version-specific constraint when matching', () => {
        const config = {
            ...baseConfig,
            build: {
                ...baseConfig.build,
                'php-version-constraints': [
                    { 'ext-versions': '>=10.0.0', 'php-versions': ['8.2', '8.3', '8.4', '8.5'] },
                    { 'ext-versions': '*', 'php-versions': ['8.2', '8.3', '8.4'] },
                ],
            },
        };
        const result = resolveMatrix('10.1.0', config);
        const phpVersions = [...new Set(result.matrix.include.map(e => e.php))];
        assert.deepEqual(phpVersions, ['8.2', '8.3', '8.4', '8.5']);
    });

    it('resolves build-path with source_dir prefix (default build-path)', () => {
        const result = resolveMatrix('1.0.0', baseConfig);
        assert.equal(result.buildPath, 'src');
    });

    it('resolves build-path with explicit build-path', () => {
        const config = {
            ...baseConfig,
            build: { ...baseConfig.build, 'build-path': 'ext/redis' },
        };
        const result = resolveMatrix('1.0.0', config);
        assert.equal(result.buildPath, 'src/ext/redis');
    });

    it('supports custom libc config (glibc only)', () => {
        const config = {
            ...baseConfig,
            build: { ...baseConfig.build, libc: ['glibc'] },
        };
        const result = resolveMatrix('1.0.0', config);
        const linuxEntries = result.matrix.include.filter(e => e.os === 'linux');
        assert.ok(linuxEntries.every(e => e.libc === 'glibc'));
        assert.equal(linuxEntries.filter(e => e.libc === 'musl').length, 0);
    });

    it('linux-only build includes libc variants, no bsdlibc', () => {
        const config = {
            ...baseConfig,
            build: { ...baseConfig.build, os: ['linux'] },
        };
        const result = resolveMatrix('1.0.0', config);
        const libcValues = [...new Set(result.matrix.include.map(e => e.libc))];
        assert.deepEqual(libcValues.sort(), ['glibc', 'musl']);
        assert.equal(result.matrix.include.filter(e => e.libc === 'bsdlibc').length, 0);
    });

    it('darwin-only build uses bsdlibc only', () => {
        const config = {
            ...baseConfig,
            build: { ...baseConfig.build, os: ['darwin'] },
        };
        const result = resolveMatrix('1.0.0', config);
        assert.ok(result.matrix.include.every(e => e.libc === 'bsdlibc'));
    });

    it('resolves build-path with trailing slash on source_dir', () => {
        const config = { ...baseConfig, source_dir: 'vendor/' };
        const result = resolveMatrix('1.0.0', config);
        assert.equal(result.buildPath, 'vendor');
    });
});
