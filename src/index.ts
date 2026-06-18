#!/usr/bin/env node

/**
 * HANA artifact naming convention linter.
 *
 * Supports:
 * - Full scan mode (default): scans configured root directory recursively.
 * - File-list mode: validates only files passed via CLI arguments.
 *
 * Configuration:
 * - Loaded from JSON file (default: ./.hana-linter.json)
 * - Optional CLI flag: --config <path>
 *
 * Rule model per extension:
 * - all: every rule must pass (AND)
 * - any: at least one rule must pass (OR-group)
 */

import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';

type CliCommand = 'lint' | 'init';

type JsonRuleDefinition = {
    /**
     * Human-readable rule label.
     */
    readonly description: string;
    /**
     * Regex source string (without leading/trailing slashes).
     */
    readonly pattern: string;
    /**
     * Optional regex flags, e.g. "i", "u", "iu".
     */
    readonly flags?: string;
};

type JsonRuleGroup = {
    /**
     * Rules that must all pass.
     */
    readonly all?: readonly JsonRuleDefinition[];
    /**
     * Rules where at least one must pass.
     */
    readonly any?: readonly JsonRuleDefinition[];
};

type JsonExtensionRuleSet = {
    /**
     * File extension this rule set applies to.
     * Example: ".hdbtable"
     */
    readonly extension: string;
    /**
     * Grouped rule logic for this extension.
     */
    readonly groups: JsonRuleGroup;
};

type JsonLintConfig = {
    /**
     * Base folder to scan in full-scan mode, usually "db/src".
     */
    readonly rootDir: string;
    /**
     * Directory names to skip during recursive traversal.
     */
    readonly ignoredDirectories: readonly string[];
    /**
     * Rule sets grouped by extension.
     */
    readonly extensionRuleSets: readonly JsonExtensionRuleSet[];
};

type RuleDefinition = {
    /**
     * Human-readable rule label.
     */
    readonly description: string;
    /**
     * Compiled regex pattern.
     */
    readonly pattern: RegExp;
    /**
     * Original regex source from config.
     */
    readonly source: string;
    /**
     * Original regex flags from config.
     */
    readonly flags: string;
};

type RuleGroup = {
    /**
     * Rules that must all pass.
     */
    readonly all?: readonly RuleDefinition[];
    /**
     * Rules where at least one must pass.
     */
    readonly any?: readonly RuleDefinition[];
};

type ExtensionRuleSet = {
    /**
     * File extension this rule set applies to.
     */
    readonly extension: string;
    /**
     * Grouped rule logic for this extension.
     */
    readonly groups: RuleGroup;
};

type LintConfig = {
    /**
     * Base folder to scan in full-scan mode.
     */
    readonly rootDir: string;
    /**
     * Directory names to skip during traversal.
     */
    readonly ignoredDirectories: readonly string[];
    /**
     * Compiled rule sets.
     */
    readonly extensionRuleSets: readonly ExtensionRuleSet[];
};

type LintIssue = {
    readonly filePath: string;
    readonly artifactName: string;
    readonly extension: string;
    readonly failedRuleDescription: string;
    readonly failedPattern: string;
};

