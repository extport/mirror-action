import * as core from '@actions/core';
import { readConfig } from './utils/config.js';
import { readComposerVersion, writeComposerVersion } from './utils/composer.js';
import { getAllReleaseTags, downloadAndExtractTarball, parseRepo } from './utils/github.js';
import { filterNewerVersions, isInitialVersion } from './utils/versions.js';
import { configureGit, commitAndTag, push, resetHard } from './utils/git.js';
import { runPostExtractHooks } from './utils/hooks.js';
import { createRelease, markAsLatest } from './release.js';

/**
 * Multi-version sync: fetch all missing upstream releases and process them
 * in order (oldest first). Each version gets its own commit, tag, push,
 * and GitHub Release.
 */
export async function runSync({ token }) {
    const dryRun = core.getInput('dry-run') === 'true';

    // 1. Read configuration
    const config = readConfig();
    const currentVersion = readComposerVersion();
    const { owner, repo } = parseRepo(config.upstream.repo);

    core.info(`Extension: ${config.php_ext_name}`);
    core.info(`Upstream: ${config.upstream.repo}`);
    core.info(`Current synced version: ${currentVersion}`);

    const isInitial = isInitialVersion(currentVersion);
    if (isInitial) {
        core.info('Initial sync detected (version 0.0.0) — will limit to recent versions');
    }

    // 2. Fetch ALL upstream release tags
    const allTags = await getAllReleaseTags(token, owner, repo);
    core.info(`Found ${allTags.length} upstream release(s)`);

    if (allTags.length === 0) {
        core.info('No upstream releases found. Nothing to sync.');
        core.setOutput('synced-versions', '[]');
        core.setOutput('latest-version', '');
        return;
    }

    // 3. Filter to versions newer than current
    const newerVersions = filterNewerVersions(currentVersion, allTags, {
        includePrereleases: config.sync.prereleases,
        excludePatterns: config.sync['exclude-tags'],
    });

    if (newerVersions.length === 0) {
        core.info('Already up to date. Nothing to sync.');
        core.setOutput('synced-versions', '[]');
        core.setOutput('latest-version', '');
        return;
    }

    core.info(`Found ${newerVersions.length} new version(s): ${newerVersions.map(v => v.version).join(', ')}`);

    // 4. Apply version limits
    const maxFromInput = parseInt(core.getInput('max-versions') || '0', 10);
    let toSync = newerVersions;

    if (isInitial) {
        // On initial sync, take only the last N versions (most recent)
        const initialLimit = maxFromInput > 0 ? maxFromInput : config.sync['initial-versions'];
        if (toSync.length > initialLimit) {
            core.info(`Initial sync: limiting to last ${initialLimit} of ${toSync.length} versions`);
            toSync = toSync.slice(-initialLimit);
        }
    } else if (maxFromInput > 0 && toSync.length > maxFromInput) {
        core.warning(`Limiting sync to ${maxFromInput} of ${toSync.length} versions (max-versions input)`);
        toSync = toSync.slice(0, maxFromInput);
    }

    if (dryRun) {
        core.info('Dry run — would sync the following versions:');
        toSync.forEach(({ tag, version }) => core.info(`  ${version} (tag: ${tag})`));
        core.setOutput('synced-versions', JSON.stringify(toSync.map(v => v.version)));
        core.setOutput('latest-version', toSync[toSync.length - 1].version);
        return;
    }

    // 5. Configure git for commits
    await configureGit();

    // 6. Process each version sequentially (oldest first)
    const synced = [];
    const sourceDir = config.source_dir;

    for (const { tag, version } of toSync) {
        core.startGroup(`Syncing version ${version} (tag: ${tag})`);
        try {
            // a. Download and extract source tarball
            await downloadAndExtractTarball(token, owner, repo, tag, sourceDir);

            // b. Run post-extract hooks (if configured)
            await runPostExtractHooks({
                commands: config.hooks['post-extract'],
                tag,
                version,
                sourceDir,
            });

            // c. Update composer.json version
            writeComposerVersion(version);

            // d. Commit and tag
            await commitAndTag(version, tag);

            // e. Push commit and tag
            await push(version);

            // f. Create GitHub Release
            await createRelease(token, version, tag, config);

            synced.push(version);
            core.info(`Successfully synced ${version}`);
        } catch (err) {
            core.error(`Failed to sync version ${version}: ${err.message}`);
            await resetHard();
            core.setFailed(`Sync failed at version ${version}: ${err.message}`);
            break;
        }
        core.endGroup();
    }

    // Mark the highest synced version as "Latest" on GitHub — but only when
    // releases are non-draft (builds disabled). When builds are enabled the
    // publish step in build-binaries.yml handles this after un-drafting.
    const buildEnabled = config.build?.enabled === true;
    if (synced.length > 0 && !buildEnabled) {
        const highest = synced[synced.length - 1];
        await markAsLatest(token, highest);
    }

    core.setOutput('synced-versions', JSON.stringify(synced));
    core.setOutput('latest-version', synced.length > 0 ? synced[synced.length - 1] : '');
}
