import { readFileSync, writeFileSync } from 'fs';

const COMPOSER_PATH = 'composer.json';

export function readComposer(composerPath = COMPOSER_PATH) {
    return JSON.parse(readFileSync(composerPath, 'utf-8'));
}

export function writeComposer(data, composerPath = COMPOSER_PATH) {
    writeFileSync(composerPath, JSON.stringify(data, null, 4) + '\n', 'utf-8');
}

export function readComposerVersion(composerPath = COMPOSER_PATH) {
    return readComposer(composerPath).version;
}

export function writeComposerVersion(newVersion, composerPath = COMPOSER_PATH) {
    const composer = readComposer(composerPath);
    composer.version = newVersion;
    writeComposer(composer, composerPath);
}
