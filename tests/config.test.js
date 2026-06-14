import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig } from '../src/utils/config.js';

let workDir;
let configPath;

function writeConfig(obj) {
    writeFileSync(configPath, JSON.stringify(obj));
}

const minimalValid = {
    upstream: { repo: 'foo/bar', type: 'github' },
    php_ext_name: 'foo',
};

beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'config-test-'));
    configPath = join(workDir, '.extport.json');
});

afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
});

describe('readConfig — happy path', () => {
    it('applies all defaults for a minimal config', () => {
        writeConfig(minimalValid);
        const config = readConfig(configPath);

        assert.equal(config.source_dir, 'src/');
        assert.equal(config.upstream.type, 'github');
        assert.equal(config.sync.prereleases, false);
        assert.equal(config.sync['initial-versions'], 5);
        assert.deepEqual(config.sync['exclude-tags'], []);
        assert.deepEqual(config.hooks['post-extract'], []);
        assert.equal(config.build.enabled, false);
        assert.deepEqual(config.build.os, ['linux', 'darwin']);
        assert.deepEqual(config.build.arches, ['x86_64', 'arm64']);
        assert.deepEqual(config.build.zts, ['nts', 'ts']);
        assert.deepEqual(config.build.libc, ['glibc', 'musl']);
        assert.equal(config.build['configure-flags'], '');
        assert.equal(config.build['apk-packages'], '');
        assert.deepEqual(config.build['php-version-constraints'], [
            { 'ext-versions': '*', 'php-versions': ['8.2', '8.3', '8.4', '8.5'] },
        ]);
    });

    it('user-provided values override defaults', () => {
        writeConfig({
            ...minimalValid,
            source_dir: 'ext/',
            sync: { prereleases: true, 'initial-versions': 2, 'exclude-tags': ['internal'] },
            build: {
                enabled: true,
                os: ['linux'],
                arches: ['x86_64'],
                zts: ['nts'],
                libc: ['glibc'],
                'configure-flags': '--enable-foo',
                'apk-packages': 'openssl-dev',
                'php-version-constraints': [
                    { 'ext-versions': '>=2.0.0', 'php-versions': ['8.3', '8.4'] },
                ],
            },
        });
        const config = readConfig(configPath);
        assert.equal(config.source_dir, 'ext/');
        assert.equal(config.sync.prereleases, true);
        assert.equal(config.sync['initial-versions'], 2);
        assert.deepEqual(config.sync['exclude-tags'], ['internal']);
        assert.equal(config.build.enabled, true);
        assert.deepEqual(config.build.os, ['linux']);
        assert.equal(config.build['configure-flags'], '--enable-foo');
        assert.equal(config.build['apk-packages'], 'openssl-dev');
        assert.deepEqual(config.build['php-version-constraints'], [
            { 'ext-versions': '>=2.0.0', 'php-versions': ['8.3', '8.4'] },
        ]);
    });
});

describe('readConfig — required field validation', () => {
    it('throws when upstream.repo missing', () => {
        writeConfig({ upstream: { type: 'github' }, php_ext_name: 'foo' });
        assert.throws(() => readConfig(configPath), /upstream\.repo is required/);
    });

    it('throws when upstream missing entirely', () => {
        writeConfig({ php_ext_name: 'foo' });
        assert.throws(() => readConfig(configPath), /upstream\.repo is required/);
    });

    it('throws when upstream.type missing', () => {
        writeConfig({ upstream: { repo: 'foo/bar' }, php_ext_name: 'foo' });
        assert.throws(() => readConfig(configPath), /upstream\.type is required/);
    });

    it('throws when php_ext_name missing', () => {
        writeConfig({ upstream: { repo: 'foo/bar', type: 'github' } });
        assert.throws(() => readConfig(configPath), /php_ext_name is required/);
    });
});

describe('readConfig — hooks validation', () => {
    it('accepts a valid array of commands', () => {
        writeConfig({
            ...minimalValid,
            hooks: { 'post-extract': ['echo foo', 'echo bar'] },
        });
        const config = readConfig(configPath);
        assert.deepEqual(config.hooks['post-extract'], ['echo foo', 'echo bar']);
    });

    it('throws when post-extract is not an array', () => {
        writeConfig({
            ...minimalValid,
            hooks: { 'post-extract': 'echo foo' },
        });
        assert.throws(() => readConfig(configPath), /post-extract must be an array/);
    });

    it('throws when an entry is not a string', () => {
        writeConfig({
            ...minimalValid,
            hooks: { 'post-extract': ['echo foo', 42] },
        });
        assert.throws(
            () => readConfig(configPath),
            /post-extract\[1\] must be a string/
        );
    });

    it('throws when an entry is an empty/whitespace string', () => {
        writeConfig({
            ...minimalValid,
            hooks: { 'post-extract': ['  '] },
        });
        assert.throws(
            () => readConfig(configPath),
            /post-extract\[0\] must not be empty/
        );
    });
});

describe('readConfig — php-version-constraints validation', () => {
    it('throws when not an array', () => {
        writeConfig({
            ...minimalValid,
            build: { 'php-version-constraints': 'oops' },
        });
        assert.throws(
            () => readConfig(configPath),
            /php-version-constraints must be an array/
        );
    });

    it('throws when ext-versions is missing or empty', () => {
        writeConfig({
            ...minimalValid,
            build: {
                'php-version-constraints': [{ 'php-versions': ['8.2'] }],
            },
        });
        assert.throws(
            () => readConfig(configPath),
            /php-version-constraints\[0\]\.ext-versions must be a non-empty string/
        );
    });

    it('throws when ext-versions is empty string', () => {
        writeConfig({
            ...minimalValid,
            build: {
                'php-version-constraints': [
                    { 'ext-versions': '', 'php-versions': ['8.2'] },
                ],
            },
        });
        assert.throws(
            () => readConfig(configPath),
            /php-version-constraints\[0\]\.ext-versions must be a non-empty string/
        );
    });

    it('throws when php-versions is not an array', () => {
        writeConfig({
            ...minimalValid,
            build: {
                'php-version-constraints': [
                    { 'ext-versions': '*', 'php-versions': '8.2' },
                ],
            },
        });
        assert.throws(
            () => readConfig(configPath),
            /php-version-constraints\[0\]\.php-versions must be a non-empty array/
        );
    });

    it('throws when php-versions is empty array', () => {
        writeConfig({
            ...minimalValid,
            build: {
                'php-version-constraints': [
                    { 'ext-versions': '*', 'php-versions': [] },
                ],
            },
        });
        assert.throws(
            () => readConfig(configPath),
            /php-version-constraints\[0\]\.php-versions must be a non-empty array/
        );
    });

    it('throws when a php-versions entry is not a string', () => {
        writeConfig({
            ...minimalValid,
            build: {
                'php-version-constraints': [
                    { 'ext-versions': '*', 'php-versions': ['8.2', 8.3] },
                ],
            },
        });
        assert.throws(
            () => readConfig(configPath),
            /php-version-constraints\[0\]\.php-versions\[1\] must be a string/
        );
    });
});
