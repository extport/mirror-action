import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const calls = {
    info: [], debug: [], setOutput: {}, setFailed: [],
    inputs: {},
};

mock.module('@actions/core', {
    namedExports: {
        info: (m) => calls.info.push(m),
        debug: (m) => calls.debug.push(m),
        warning: () => {},
        error: () => {},
        getInput: (name, opts) => {
            const v = calls.inputs[name];
            if (opts?.required && !v) throw new Error(`Input required: ${name}`);
            return v ?? '';
        },
        setOutput: (k, v) => { calls.setOutput[k] = v; },
        setFailed: (m) => { calls.setFailed.push(m); process.exitCode = 1; },
    },
});

const { runResolveMatrix } = await import('../src/resolve-matrix.js');

const minimalConfig = {
    upstream: { repo: 'foo/bar', type: 'github' },
    php_ext_name: 'foo',
};

let workDir;
let originalCwd;

beforeEach(() => {
    originalCwd = process.cwd();
    workDir = mkdtempSync(join(tmpdir(), 'resolve-matrix-test-'));
    process.chdir(workDir);
    calls.info.length = 0;
    calls.debug.length = 0;
    calls.setFailed.length = 0;
    Object.keys(calls.setOutput).forEach(k => delete calls.setOutput[k]);
    Object.keys(calls.inputs).forEach(k => delete calls.inputs[k]);
    process.exitCode = 0;
});

afterEach(() => {
    process.chdir(originalCwd);
    rmSync(workDir, { recursive: true, force: true });
    process.exitCode = 0;
});

describe('runResolveMatrix', () => {
    it('reports disabled when build.enabled is false', async () => {
        writeFileSync('.extport.json', JSON.stringify(minimalConfig));
        calls.inputs['release-tag'] = 'v1.0.0';

        await runResolveMatrix();

        assert.equal(calls.setOutput['enabled'], 'false');
        assert.equal(calls.setOutput['release-tag'], 'v1.0.0');
        assert.equal(calls.setOutput['matrix'], undefined);
        assert.equal(calls.setOutput['build-path'], undefined);
    });

    it('sets matrix, build-path, configure-flags, apk-packages when enabled', async () => {
        writeFileSync('.extport.json', JSON.stringify({
            ...minimalConfig,
            build: {
                enabled: true,
                'configure-flags': '--enable-foo',
                'apk-packages': 'openssl-dev',
                'php-version-constraints': [
                    { 'ext-versions': '*', 'php-versions': ['8.3', '8.4'] },
                ],
            },
        }));
        calls.inputs['release-tag'] = 'v2.1.0';

        await runResolveMatrix();

        assert.equal(calls.setOutput['enabled'], 'true');
        assert.equal(calls.setOutput['release-tag'], 'v2.1.0');
        assert.equal(calls.setOutput['configure-flags'], '--enable-foo');
        assert.equal(calls.setOutput['apk-packages'], 'openssl-dev');

        const matrix = JSON.parse(calls.setOutput['matrix']);
        assert.ok(Array.isArray(matrix.include));
        assert.ok(matrix.include.length > 0);
        for (const entry of matrix.include) {
            assert.ok(['8.3', '8.4'].includes(entry.php));
        }

        assert.equal(calls.setOutput['build-path'], 'src');
    });

    it('respects explicit build-path under source_dir', async () => {
        writeFileSync('.extport.json', JSON.stringify({
            ...minimalConfig,
            source_dir: 'ext/',
            build: {
                enabled: true,
                'build-path': 'redis',
                'php-version-constraints': [
                    { 'ext-versions': '*', 'php-versions': ['8.3'] },
                ],
            },
        }));
        calls.inputs['release-tag'] = 'v1.0.0';

        await runResolveMatrix();
        assert.equal(calls.setOutput['build-path'], 'ext/redis');
    });
});
