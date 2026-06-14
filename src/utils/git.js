import { exec } from '@actions/exec';

/**
 * Configure git user for commits.
 */
export async function configureGit() {
    await exec('git', ['config', 'user.name', 'pie-extensions-bot']);
    await exec('git', ['config', 'user.email', 'pie-extensions-bot@users.noreply.github.com']);
}

/**
 * Stage all changes, commit with message, and create a tag.
 */
export async function commitAndTag(version, upstreamTag) {
    await exec('git', ['add', '-A']);
    await exec('git', ['commit', '-m', `sync: update to upstream ${upstreamTag} (${version})`]);
    await exec('git', ['tag', version]);
}

/**
 * Push the current branch and a specific tag to origin.
 */
export async function push(version) {
    await exec('git', ['push', 'origin', 'main']);
    await exec('git', ['push', 'origin', version]);
}

/**
 * Reset working tree to HEAD (discard uncommitted changes).
 */
export async function resetHard() {
    await exec('git', ['reset', '--hard', 'HEAD']);
    await exec('git', ['clean', '-fd']);
}
