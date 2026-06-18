import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CliInput } from './types/cli';
import { LintConfig } from './types/config';

/**
 * Resolve files to validate:
 * - If CLI files are provided: use only existing files from that list.
 * - If none are provided: run full scan from rootDir.
 *
 * @param config - Lint configuration.
 * @param cliInput - Parsed CLI input.
 * @returns List of file paths to validate.
 */
export async function resolveFilesToValidate(config: LintConfig, cliInput: CliInput): Promise<string[]> {
    if (cliInput.files.length > 0) {
        const existingChecks = await Promise.all(
            cliInput.files.map(async (filePath) => ({
                filePath,
                exists: await isExistingFile(filePath)
            }))
        );

        return existingChecks.filter((item) => item.exists).map((item) => path.normalize(item.filePath));
    }

    const rootExists = await fs
        .access(config.rootDir)
        .then(() => true)
        .catch(() => false);

    if (!rootExists) {
        throw new Error(`Configured root directory does not exist: "${config.rootDir}"`);
    }

    return collectFiles(config.rootDir, config.ignoredDirectories);
}

/**
 * Check if a path exists and is a regular file.
 *
 * @param filePath - Path to validate.
 * @returns True if path exists and is a file.
 */
async function isExistingFile(filePath: string): Promise<boolean> {
    try {
        const stat = await fs.stat(filePath);
        return stat.isFile();
    } catch {
        return false;
    }
}

/**
 * Recursively collect all files from a directory while skipping ignored folders.
 *
 * @param directoryPath - Absolute or relative folder path.
 * @param ignoredDirectories - Directory names to skip.
 * @returns List of full file paths.
 */
async function collectFiles(directoryPath: string, ignoredDirectories: readonly string[]): Promise<string[]> {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });

    const collected = await Promise.all(
        entries.map(async (entry) => {
            const fullPath = path.join(directoryPath, entry.name);

            if (entry.isDirectory()) {
                if (ignoredDirectories.includes(entry.name)) {
                    return [];
                }
                return collectFiles(fullPath, ignoredDirectories);
            }

            if (entry.isFile()) {
                return [fullPath];
            }

            return [];
        })
    );

    return collected.flat();
}
