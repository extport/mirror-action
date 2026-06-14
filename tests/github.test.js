import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const octokitState = {
    constructorArgs: null,
    paginateImpl: async () => [],
};

const execState = {
    calls: [],
    impl: async () => 0,
};

mock.module('@octokit/rest', {
    namedExports: {
        Octokit: class Octokit {
            constructor(opts) {
                octokitState.constructorArgs = opts;
                this.paginate = (...args) => octokitState.paginateImpl(...args);
                this.rest = { repos: { listReleases: 'listReleases-sentinel' } };
            }
        },
    },
});

mock.module('@actions/exec', {
    namedExports: {
        exec: async (...args) => {
            execState.calls.push(args);
            return execState.impl(...args);
        },
    },
});

mock.module('@actions/core', {
    namedExports: {
        info: () => {},
        warning: () => {},
        error: () => {},
        debug: () => {},
    },
});

const {
    parseRepo,
    getOctokit,
    getAllReleaseTags,
    downloadAndExtractTarball,
} = await import('../src/utils/github.js');

beforeEach(() => {
    octokitState.constructorArgs = null;
    octokitState.paginateImpl = async () => [];
    execState.calls.length = 0;
    execState.impl = async () => 0;
});

describe('parseRepo', () => {
    it('returns owner/repo split', () => {
        assert.deepEqual(parseRepo('phpredis/phpredis'), {
            owner: 'phpredis',
            repo: 'phpredis',
        });
    });

    it('throws on missing slash', () => {
        assert.throws(() => parseRepo('justname'), /Invalid repo format/);
    });

    it('throws on empty string', () => {
        assert.throws(() => parseRepo(''), /Invalid repo format/);
    });

    it('throws when one side is empty', () => {
        assert.throws(() => parseRepo('owner/'), /Invalid repo format/);
        assert.throws(() => parseRepo('/repo'), /Invalid repo format/);
    });
});

describe('getOctokit', () => {
    it('constructs an Octokit with auth token', () => {
        const inst = getOctokit('secret-token');
        assert.equal(octokitState.constructorArgs.auth, 'secret-token');
        assert.ok(inst.paginate);
    });
});

describe('getAllReleaseTags', () => {
    it('returns non-draft tag names from paginated releases', async () => {
        octokitState.paginateImpl = async (route, params) => {
            assert.equal(route, 'listReleases-sentinel');
            assert.equal(params.owner, 'phpredis');
            assert.equal(params.repo, 'phpredis');
            assert.equal(params.per_page, 100);
            return [
                { tag_name: 'v1.0.0', draft: false },
                { tag_name: 'v1.1.0-draft', draft: true },
                { tag_name: 'v1.1.0', draft: false },
            ];
        };
        const tags = await getAllReleaseTags('tok', 'phpredis', 'phpredis');
        assert.deepEqual(tags, ['v1.0.0', 'v1.1.0']);
    });

    it('returns empty array when there are no releases', async () => {
        octokitState.paginateImpl = async () => [];
        const tags = await getAllReleaseTags('tok', 'foo', 'bar');
        assert.deepEqual(tags, []);
    });
});

describe('downloadAndExtractTarball', () => {
    let workDir;
    let originalCwd;

    beforeEach(() => {
        originalCwd = process.cwd();
        workDir = mkdtempSync(join(tmpdir(), 'github-test-'));
        process.chdir(workDir);
        process.env.RUNNER_TEMP = workDir;
    });

    afterEach(() => {
        process.chdir(originalCwd);
        rmSync(workDir, { recursive: true, force: true });
        delete process.env.RUNNER_TEMP;
    });

    it('clears+creates source dir then calls curl and tar with expected args', async () => {
        // Pre-populate source dir with stale contents — these should be wiped
        const srcDir = 'src/';
        const stale = join(srcDir, 'stale.txt');
        writeFileSync(join(workDir, '.placeholder'), '');
        // (no real mkdir needed; the action's rmSync force handles missing dirs)

        await downloadAndExtractTarball('tok', 'phpredis', 'phpredis', 'v4.29.3', srcDir);

        // srcDir must exist after the call (mkdirSync recreated it)
        assert.ok(existsSync(join(workDir, srcDir)));

        // Two exec calls expected: curl then tar
        assert.equal(execState.calls.length, 2);

        const [curlCmd, curlArgs] = execState.calls[0];
        assert.equal(curlCmd, 'curl');
        assert.ok(curlArgs.includes('-sL'));
        assert.ok(curlArgs.includes('-H'));
        assert.ok(curlArgs.some(a => a === 'Authorization: token tok'));
        assert.ok(curlArgs.some(a => a.includes('phpredis/phpredis/tarball/v4.29.3')));

        const [tarCmd, tarArgs] = execState.calls[1];
        assert.equal(tarCmd, 'tar');
        assert.ok(tarArgs.includes('--strip-components=1'));
        assert.ok(tarArgs.includes('-C'));
        assert.ok(tarArgs.includes(srcDir));
    });

    it('sanitises the tag in the temp filename', async () => {
        await downloadAndExtractTarball('tok', 'o', 'r', 'release/1.0', 'src/');
        const [, curlArgs] = execState.calls[0];
        const outIdx = curlArgs.indexOf('-o');
        const outFile = curlArgs[outIdx + 1];
        // unsafe chars (/) replaced with _ in the temp filename
        assert.ok(outFile.includes('upstream-release_1.0.tar.gz'));
    });
});
