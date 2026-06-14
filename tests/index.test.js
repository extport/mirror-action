import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
    mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Drive src/index.js end-to-end with the real @actions/core wiring. Inputs
// come from INPUT_* env vars, outputs land in the GITHUB_OUTPUT env file.
// We pick `validate` mode because it's purely filesystem-driven, so the test
// avoids needing network or git mocks. Coverage of the other dispatch arms
// in index.js is intentionally accepted as unmeasured — Node's coverage
// merge does not unify cache-busted dynamic imports.

const workDir = mkdtempSync(join(tmpdir(), 'index-test-'));
const outputFile = join(workDir, 'github-output');
const originalCwd = process.cwd();

const validMirror = { upstream: { repo: 'foo/bar', type: 'github' }, php_ext_name: 'foo' };
const validComposer = {
    name: 'foo/bar', type: 'php-ext', version: '1.0.0',
    'php-ext': { 'extension-name': 'foo' },
};

before(() => {
    process.chdir(workDir);
    writeFileSync('.extport.json', JSON.stringify(validMirror));
    writeFileSync('composer.json', JSON.stringify(validComposer));
    mkdirSync('src/');
    writeFileSync('src/config.m4', '');
    writeFileSync(outputFile, '');
    process.env.GITHUB_OUTPUT = outputFile;
    process.env.INPUT_MODE = 'validate';
    process.env['INPUT_GITHUB-TOKEN'] = 'tok';
    process.env.INPUT_GITHUB_TOKEN = 'tok';
});

after(() => {
    process.chdir(originalCwd);
    rmSync(workDir, { recursive: true, force: true });
    delete process.env.GITHUB_OUTPUT;
    delete process.env.INPUT_MODE;
    delete process.env['INPUT_GITHUB-TOKEN'];
    delete process.env.INPUT_GITHUB_TOKEN;
    process.exitCode = 0;
});

describe('index — main dispatch', () => {
    it('runs validate mode end-to-end via real action wiring', async () => {
        await import('../src/index.js');
        // Let the top-level `main().catch(...)` settle.
        await new Promise(r => setImmediate(r));
        await new Promise(r => setImmediate(r));

        const raw = readFileSync(outputFile, 'utf-8');
        assert.ok(
            raw.includes('validation-passed') && raw.includes('true'),
            `Expected validation-passed=true in: ${raw}`
        );
    });
});
