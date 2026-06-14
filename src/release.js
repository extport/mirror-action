import * as core from '@actions/core';
import { getOctokit } from './utils/github.js';

/**
 * Create a GitHub Release for a synced version.
 * The tag must already exist (created during commit+tag in sync).
 *
 * @param {string} token - GitHub token
 * @param {string} version - Normalized version string (e.g. "7.4.1")
 * @param {string} upstreamTag - Original upstream tag (e.g. "v7.4.1")
 * @param {object} config - Parsed .extport.json
 */
export async function createRelease(token, version, upstreamTag, config) {
    const octokit = getOctokit(token);
    const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');

    // Create as draft when binary building is enabled, so the build-binaries
    // workflow can upload assets before the release is published.
    const isDraft = config.build?.enabled === true;

    const body = [
        `Synced from upstream release [\`${upstreamTag}\`](https://github.com/${config.upstream.repo}/releases/tag/${upstreamTag}).`,
        '',
        `**Upstream:** https://github.com/${config.upstream.repo}`,
        `**Install:** \`pie install ${owner}/${repo}\``,
    ].join('\n');

    try {
        await octokit.rest.repos.createRelease({
            owner,
            repo,
            tag_name: version,
            name: version,
            body,
            draft: isDraft,
            prerelease: false,
            make_latest: 'false',
        });
        core.info(`Created ${isDraft ? 'draft ' : ''}release ${version}`);
    } catch (err) {
        // 422 = release already exists (idempotent on re-run)
        if (err.status === 422) {
            core.warning(`Release ${version} already exists, skipping`);
        } else {
            throw err;
        }
    }
}

/**
 * Mark a release as the "Latest" on GitHub.
 *
 * @param {string} token - GitHub token
 * @param {string} version - Tag / version string of the release to mark
 */
export async function markAsLatest(token, version) {
    const octokit = getOctokit(token);
    const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');

    const { data: release } = await octokit.rest.repos.getReleaseByTag({
        owner,
        repo,
        tag: version,
    });

    await octokit.rest.repos.updateRelease({
        owner,
        repo,
        release_id: release.id,
        make_latest: 'true',
    });

    core.info(`Marked release ${version} as latest`);
}
