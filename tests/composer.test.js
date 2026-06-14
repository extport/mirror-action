import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    readComposer,
    writeComposer,
    readComposerVersion,
    writeComposerVersion,
} from '../src/utils/composer.js';

let workDir;
let composerPath;

beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'composer-test-'));
    composerPath = join(workDir, 'composer.json');
});

afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
});

describe('readComposer', () => {
    it('parses a composer.json file', () => {
        const data = {
            name: 'foo/bar',
            type: 'php-ext',
            version: '1.2.3',
            'php-ext': { 'extension-name': 'foo' },
        };
        writeFileSync(composerPath, JSON.stringify(data));
        assert.deepEqual(readComposer(composerPath), data);
    });

    it('throws on malformed JSON', () => {
        writeFileSync(composerPath, '{ not valid json');
        assert.throws(() => readComposer(composerPath));
    });

    it('throws when file is missing', () => {
        assert.throws(() => readComposer(join(workDir, 'missing.json')));
    });
});

describe('writeComposer', () => {
    it('writes 4-space indent with trailing newline', () => {
        writeComposer({ name: 'foo/bar', version: '1.0.0' }, composerPath);
        const raw = readFileSync(composerPath, 'utf-8');
        assert.ok(raw.endsWith('\n'));
        assert.ok(raw.includes('    "name"'));
    });

    it('round-trips arbitrary data', () => {
        const data = {
            name: 'foo/bar',
            nested: { a: 1, b: [2, 3] },
            version: '2.0.0',
        };
        writeComposer(data, composerPath);
        assert.deepEqual(readComposer(composerPath), data);
    });
});

describe('readComposerVersion', () => {
    it('returns version string', () => {
        writeFileSync(composerPath, JSON.stringify({ version: '3.4.5' }));
        assert.equal(readComposerVersion(composerPath), '3.4.5');
    });

    it('returns undefined when missing', () => {
        writeFileSync(composerPath, JSON.stringify({ name: 'foo/bar' }));
        assert.equal(readComposerVersion(composerPath), undefined);
    });
});

describe('writeComposerVersion', () => {
    it('updates version without disturbing other fields', () => {
        const data = {
            name: 'foo/bar',
            type: 'php-ext',
            version: '1.0.0',
            'php-ext': { 'extension-name': 'foo' },
            require: { php: '>=8.2' },
        };
        writeFileSync(composerPath, JSON.stringify(data));
        writeComposerVersion('2.0.0', composerPath);
        const updated = readComposer(composerPath);
        assert.equal(updated.version, '2.0.0');
        assert.equal(updated.name, 'foo/bar');
        assert.equal(updated.type, 'php-ext');
        assert.deepEqual(updated['php-ext'], { 'extension-name': 'foo' });
        assert.deepEqual(updated.require, { php: '>=8.2' });
    });

    it('adds version when not previously present', () => {
        writeFileSync(composerPath, JSON.stringify({ name: 'foo/bar' }));
        writeComposerVersion('1.0.0', composerPath);
        assert.equal(readComposerVersion(composerPath), '1.0.0');
    });
});
