import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const calls = {
    info: [], warning: [], error: [], setFailed: [], setOutput: {},
};

mock.module('@actions/core', {
    namedExports: {
        info: (m) => calls.info.push(m),
        warning: (m) => calls.warning.push(m),
        error: (m) => calls.error.push(m),
        setFailed: (m) => { calls.setFailed.push(m); process.exitCode = 1; },
        setOutput: (k, v) => { calls.setOutput[k] = v; },
        getInput: (name) => process.env[`INPUT_${name.toUpperCase().replace(/-/g, '_')}`] || '',
        debug: () => {},
        startGroup: () => {},
        endGroup: () => {},
    },
});

const { runValidate } = await import('../src/validate.js');

const validMirror = { upstream: { repo: 'foo/bar', type: 'github' }, php_ext_name: 'foo' };
const validComposer = {
    name: 'foo/bar',
    type: 'php-ext',
    version: '1.0.0',
    'php-ext': { 'extension-name': 'foo' },
};

let workDir;
let originalCwd;

function writeFiles({ mirror, composer, sourceDir, buildFile } = {}) {
    if (mirror !== false) writeFileSync('.extport.json', JSON.stringify(mirror ?? validMirror));
    if (composer !== false) writeFileSync('composer.json', typeof composer === 'string' ? composer : JSON.stringify(composer ?? validComposer));
    if (sourceDir !== false) mkdirSync(sourceDir ?? 'src/', { recursive: true });
    if (buildFile) writeFileSync(join(sourceDir ?? 'src/', buildFile), '');
}

beforeEach(() => {
    originalCwd = process.cwd();
    workDir = mkdtempSync(join(tmpdir(), 'validate-test-'));
    process.chdir(workDir);
    calls.info.length = 0;
    calls.warning.length = 0;
    calls.error.length = 0;
    calls.setFailed.length = 0;
    Object.keys(calls.setOutput).forEach(k => delete calls.setOutput[k]);
    process.exitCode = 0;
});

afterEach(() => {
    process.chdir(originalCwd);
    rmSync(workDir, { recursive: true, force: true });
    process.exitCode = 0;
});

describe('runValidate — happy paths', () => {
    it('passes with valid files and a build file present', async () => {
        writeFiles({ buildFile: 'config.m4' });
        await runValidate();
        assert.equal(calls.setOutput['validation-passed'], 'true');
        assert.equal(calls.setFailed.length, 0);
    });

    it('passes on initial sync (version 0.0.0) without a build file', async () => {
        writeFiles({ composer: { ...validComposer, version: '0.0.0' } });
        await runValidate();
        assert.equal(calls.setOutput['validation-passed'], 'true');
        assert.equal(calls.setFailed.length, 0);
    });

    it('accepts php-ext-zend as composer type', async () => {
        writeFiles({
            composer: { ...validComposer, type: 'php-ext-zend' },
            buildFile: 'configure.ac',
        });
        await runValidate();
        assert.equal(calls.setOutput['validation-passed'], 'true');
    });

    it('accepts CMakeLists.txt as a build file', async () => {
        writeFiles({ buildFile: 'CMakeLists.txt' });
        await runValidate();
        assert.equal(calls.setOutput['validation-passed'], 'true');
    });
});

describe('runValidate — failure paths', () => {
    it('fails when .extport.json is missing', async () => {
        writeFiles({ mirror: false, buildFile: 'config.m4' });
        await runValidate();
        assert.equal(calls.setOutput['validation-passed'], 'false');
        assert.ok(calls.error.some(e => e.includes('.extport.json')));
    });

    it('fails when composer.json is missing', async () => {
        writeFiles({ composer: false, buildFile: 'config.m4' });
        await runValidate();
        assert.equal(calls.setOutput['validation-passed'], 'false');
        assert.ok(calls.error.some(e => e.includes('composer.json not found')));
    });

    it('fails when composer.json type is wrong', async () => {
        writeFiles({
            composer: { ...validComposer, type: 'library' },
            buildFile: 'config.m4',
        });
        await runValidate();
        assert.equal(calls.setOutput['validation-passed'], 'false');
        assert.ok(calls.error.some(e => /"type" must be/.test(e)));
    });

    it('fails when extension-name is missing', async () => {
        writeFiles({
            composer: { ...validComposer, 'php-ext': {} },
            buildFile: 'config.m4',
        });
        await runValidate();
        assert.equal(calls.setOutput['validation-passed'], 'false');
        assert.ok(calls.error.some(e => /extension-name.*required/.test(e)));
    });

    it('fails when version field is missing', async () => {
        const { version, ...rest } = validComposer;
        writeFiles({ composer: rest, buildFile: 'config.m4' });
        await runValidate();
        assert.equal(calls.setOutput['validation-passed'], 'false');
        assert.ok(calls.error.some(e => /"version" field is required/.test(e)));
    });

    it('fails when extension-name mismatches php_ext_name', async () => {
        writeFiles({
            composer: { ...validComposer, 'php-ext': { 'extension-name': 'other' } },
            buildFile: 'config.m4',
        });
        await runValidate();
        assert.equal(calls.setOutput['validation-passed'], 'false');
        assert.ok(calls.error.some(e => /Mismatch/.test(e)));
    });

    it('fails when source dir does not exist', async () => {
        writeFiles({ sourceDir: false });
        await runValidate();
        assert.equal(calls.setOutput['validation-passed'], 'false');
        assert.ok(calls.error.some(e => /does not exist/.test(e)));
    });

    it('fails for non-initial sync without any build file', async () => {
        writeFiles();
        await runValidate();
        assert.equal(calls.setOutput['validation-passed'], 'false');
        assert.ok(calls.error.some(e => /build file/.test(e)));
    });

    it('fails when composer.json is malformed JSON', async () => {
        // Omit source dir too — validate.js re-reads composer.json on the
        // build-file branch, which would re-throw an unguarded JSON parse error.
        writeFiles({ composer: '{ broken', sourceDir: false });
        await runValidate();
        assert.equal(calls.setOutput['validation-passed'], 'false');
        assert.ok(calls.error.some(e => /composer\.json: failed to parse/.test(e)));
    });
});
