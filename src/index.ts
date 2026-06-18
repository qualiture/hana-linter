#!/usr/bin/env node

import { parseCliInput, runInit } from './cli';
import { readJsonConfig, toLintConfig } from './config';
import { resolveFilesToValidate } from './files';
import { runLint } from './lint';
import { printReport } from './report';

/**
 * Application entry point.
 */
async function main(): Promise<void> {
    const cliInput = parseCliInput();

    if (cliInput.command === 'init') {
        await runInit(cliInput.force);
        return;
    }

    const jsonConfig = await readJsonConfig(cliInput.configPath);
    const config = toLintConfig(jsonConfig);

    const filesToValidate = await resolveFilesToValidate(config, cliInput);
    const issues = await runLint(config, filesToValidate);

    printReport(issues, filesToValidate);

    if (issues.length > 0) {
        process.exitCode = 1;
    }
}

void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error(`❌ HANA naming lint crashed: ${message}`);
    process.exitCode = 1;
});
