import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPostExtractHooks } from '../src/utils/hooks.js';

let workDir;
let marker;

beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'hooks-test-'));
    marker = join(workDir, 'marker.txt');
});

afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
});

describe('runPostExtractHooks', () => {
    it('is a no-op when commands list is empty', async () => {
        await runPostExtractHooks({
            commands: [],
            tag: 'v1.0.0',
            version: '1.0.0',
            sourceDir: 'src/',
        });
        assert.equal(existsSync(marker), false);
    });

    it('exposes PIE_SYNC_TAG / PIE_SYNC_VERSION / PIE_SOURCE_DIR to commands', async () => {
        await runPostExtractHooks({
            commands: [
                `printf '%s\\n%s\\n%s\\n' "$PIE_SYNC_TAG" "$PIE_SYNC_VERSION" "$PIE_SOURCE_DIR" > ${marker}`,
            ],
            tag: 'v4.29.3',
            version: '4.29.3',
            sourceDir: 'src/',
        });
        const contents = readFileSync(marker, 'utf-8');
        assert.equal(contents, 'v4.29.3\n4.29.3\nsrc/\n');
    });

    it('runs multiple commands in order', async () => {
        await runPostExtractHooks({
            commands: [
                `printf 'a' >> ${marker}`,
                `printf 'b' >> ${marker}`,
                `printf 'c' >> ${marker}`,
            ],
            tag: 'v1', version: '1', sourceDir: 'src/',
        });
        assert.equal(readFileSync(marker, 'utf-8'), 'abc');
    });

    it('throws when a command exits non-zero', async () => {
        await assert.rejects(
            runPostExtractHooks({
                commands: ['exit 7'],
                tag: 'v1', version: '1', sourceDir: 'src/',
            }),
            /exit code 7/
        );
    });

    it('halts execution after a failing command', async () => {
        await assert.rejects(
            runPostExtractHooks({
                commands: [
                    `printf 'first' > ${marker}`,
                    'exit 3',
                    `printf 'last' >> ${marker}`,
                ],
                tag: 'v1', version: '1', sourceDir: 'src/',
            }),
            /exit code 3/
        );
        assert.equal(readFileSync(marker, 'utf-8'), 'first');
    });
});
