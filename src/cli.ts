import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';
import { CliInput } from './types/cli';

const DEFAULT_CONFIG_PATH = '.hana-linter.json';

/**
 * Parse command-line arguments.
 *
 * Supported:
 * - --config <path>
 * - remaining arguments are treated as file paths
 *
 * @returns Parsed CLI input.
 */
export function parseCliInput(): CliInput {
    const args = process.argv.slice(2);

    if (args[0] === 'init') {
        const initArgs = args.slice(1);
        let force = false;

        for (const value of initArgs) {
            if (value === '--force') {
                force = true;
                continue;
            }

            throw new Error(`Unknown argument for init: "${value}". Supported: --force`);
        }

        return {
            command: 'init',
            files: [],
            configPath: DEFAULT_CONFIG_PATH,
            force
        };
    }

    const files: string[] = [];
    let configPath = DEFAULT_CONFIG_PATH;

    for (let index = 0; index < args.length; index += 1) {
        const value = args[index];

        if (value === '--config') {
            const nextValue = args[index + 1];
            if (!nextValue || nextValue.startsWith('--')) {
                throw new Error('Missing value for --config');
            }
            configPath = nextValue;
            index += 1;
            continue;
        }

        files.push(value as string);
    }

    return {
        command: 'lint',
        files: files.filter((value) => value.trim().length > 0),
        configPath,
        force: false
    };
}

/**
 * Create .hana-linter.json in current working directory from bundled template.
 *
 * @param force - Overwrite existing file when true.
 */
export async function runInit(force: boolean): Promise<void> {
    const templatePath = await resolveTemplateConfigPath();
    const targetPath = path.resolve(process.cwd(), DEFAULT_CONFIG_PATH);

    try {
        await fs.copyFile(templatePath, targetPath, force ? 0 : fsConstants.COPYFILE_EXCL);
        console.info(`✅ Created ${DEFAULT_CONFIG_PATH} at ${targetPath}`);
    } catch (error: unknown) {
        if (!force && typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === 'EEXIST') {
            throw new Error(`${DEFAULT_CONFIG_PATH} already exists at ${targetPath}. Use "hana-linter init --force" to overwrite.`);
        }

        throw error;
    }
}

/**
 * Resolve the packaged default config template path.
 *
 * Supports both:
 * - built artifact layout (dist/assets)
 * - source layout (src/assets) during local development
 *
 * @returns Existing template path.
 */
async function resolveTemplateConfigPath(): Promise<string> {
    const candidatePaths = [
        path.resolve(__dirname, 'assets', DEFAULT_CONFIG_PATH),
        path.resolve(__dirname, '..', 'src', 'assets', DEFAULT_CONFIG_PATH)
    ];

    for (const candidatePath of candidatePaths) {
        try {
            await fs.access(candidatePath);
            return candidatePath;
        } catch {
            // Try next candidate.
        }
    }

    throw new Error('Could not locate bundled default configuration template. Expected one of: ' + candidatePaths.join(', '));
}
