import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// --- Shared mock state ---

const calls = {
    info: [], warning: [], error: [], setFailed: [], setOutput: {},
    inputs: {},
    upstreamTags: [],
    downloadCalls: [],
    hookCalls: [],
    gitConfigureCalls: 0,
    gitCommitCalls: [],
    gitPushCalls: [],
    gitResetCalls: 0,
    releaseCalls: [],
    markLatestCalls: [],
    // Throw control: { fn: 'downloadAndExtractTarball', onCall: 2, error: Error(...) }
    throwOn: null,
};

mock.module('@actions/core', {
    namedExports: {
        info: (m) => calls.info.push(m),
        warning: (m) => calls.warning.push(m),
        error: (m) => calls.error.push(m),
        debug: () => {},
        startGroup: () => {},
        endGroup: () => {},
        getInput: (name) => calls.inputs[name] ?? '',
        setOutput: (k, v) => { calls.setOutput[k] = v; },
        setFailed: (m) => { calls.setFailed.push(m); process.exitCode = 1; },
    },
});

function maybeThrow(fnName) {
    if (calls.throwOn && calls.throwOn.fn === fnName) {
        calls.throwOn.count = (calls.throwOn.count ?? 0) + 1;
        if (calls.throwOn.count === calls.throwOn.onCall) {
            throw calls.throwOn.error;
        }
    }
}

mock.module('../src/utils/github.js', {
    namedExports: {
        getAllReleaseTags: async () => calls.upstreamTags.slice(),
        downloadAndExtractTarball: async (token, owner, repo, tag, sourceDir) => {
            calls.downloadCalls.push({ token, owner, repo, tag, sourceDir });
            maybeThrow('downloadAndExtractTarball');
        },
        parseRepo: (full) => {
            const [owner, repo] = full.split('/');
            return { owner, repo };
        },
    },
});

mock.module('../src/utils/git.js', {
    namedExports: {
        configureGit: async () => { calls.gitConfigureCalls++; },
        commitAndTag: async (version, tag) => {
            calls.gitCommitCalls.push({ version, tag });
            maybeThrow('commitAndTag');
        },
        push: async (version) => { calls.gitPushCalls.push(version); },
        resetHard: async () => { calls.gitResetCalls++; },
    },
});

mock.module('../src/utils/hooks.js', {
    namedExports: {
        runPostExtractHooks: async (opts) => { calls.hookCalls.push(opts); },
    },
});

mock.module('../src/release.js', {
    namedExports: {
        createRelease: async (token, version, tag, config) => {
            calls.releaseCalls.push({ token, version, tag, config });
        },
        markAsLatest: async (token, version) => {
            calls.markLatestCalls.push({ token, version });
        },
    },
});

const { runSync } = await import('../src/sync.js');

// --- Test helpers ---

function resetCalls() {
    calls.info.length = 0;
    calls.warning.length = 0;
    calls.error.length = 0;
    calls.setFailed.length = 0;
    Object.keys(calls.setOutput).forEach(k => delete calls.setOutput[k]);
    Object.keys(calls.inputs).forEach(k => delete calls.inputs[k]);
    calls.upstreamTags.length = 0;
    calls.downloadCalls.length = 0;
    calls.hookCalls.length = 0;
    calls.gitConfigureCalls = 0;
    calls.gitCommitCalls.length = 0;
    calls.gitPushCalls.length = 0;
    calls.gitResetCalls = 0;
    calls.releaseCalls.length = 0;
    calls.markLatestCalls.length = 0;
    calls.throwOn = null;
}

const minimalConfig = {
    upstream: { repo: 'phpredis/phpredis', type: 'github' },
    php_ext_name: 'redis',
};

let workDir;
let originalCwd;

function setup({ config = minimalConfig, version = '1.0.0' } = {}) {
    writeFileSync('.extport.json', JSON.stringify(config));
    writeFileSync('composer.json', JSON.stringify({
        name: 'foo/bar',
        type: 'php-ext',
        version,
        'php-ext': { 'extension-name': 'redis' },
    }));
    mkdirSync('src', { recursive: true });
}

function readComposerVersion() {
    return JSON.parse(readFileSync('composer.json', 'utf-8')).version;
}

beforeEach(() => {
    originalCwd = process.cwd();
    workDir = mkdtempSync(join(tmpdir(), 'sync-test-'));
    process.chdir(workDir);
    resetCalls();
    process.exitCode = 0;
});

afterEach(() => {
    process.chdir(originalCwd);
    rmSync(workDir, { recursive: true, force: true });
    process.exitCode = 0;
});

// --- Tests ---

describe('runSync — early exits', () => {
    it('writes empty outputs and skips git when no upstream releases', async () => {
        setup();
        calls.upstreamTags.push();

        await runSync({ token: 'tok' });

        assert.equal(calls.setOutput['synced-versions'], '[]');
        assert.equal(calls.setOutput['latest-version'], '');
        assert.equal(calls.gitConfigureCalls, 0);
        assert.equal(calls.downloadCalls.length, 0);
    });

    it('writes empty outputs when already up to date', async () => {
        setup({ version: '5.0.0' });
        calls.upstreamTags.push('v1.0.0', 'v4.0.0', 'v5.0.0');

        await runSync({ token: 'tok' });

        assert.equal(calls.setOutput['synced-versions'], '[]');
        assert.equal(calls.gitConfigureCalls, 0);
    });
});

