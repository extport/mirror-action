import { Octokit } from '@octokit/rest';
import { exec } from '@actions/exec';
import * as core from '@actions/core';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';

export function getOctokit(token) {
    return new Octokit({ auth: token });
}

/**
 * Parse "owner/repo" string into { owner, repo }.
 */
export function parseRepo(fullName) {
    const [owner, repo] = fullName.split('/');
    if (!owner || !repo) throw new Error(`Invalid repo format: ${fullName}`);
    return { owner, repo };
}

/**
 * Get ALL release tags from upstream, paginated.
 * Returns array of tag name strings, filtered to exclude drafts.
 */
export async function getAllReleaseTags(token, owner, repo) {
    const octokit = getOctokit(token);
    const releases = await octokit.paginate(
        octokit.rest.repos.listReleases,
        { owner, repo, per_page: 100 }
    );

    return releases
        .filter(r => !r.draft)
        .map(r => r.tag_name);
}

/**
 * Download the source tarball for a specific tag and extract to sourceDir.
 * Cleans the sourceDir first, then extracts with strip-components=1
 * to remove GitHub's top-level directory wrapper.
 */
export async function downloadAndExtractTarball(token, owner, repo, tag, sourceDir) {
    const tarballUrl = `https://api.github.com/repos/${owner}/${repo}/tarball/${tag}`;

    // Clean source dir
    rmSync(sourceDir, { recursive: true, force: true });
    mkdirSync(sourceDir, { recursive: true });

    const tempDir = process.env.RUNNER_TEMP || '/tmp';
    const safeName = tag.replace(/[^a-zA-Z0-9._-]/g, '_');
    const tempTar = join(tempDir, `upstream-${safeName}.tar.gz`);

    await exec('curl', [
        '-sL',
        '-H', `Authorization: token ${token}`,
        '-H', 'Accept: application/vnd.github+json',
        '-o', tempTar,
        tarballUrl,
    ]);

    await exec('tar', [
        'xzf', tempTar,
        '-C', sourceDir,
        '--strip-components=1',
    ]);

    core.info(`Extracted source for ${tag} to ${sourceDir}`);
}
