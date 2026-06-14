import * as core from '@actions/core';
import { readConfig } from './utils/config.js';
import { resolveMatrix } from './utils/matrix.js';

/**
 * Resolve the build matrix for a given release tag.
 * Sets outputs: enabled, matrix, build-path, release-tag
 */
export async function runResolveMatrix() {
    const releaseTag = core.getInput('release-tag', { required: true });

    const config = readConfig();
    core.debug(`Config build section: ${JSON.stringify(config.build)}`);

    const result = resolveMatrix(releaseTag, config);

    core.setOutput('enabled', String(result.enabled));
    core.setOutput('release-tag', releaseTag);

    if (result.enabled) {
        const matrixJson = JSON.stringify(result.matrix);
        core.setOutput('matrix', matrixJson);
        core.setOutput('build-path', result.buildPath);
        core.setOutput('configure-flags', config.build['configure-flags']);
        core.setOutput('apk-packages', config.build['apk-packages']);
        core.info(`Build matrix resolved for ${releaseTag}: ${matrixJson}`);
        core.info(`Build path: ${result.buildPath}`);
        if (config.build['configure-flags']) {
            core.info(`Configure flags: ${config.build['configure-flags']}`);
        }
    } else {
        core.info('Build is not enabled for this extension');
    }
}
