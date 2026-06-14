import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeTag,
    isPreRelease,
    coerceVersion,
    compareVersions,
    filterNewerVersions,
    isInitialVersion,
} from '../src/utils/versions.js';

describe('normalizeTag', () => {
    it('strips leading lowercase v', () => {
        assert.equal(normalizeTag('v7.4.1'), '7.4.1');
    });

    it('strips leading uppercase V', () => {
        assert.equal(normalizeTag('V2.0.0'), '2.0.0');
    });

    it('leaves untouched when no prefix', () => {
        assert.equal(normalizeTag('6.1.0'), '6.1.0');
    });

    it('only strips a single leading prefix', () => {
        assert.equal(normalizeTag('vv1.0.0'), 'v1.0.0');
    });

    it('handles empty string', () => {
        assert.equal(normalizeTag(''), '');
    });
});

describe('isPreRelease', () => {
    it('matches alpha', () => {
        assert.equal(isPreRelease('1.0.0-alpha'), true);
        assert.equal(isPreRelease('1.0.0alpha1'), true);
    });

    it('matches beta', () => {
        assert.equal(isPreRelease('1.0.0-beta2'), true);
        assert.equal(isPreRelease('1.0.0.beta'), true);
    });

    it('matches rc', () => {
        assert.equal(isPreRelease('7.0.0RC1'), true);
        assert.equal(isPreRelease('7.0.0-rc1'), true);
    });

    it('matches dev / preview / snapshot', () => {
        assert.equal(isPreRelease('1.0.0-dev'), true);
        assert.equal(isPreRelease('1.0.0-preview'), true);
        assert.equal(isPreRelease('1.0.0-SNAPSHOT'), true);
    });

    it('case-insensitive', () => {
        assert.equal(isPreRelease('1.0.0-ALPHA'), true);
        assert.equal(isPreRelease('1.0.0-Beta'), true);
    });

    it('returns false for clean version', () => {
        assert.equal(isPreRelease('1.0.0'), false);
        assert.equal(isPreRelease('10.2.3'), false);
    });
});

describe('coerceVersion', () => {
    it('parses clean semver', () => {
        const result = coerceVersion('1.2.3');
        assert.ok(result);
        assert.equal(result.version, '1.2.3');
    });

    it('coerces partial versions', () => {
        const result = coerceVersion('1.2');
        assert.ok(result);
        assert.equal(result.version, '1.2.0');
    });

    it('returns null for unparseable garbage', () => {
        assert.equal(coerceVersion('not-a-version'), null);
    });
});

describe('compareVersions', () => {
    it('returns -1 when a < b', () => {
        assert.equal(compareVersions('1.0.0', '1.0.1'), -1);
        assert.equal(compareVersions('1.0.0', '2.0.0'), -1);
    });

    it('returns 0 when equal', () => {
        assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
    });

    it('returns 1 when a > b', () => {
        assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
    });

    it('handles v-prefixed versions via coerce', () => {
        assert.equal(compareVersions('v1.0.0', '1.0.0'), 0);
    });

    it('falls back to dotted compare for 4-segment versions', () => {
        // semver.coerce drops the 4th segment, so 3.7.0.1 and 3.7.0 coerce equal.
        // The fallback path is only hit when both inputs fail coercion.
        assert.equal(compareVersions('not-a-version', 'also-bad'), 0);
    });

    it('compareDotted: equal-length segments', () => {
        // Both unparseable, fall back to dotted compare
        assert.equal(compareVersions('abc.1.2', 'abc.1.3'), -1);
        assert.equal(compareVersions('abc.2.0', 'abc.1.9'), 1);
    });

    it('compareDotted: unequal-length pads with 0', () => {
        assert.equal(compareVersions('abc.1', 'abc.1.0'), 0);
        assert.equal(compareVersions('abc.1.0.1', 'abc.1.0'), 1);
    });
});

describe('filterNewerVersions', () => {
    it('keeps only versions newer than current, sorted ascending', () => {
        const tags = ['v1.0.0', 'v1.2.0', 'v1.1.0', 'v0.9.0'];
        const result = filterNewerVersions('1.0.0', tags);
        assert.deepEqual(result, [
            { tag: 'v1.1.0', version: '1.1.0' },
            { tag: 'v1.2.0', version: '1.2.0' },
        ]);
    });

    it('drops pre-releases by default', () => {
        const tags = ['v1.1.0', 'v1.2.0-rc1', 'v1.2.0'];
        const result = filterNewerVersions('1.0.0', tags);
        assert.deepEqual(result.map(v => v.version), ['1.1.0', '1.2.0']);
    });

    it('includes pre-releases when opted in', () => {
        const tags = ['v1.1.0', 'v1.2.0-rc1', 'v1.2.0'];
        const result = filterNewerVersions('1.0.0', tags, { includePrereleases: true });
        const versions = result.map(v => v.version);
        assert.ok(versions.includes('1.2.0-rc1'));
        assert.ok(versions.includes('1.1.0'));
        assert.ok(versions.includes('1.2.0'));
    });

    it('respects excludePatterns', () => {
        const tags = ['v1.1.0', 'v1.2.0-internal', 'v1.3.0'];
        const result = filterNewerVersions('1.0.0', tags, {
            excludePatterns: ['internal'],
        });
        assert.deepEqual(result.map(v => v.tag), ['v1.1.0', 'v1.3.0']);
    });

    it('drops unparseable tags', () => {
        const tags = ['v1.1.0', 'random-junk', 'v1.2.0'];
        const result = filterNewerVersions('1.0.0', tags);
        assert.deepEqual(result.map(v => v.version), ['1.1.0', '1.2.0']);
    });

    it('returns empty when current is highest', () => {
        const tags = ['v0.1.0', 'v0.5.0', 'v1.0.0'];
        const result = filterNewerVersions('1.0.0', tags);
        assert.deepEqual(result, []);
    });

    it('handles empty tag list', () => {
        assert.deepEqual(filterNewerVersions('1.0.0', []), []);
    });

    it('uses default options when none provided', () => {
        const tags = ['v1.1.0', 'v1.2.0-beta'];
        const result = filterNewerVersions('1.0.0', tags);
        assert.deepEqual(result.map(v => v.version), ['1.1.0']);
    });
});

describe('isInitialVersion', () => {
    it('returns true for empty string', () => {
        assert.equal(isInitialVersion(''), true);
    });

    it('returns true for undefined', () => {
        assert.equal(isInitialVersion(undefined), true);
    });

    it('returns true for 0.0.0', () => {
        assert.equal(isInitialVersion('0.0.0'), true);
    });

    it('returns false for any real version', () => {
        assert.equal(isInitialVersion('1.0.0'), false);
        assert.equal(isInitialVersion('0.0.1'), false);
    });
});
