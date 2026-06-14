import * as core from '@actions/core';
import { exec } from '@actions/exec';

/**
 * Run post-extract hook commands defined in .extport.json.
 * Each command is executed via `sh -c` with environment variables:
 *   PIE_SYNC_TAG     - upstream tag (e.g. "v4.29.3")
 *   PIE_SYNC_VERSION - normalized version (e.g. "4.29.3")
 *   PIE_SOURCE_DIR   - source directory (e.g. "src/")
 *
 * Commands run sequentially from repo root. If any command fails
 * (non-zero exit), the error propagates to the caller.
 */
export async function runPostExtractHooks({ commands, tag, version, sourceDir }) {
    if (commands.length === 0) {
        return;
    }

    core.info(`Running ${commands.length} post-extract hook(s)...`);

    const env = {
        ...process.env,
        PIE_SYNC_TAG: tag,
        PIE_SYNC_VERSION: version,
        PIE_SOURCE_DIR: sourceDir,
    };

    for (const [i, command] of commands.entries()) {
        core.info(`[hook ${i + 1}/${commands.length}] ${command}`);
        const exitCode = await exec('sh', ['-c', command], { env });
        if (exitCode !== 0) {
            throw new Error(
                `Post-extract hook failed (exit code ${exitCode}): ${command}`
            );
        }
    }

    core.info('All post-extract hooks completed successfully.');
}
