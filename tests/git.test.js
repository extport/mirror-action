import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { configureGit, commitAndTag, resetHard } from '../src/utils/git.js';

let workDir;
let originalCwd;

function sh(cmd) {
    return execSync(cmd, { cwd: workDir, encoding: 'utf-8' });
}

beforeEach(() => {
    originalCwd = process.cwd();
    workDir = mkdtempSync(join(tmpdir(), 'git-test-'));
    process.chdir(workDir);
    execSync('git init -q -b main', { cwd: workDir });
    // Configure local fallback so commit doesn't reach for global git identity
    execSync('git config user.name "init"', { cwd: workDir });
    execSync('git config user.email "init@example.com"', { cwd: workDir });
});

afterEach(() => {
    process.chdir(originalCwd);
    rmSync(workDir, { recursive: true, force: true });
});

describe('configureGit', () => {
    it('sets the bot user identity in the local repo config', async () => {
        await configureGit();
        assert.equal(sh('git config user.name').trim(), 'pie-extensions-bot');
        assert.equal(
            sh('git config user.email').trim(),
            'pie-extensions-bot@users.noreply.github.com'
        );
    });
});

describe('commitAndTag', () => {
    it('stages all changes, commits with sync message, and creates a tag', async () => {
        writeFileSync(join(workDir, 'foo.txt'), 'hello');
        await commitAndTag('1.2.3', 'v1.2.3');

        const log = sh('git log -1 --pretty=%B').trim();
        assert.equal(log, 'sync: update to upstream v1.2.3 (1.2.3)');

        const tags = sh('git tag --list').trim().split('\n');
        assert.ok(tags.includes('1.2.3'));
    });

    it('picks up newly created and modified files via git add -A', async () => {
        writeFileSync(join(workDir, 'a.txt'), 'a');
        await commitAndTag('1.0.0', 'v1.0.0');
        writeFileSync(join(workDir, 'a.txt'), 'a-changed');
        writeFileSync(join(workDir, 'b.txt'), 'b');
        await commitAndTag('1.0.1', 'v1.0.1');

        const status = sh('git status --porcelain').trim();
        assert.equal(status, '');
        const tags = sh('git tag --list').trim().split('\n').sort();
        assert.deepEqual(tags, ['1.0.0', '1.0.1']);
    });
});

describe('resetHard', () => {
    it('discards uncommitted changes and removes untracked files', async () => {
        writeFileSync(join(workDir, 'tracked.txt'), 'original');
        await commitAndTag('1.0.0', 'v1.0.0');

        writeFileSync(join(workDir, 'tracked.txt'), 'modified');
        writeFileSync(join(workDir, 'untracked.txt'), 'leftover');

        await resetHard();

        assert.equal(
            execSync(`cat ${join(workDir, 'tracked.txt')}`, { encoding: 'utf-8' }),
            'original'
        );
        assert.equal(existsSync(join(workDir, 'untracked.txt')), false);
    });
});