type CliInput = {
    /**
     * CLI command mode.
     */
    readonly command: CliCommand;
    /**
     * Files passed via CLI.
     * Empty list means full-scan mode.
     */
    readonly files: readonly string[];
    /**
     * Config path override.
     */
    readonly configPath: string;
    /**
     * Allow overwriting existing config in init mode.
     */
    readonly force: boolean;
};

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
function parseCliInput(): CliInput {
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

/**
 * Create .hana-linter.json in current working directory from bundled template.
 *
 * @param force - Overwrite existing file when true.
 */
async function runInit(force: boolean): Promise<void> {
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
 * Read and parse JSON config file.
 *
 * @param configPath - Path to JSON configuration.
 * @returns Parsed JSON config object.
 */
async function readJsonConfig(configPath: string): Promise<JsonLintConfig> {
    const rawContent = await fs.readFile(configPath, { encoding: 'utf-8' });
    const parsed: unknown = JSON.parse(rawContent);

    if (!isJsonLintConfig(parsed)) {
        throw new Error(`Invalid configuration schema in "${configPath}". Please verify required fields.`);
    }

    return parsed;
}

/**
 * Basic runtime schema guard for JSON config.
 *
 * @param value - Unknown parsed JSON value.
 * @returns True when value matches expected shape.
 */
function isJsonLintConfig(value: unknown): value is JsonLintConfig {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<JsonLintConfig>;

    if (typeof candidate.rootDir !== 'string') {
        return false;
    }

    if (!Array.isArray(candidate.ignoredDirectories)) {
        return false;
    }

    if (!Array.isArray(candidate.extensionRuleSets)) {
        return false;
    }

    return candidate.extensionRuleSets.every((ruleSet) => {
        if (!ruleSet || typeof ruleSet !== 'object') {
            return false;
        }

        const typedRuleSet = ruleSet as Partial<JsonExtensionRuleSet>;
        if (typeof typedRuleSet.extension !== 'string') {
            return false;
        }

        if (!typedRuleSet.groups || typeof typedRuleSet.groups !== 'object') {
            return false;
        }

        const groups = typedRuleSet.groups;
        const allRulesValid =
            groups.all === undefined ||
            (Array.isArray(groups.all) &&
                (groups.all as JsonRuleDefinition[]).every(
                    (rule) =>
                        !!rule &&
                        typeof rule.description === 'string' &&
                        typeof rule.pattern === 'string' &&
                        (rule.flags === undefined || typeof rule.flags === 'string')
                ));

        const anyRulesValid =
            groups.any === undefined ||
            (Array.isArray(groups.any) &&
                (groups.any as JsonRuleDefinition[]).every(
                    (rule) =>
                        !!rule &&
                        typeof rule.description === 'string' &&
                        typeof rule.pattern === 'string' &&
                        (rule.flags === undefined || typeof rule.flags === 'string')
                ));

        return allRulesValid && anyRulesValid;
    });
}

/**
 * Validate regex flags for duplicate/unsupported values.
 *
 * @param flags - Raw regex flags string.
 * @param context - Rule context for clear error messages.
 */
function validateRegexFlags(flags: string, context: string): void {
    const allowedFlags = new Set(['d', 'g', 'i', 'm', 's', 'u', 'v', 'y']);
    const seen = new Set<string>();

    for (const flag of flags) {
        if (!allowedFlags.has(flag)) {
            throw new Error(`Invalid regex flag in ${context}: "${flag}"`);
        }

        if (seen.has(flag)) {
            throw new Error(`Duplicate regex flag in ${context}: "${flag}"`);
        }

        seen.add(flag);
    }
}

/**
 * Compile regex source and flags into RegExp with helpful error context.
 *
 * @param source - Regex source from config.
 * @param flags - Regex flags from config.
 * @param context - Rule context for error reporting.
 * @returns Compiled RegExp.
 */
function compileRegex(source: string, flags: string, context: string): RegExp {
    validateRegexFlags(flags, context);

    try {
        return new RegExp(source, flags);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown regex error';
        throw new Error(`Invalid regex in ${context}: pattern="${source}" flags="${flags}". ${message}`, { cause: error });
    }
}

/**
 * Convert JSON config into runtime compiled config.
 *
 * @param jsonConfig - Parsed JSON config.
 * @returns Runtime lint config with compiled regex.
 */
function toLintConfig(jsonConfig: JsonLintConfig): LintConfig {
    const extensionRuleSets: ExtensionRuleSet[] = jsonConfig.extensionRuleSets.map((jsonRuleSet) => {
        const allRules: RuleDefinition[] = (jsonRuleSet.groups.all ?? []).map((rule, index) => {
            const flags = rule.flags ?? '';
            const context = `extension "${jsonRuleSet.extension}" group "all" rule #${index + 1}`;
            return {
                description: rule.description,
                source: rule.pattern,
                flags,
                pattern: compileRegex(rule.pattern, flags, context)
            };
        });

        const anyRules: RuleDefinition[] = (jsonRuleSet.groups.any ?? []).map((rule, index) => {
            const flags = rule.flags ?? '';
            const context = `extension "${jsonRuleSet.extension}" group "any" rule #${index + 1}`;
            return {
                description: rule.description,
                source: rule.pattern,
                flags,
                pattern: compileRegex(rule.pattern, flags, context)
            };
        });

        const hasAllRules = allRules.length > 0;
        const hasAnyRules = anyRules.length > 0;

        if (!hasAllRules && !hasAnyRules) {
            throw new Error(
                `Invalid rule configuration for extension "${jsonRuleSet.extension}": at least one rule is required in "groups.all" or "groups.any".`
            );
        }

        return {
            extension: jsonRuleSet.extension,
            groups: {
                all: hasAllRules ? allRules : undefined,
                any: hasAnyRules ? anyRules : undefined
            }
        };
    });

    return {
        rootDir: jsonConfig.rootDir,
        ignoredDirectories: jsonConfig.ignoredDirectories,
        extensionRuleSets
    };
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

/**
 * Resolve files to validate:
 * - If CLI files are provided: use only existing files from that list.
 * - If none are provided: run full scan from rootDir.
 *
 * @param config - Lint configuration.
 * @param cliInput - Parsed CLI input.
 * @returns List of file paths to validate.
 */
async function resolveFilesToValidate(config: LintConfig, cliInput: CliInput): Promise<string[]> {
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
 * Extract artifact name from file path.
 *
 * @param filePath - Full file path.
 * @returns Artifact name without extension.
 */
function getArtifactNameFromFilePath(filePath: string): string {
    const parsed = path.parse(filePath);
    return parsed.name;
}

/**
 * Resolve matching rule set for a file extension.
 *
 * @param extension - File extension.
 * @param extensionRuleSets - Configured extension rule sets.
 * @returns Matching extension rule set or undefined.
 */
function findRuleSetForExtension(extension: string, extensionRuleSets: readonly ExtensionRuleSet[]): ExtensionRuleSet | undefined {
    return extensionRuleSets.find((ruleSet) => ruleSet.extension === extension);
}

/**
 * Convert a rule to displayable regex literal text.
 *
 * @param rule - Runtime rule.
 * @returns Regex literal-like string.
 */
function toRegexLiteral(rule: RuleDefinition): string {
    return `/${rule.source}/${rule.flags}`;
}

/**
 * Build lint issues for failed AND-rules.
 *
 * @param filePath - File path.
 * @param artifactName - Artifact name.
 * @param extension - Artifact extension.
 * @param rules - AND-rules list.
 * @returns Lint issues for failed rules.
 */
function evaluateAllRules(filePath: string, artifactName: string, extension: string, rules: readonly RuleDefinition[]): LintIssue[] {
    const issues: LintIssue[] = [];

    for (const rule of rules) {
        if (!rule.pattern.test(artifactName)) {
            issues.push({
                filePath,
                artifactName,
                extension,
                failedRuleDescription: rule.description,
                failedPattern: toRegexLiteral(rule)
            });
        }
    }

    return issues;
}

/**
 * Build lint issue for failed OR-group.
 *
 * @param filePath - File path.
 * @param artifactName - Artifact name.
 * @param extension - Artifact extension.
 * @param rules - OR-rules list.
 * @returns Single lint issue if OR-group fails; otherwise empty list.
 */
function evaluateAnyRules(filePath: string, artifactName: string, extension: string, rules: readonly RuleDefinition[]): LintIssue[] {
    const hasAtLeastOneMatch = rules.some((rule) => rule.pattern.test(artifactName));

    if (hasAtLeastOneMatch) {
        return [];
    }

    return [
        {
            filePath,
            artifactName,
            extension,
            failedRuleDescription: 'At least one OR-group rule must match: ' + rules.map((rule) => rule.description).join(' | '),
            failedPattern: rules.map(toRegexLiteral).join(' OR ')
        }
    ];
}

/**
 * Validate a single file against configured rule groups for its extension.
 *
 * @param filePath - Full file path.
 * @param extensionRuleSets - Configured extension rule sets.
 * @returns List of lint issues.
 */
function validateFileName(filePath: string, extensionRuleSets: readonly ExtensionRuleSet[]): LintIssue[] {
    const extension = path.extname(filePath);
    const ruleSet = findRuleSetForExtension(extension, extensionRuleSets);

    if (!ruleSet) {
        return [];
    }

    const artifactName = getArtifactNameFromFilePath(filePath);
    const issues: LintIssue[] = [];

    const allRules = ruleSet.groups.all ?? [];
    const anyRules = ruleSet.groups.any ?? [];

    if (allRules.length > 0) {
        issues.push(...evaluateAllRules(filePath, artifactName, extension, allRules));
    }

    if (anyRules.length > 0) {
        issues.push(...evaluateAnyRules(filePath, artifactName, extension, anyRules));
    }

    return issues;
}

/**
 * Run naming lint and return all discovered issues.
 *
 * @param config - Lint configuration.
 * @param filesToValidate - File paths to validate.
 * @returns All naming violations.
 */
function runLint(config: LintConfig, filesToValidate: readonly string[]): LintIssue[] {
    const issues: LintIssue[] = [];

    for (const filePath of filesToValidate) {
        const fileIssues = validateFileName(filePath, config.extensionRuleSets);
        issues.push(...fileIssues);
    }

    return issues;
}

/**
 * Print lint result report to stdout/stderr.
 *
 * @param issues - Found naming violations.
 * @param filesToValidate - Number of candidate files processed.
 */
function printReport(issues: readonly LintIssue[], filesToValidate: readonly string[]): void {
    if (issues.length === 0) {
        console.info(`✅ HANA naming lint passed. Checked ${filesToValidate.length} file(s).`);
        return;
    }

    console.error(`❌ HANA naming lint failed. Violations: ${issues.length}`);
    console.error('');

    for (const issue of issues) {
        console.error(`- File: ${issue.filePath}`);
        console.error(`  Artifact: ${issue.artifactName}`);
        console.error(`  Type: ${issue.extension}`);
        console.error(`  Failed rule: ${issue.failedRuleDescription}`);
        console.error(`  Expected regex: ${issue.failedPattern}`);
        console.error('');
    }
}

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
    const issues = runLint(config, filesToValidate);

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
