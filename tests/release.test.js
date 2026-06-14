import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const octokitState = {
    createReleaseImpl: async () => ({}),
    getReleaseByTagImpl: async () => ({ data: { id: 0 } }),
    updateReleaseImpl: async () => ({}),
    lastCreateRelease: null,
    lastGetReleaseByTag: null,
    lastUpdateRelease: null,
};

const coreCalls = { info: [], warning: [], error: [] };

mock.module('@octokit/rest', {
    namedExports: {
        Octokit: class Octokit {
            constructor() {
                this.rest = {
                    repos: {
                        createRelease: async (args) => {
                            octokitState.lastCreateRelease = args;
                            return octokitState.createReleaseImpl(args);
                        },
                        getReleaseByTag: async (args) => {
                            octokitState.lastGetReleaseByTag = args;
                            return octokitState.getReleaseByTagImpl(args);
                        },
                        updateRelease: async (args) => {
                            octokitState.lastUpdateRelease = args;
                            return octokitState.updateReleaseImpl(args);
                        },
                    },
                };
            }
        },
    },
});

mock.module('@actions/core', {
    namedExports: {
        info: (m) => coreCalls.info.push(m),
        warning: (m) => coreCalls.warning.push(m),
        error: (m) => coreCalls.error.push(m),
        debug: () => {},
    },
});

const { createRelease, markAsLatest } = await import('../src/release.js');

beforeEach(() => {
    octokitState.lastCreateRelease = null;
    octokitState.lastGetReleaseByTag = null;
    octokitState.lastUpdateRelease = null;
    octokitState.createReleaseImpl = async () => ({});
    octokitState.getReleaseByTagImpl = async () => ({ data: { id: 0 } });
    octokitState.updateReleaseImpl = async () => ({});
    coreCalls.info.length = 0;
    coreCalls.warning.length = 0;
    coreCalls.error.length = 0;
    process.env.GITHUB_REPOSITORY = 'pie-extensions/redis';
});

const baseConfig = {
    upstream: { repo: 'phpredis/phpredis' },
    build: { enabled: false },
};

describe('createRelease', () => {
    it('creates a published release when builds are disabled', async () => {
        await createRelease('tok', '4.29.3', 'v4.29.3', baseConfig);
        assert.equal(octokitState.lastCreateRelease.owner, 'pie-extensions');
        assert.equal(octokitState.lastCreateRelease.repo, 'redis');
        assert.equal(octokitState.lastCreateRelease.tag_name, '4.29.3');
        assert.equal(octokitState.lastCreateRelease.name, '4.29.3');
        assert.equal(octokitState.lastCreateRelease.draft, false);
        assert.equal(octokitState.lastCreateRelease.prerelease, false);
        assert.equal(octokitState.lastCreateRelease.make_latest, 'false');

        const body = octokitState.lastCreateRelease.body;
        assert.ok(body.includes('phpredis/phpredis'));
        assert.ok(body.includes('v4.29.3'));
        assert.ok(body.includes('pie install pie-extensions/redis'));
    });

    it('creates a draft release when builds are enabled', async () => {
        await createRelease('tok', '1.0.0', 'v1.0.0', {
            ...baseConfig,
            build: { enabled: true },
        });
        assert.equal(octokitState.lastCreateRelease.draft, true);
    });

    it('is idempotent on 422 (release already exists)', async () => {
        octokitState.createReleaseImpl = async () => {
            const err = new Error('already exists');
            err.status = 422;
            throw err;
        };
        await createRelease('tok', '1.0.0', 'v1.0.0', baseConfig);
        assert.ok(coreCalls.warning.some(w => /already exists/.test(w)));
    });

    it('rethrows non-422 errors', async () => {
        octokitState.createReleaseImpl = async () => {
            const err = new Error('boom');
            err.status = 500;
            throw err;
        };
        await assert.rejects(
            () => createRelease('tok', '1.0.0', 'v1.0.0', baseConfig),
            /boom/
        );
    });
});

describe('markAsLatest', () => {
    it('looks up the release by tag and updates make_latest=true', async () => {
        octokitState.getReleaseByTagImpl = async () => ({ data: { id: 123 } });

        await markAsLatest('tok', '4.29.3');

        assert.equal(octokitState.lastGetReleaseByTag.owner, 'pie-extensions');
        assert.equal(octokitState.lastGetReleaseByTag.repo, 'redis');
        assert.equal(octokitState.lastGetReleaseByTag.tag, '4.29.3');
        assert.equal(octokitState.lastUpdateRelease.release_id, 123);
        assert.equal(octokitState.lastUpdateRelease.make_latest, 'true');
    });
});