describe('runSync — initial sync', () => {
    it('on version 0.0.0 limits to the last initial-versions tags', async () => {
        setup({
            config: { ...minimalConfig, sync: { 'initial-versions': 2 } },
            version: '0.0.0',
        });
        calls.upstreamTags.push('v1.0.0', 'v2.0.0', 'v3.0.0', 'v4.0.0');

        await runSync({ token: 'tok' });

        const synced = JSON.parse(calls.setOutput['synced-versions']);
        assert.deepEqual(synced, ['3.0.0', '4.0.0']);
        assert.equal(calls.setOutput['latest-version'], '4.0.0');
        assert.equal(readComposerVersion(), '4.0.0');
    });

    it('max-versions input overrides initial-versions for initial sync', async () => {
        setup({
            config: { ...minimalConfig, sync: { 'initial-versions': 5 } },
            version: '0.0.0',
        });
        calls.upstreamTags.push('v1.0.0', 'v2.0.0', 'v3.0.0', 'v4.0.0');
        calls.inputs['max-versions'] = '1';

        await runSync({ token: 'tok' });

        const synced = JSON.parse(calls.setOutput['synced-versions']);
        assert.deepEqual(synced, ['4.0.0']);
    });
});

describe('runSync — incremental sync', () => {
    it('max-versions input clamps non-initial sync from the front', async () => {
        setup({ version: '1.0.0' });
        calls.upstreamTags.push('v2.0.0', 'v3.0.0', 'v4.0.0');
        calls.inputs['max-versions'] = '2';

        await runSync({ token: 'tok' });

        const synced = JSON.parse(calls.setOutput['synced-versions']);
        assert.deepEqual(synced, ['2.0.0', '3.0.0']);
        assert.ok(calls.warning.some(w => /Limiting sync/.test(w)));
    });

    it('runs the full pipeline per version and marks the highest as latest', async () => {
        setup({ version: '1.0.0' });
        calls.upstreamTags.push('v1.1.0', 'v1.2.0');

        await runSync({ token: 'tok' });

        assert.equal(calls.gitConfigureCalls, 1);
        assert.equal(calls.downloadCalls.length, 2);
        assert.equal(calls.downloadCalls[0].tag, 'v1.1.0');
        assert.equal(calls.downloadCalls[1].tag, 'v1.2.0');

        assert.equal(calls.hookCalls.length, 2);
        assert.equal(calls.gitCommitCalls.length, 2);
        assert.deepEqual(calls.gitCommitCalls.map(c => c.version), ['1.1.0', '1.2.0']);

        assert.deepEqual(calls.gitPushCalls, ['1.1.0', '1.2.0']);

        assert.equal(calls.releaseCalls.length, 2);
        assert.equal(calls.releaseCalls[0].version, '1.1.0');
        assert.equal(calls.releaseCalls[1].version, '1.2.0');

        assert.equal(calls.markLatestCalls.length, 1);
        assert.equal(calls.markLatestCalls[0].version, '1.2.0');

        assert.equal(readComposerVersion(), '1.2.0');
        assert.equal(calls.setOutput['latest-version'], '1.2.0');
    });

    it('does NOT mark latest when build.enabled is true', async () => {
        setup({
            config: { ...minimalConfig, build: { enabled: true } },
            version: '1.0.0',
        });
        calls.upstreamTags.push('v1.1.0');

        await runSync({ token: 'tok' });

        assert.equal(calls.releaseCalls.length, 1);
        assert.equal(calls.markLatestCalls.length, 0);
    });
});

describe('runSync — dry run', () => {
    it('writes outputs but skips all side effects', async () => {
        setup({ version: '1.0.0' });
        calls.upstreamTags.push('v1.1.0', 'v1.2.0');
        calls.inputs['dry-run'] = 'true';

        await runSync({ token: 'tok' });

        assert.equal(calls.gitConfigureCalls, 0);
        assert.equal(calls.downloadCalls.length, 0);
        assert.equal(calls.releaseCalls.length, 0);

        const synced = JSON.parse(calls.setOutput['synced-versions']);
        assert.deepEqual(synced, ['1.1.0', '1.2.0']);
        assert.equal(calls.setOutput['latest-version'], '1.2.0');
    });
});

describe('runSync — failure handling', () => {
    it('resets, marks failed, and stops on mid-sync error', async () => {
        setup({ version: '1.0.0' });
        calls.upstreamTags.push('v1.1.0', 'v1.2.0', 'v1.3.0');
        calls.throwOn = {
            fn: 'commitAndTag',
            onCall: 2,
            error: new Error('git rejected'),
        };

        await runSync({ token: 'tok' });

        const synced = JSON.parse(calls.setOutput['synced-versions']);
        assert.deepEqual(synced, ['1.1.0']);
        assert.equal(calls.gitResetCalls, 1);
        assert.ok(calls.setFailed.some(m => /1\.2\.0/.test(m)));
        assert.equal(process.exitCode, 1);
    });
});

describe('runSync — excludePatterns and prereleases', () => {
    it('respects exclude-tags from config', async () => {
        setup({
            config: {
                ...minimalConfig,
                sync: { 'exclude-tags': ['internal'] },
            },
            version: '1.0.0',
        });
        calls.upstreamTags.push('v1.1.0', 'v1.2.0-internal', 'v1.3.0');

        await runSync({ token: 'tok' });

        const synced = JSON.parse(calls.setOutput['synced-versions']);
        assert.deepEqual(synced, ['1.1.0', '1.3.0']);
    });

    it('includes prereleases when configured', async () => {
        setup({
            config: { ...minimalConfig, sync: { prereleases: true } },
            version: '1.0.0',
        });
        calls.upstreamTags.push('v1.1.0', 'v1.2.0-rc1');

        await runSync({ token: 'tok' });

        const synced = JSON.parse(calls.setOutput['synced-versions']);
        assert.ok(synced.includes('1.1.0'));
        assert.ok(synced.some(v => /rc/.test(v) || v === '1.2.0-rc1'));
    });
});
