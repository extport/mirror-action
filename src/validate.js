import * as core from '@actions/core';
import { existsSync } from 'fs';
import { join } from 'path';
import { readConfig } from './utils/config.js';
import { readComposer } from './utils/composer.js';
import { isInitialVersion } from './utils/versions.js';

/**
 * Validate that the mirror repo is PIE-compliant.
 * Exits with code 1 if any checks fail.
 */
export async function runValidate() {
    const errors = [];

    // 1. .extport.json exists and is valid
    let config;
    try {
        config = readConfig();
    } catch (err) {
        errors.push(`.extport.json: ${err.message}`);
    }

    // 2. composer.json exists and has required fields
    if (!existsSync('composer.json')) {
        errors.push('composer.json not found at repository root');
    } else {
        let composer;
        try {
            composer = readComposer();
        } catch (err) {
            errors.push(`composer.json: failed to parse: ${err.message}`);
        }

        if (composer) {
            // type must be php-ext or php-ext-zend
            if (!['php-ext', 'php-ext-zend'].includes(composer.type)) {
                errors.push(
                    `composer.json: "type" must be "php-ext" or "php-ext-zend", got "${composer.type}"`
                );
            }

            // php-ext.extension-name required
            const extName = composer['php-ext']?.['extension-name'];
            if (!extName) {
                errors.push('composer.json: "php-ext.extension-name" is required');
            }

            // version field required
            if (!composer.version) {
                errors.push('composer.json: "version" field is required');
            }

            // Cross-validate extension name with config
            if (config && extName && extName !== config.php_ext_name) {
                errors.push(
                    `Mismatch: composer.json extension-name="${extName}" vs .extport.json php_ext_name="${config.php_ext_name}"`
                );
            }
        }
    }

    // 3. source_dir exists (skip build file check on initial sync)
    if (config) {
        const srcDir = config.source_dir;
        if (!existsSync(srcDir)) {
            errors.push(`Source directory "${srcDir}" does not exist`);
        } else {
            // Only check for build files if we've already synced at least once
            const composer = existsSync('composer.json') ? readComposer() : null;
            if (composer && !isInitialVersion(composer.version)) {
                const buildFiles = ['config.m4', 'config.w32', 'configure.ac', 'CMakeLists.txt'];
                const hasBuildFile = buildFiles.some(f => existsSync(join(srcDir, f)));
                if (!hasBuildFile) {
                    errors.push(
                        `Source directory "${srcDir}" does not contain a build file (${buildFiles.join(', ')})`
                    );
                }
            }
        }
    }

    // Report results
    if (errors.length > 0) {
        core.error('PIE compliance validation FAILED:');
        errors.forEach(e => core.error(`  - ${e}`));
        core.setOutput('validation-passed', 'false');
        core.setFailed(`${errors.length} validation error(s) found`);
    } else {
        core.info('PIE compliance validation PASSED');
        core.setOutput('validation-passed', 'true');
    }
}
