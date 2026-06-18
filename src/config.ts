import { promises as fs } from 'node:fs';
import { LintConfig } from './types/config';
import {
    ContentRuleSet,
    ContentTarget,
    ExtensionRuleSet,
    JsonContentRuleSet,
    JsonLintConfig,
    JsonExtensionRuleSet,
    JsonRuleDefinition,
    RuleDefinition,
    RuleGroup
} from './types/rules';

/**
 * Read and parse JSON config file.
 *
 * @param configPath - Path to JSON configuration.
 * @returns Parsed JSON config object.
 */
export async function readJsonConfig(configPath: string): Promise<JsonLintConfig> {
    const rawContent = await fs.readFile(configPath, { encoding: 'utf-8' });
    const parsed: unknown = JSON.parse(rawContent);

    if (!isJsonLintConfig(parsed)) {
        throw new Error(`Invalid configuration schema in "${configPath}". Please verify required fields.`);
    }

    return parsed;
}

/**
 * Convert JSON config into runtime compiled config.
 *
 * @param jsonConfig - Parsed JSON config.
 * @returns Runtime lint config with compiled regex.
 */
export function toLintConfig(jsonConfig: JsonLintConfig): LintConfig {
    const extensionFolderNames = new Map<string, string>();

    const extensionRuleSets: ExtensionRuleSet[] = jsonConfig.extensionRuleSets.map((jsonRuleSet) => {
        const folderName = jsonRuleSet.folderName?.trim();

        if (folderName !== undefined && folderName.length === 0) {
            throw new Error(`Invalid folderName for extension "${jsonRuleSet.extension}": value must not be empty.`);
        }

        if (folderName !== undefined && (folderName.includes('/') || folderName.includes('\\'))) {
            throw new Error(`Invalid folderName for extension "${jsonRuleSet.extension}": use only a folder name, not a path.`);
        }

        if (folderName !== undefined) {
            const existingFolderName = extensionFolderNames.get(jsonRuleSet.extension);
            if (existingFolderName && existingFolderName !== folderName) {
                throw new Error(
                    `Conflicting folderName values configured for extension "${jsonRuleSet.extension}": "${existingFolderName}" and "${folderName}".`
                );
            }
            extensionFolderNames.set(jsonRuleSet.extension, folderName);
        }

        const compiledGroups = compileRuleGroup(jsonRuleSet.groups, `extension "${jsonRuleSet.extension}"`);

        const allRules = compiledGroups.all ?? [];
        const anyRules = compiledGroups.any ?? [];

        const hasAllRules = allRules.length > 0;
        const hasAnyRules = anyRules.length > 0;

        if (!hasAllRules && !hasAnyRules) {
            throw new Error(
                `Invalid rule configuration for extension "${jsonRuleSet.extension}": at least one rule is required in "groups.all" or "groups.any".`
            );
        }

        return {
            extension: jsonRuleSet.extension,
            folderName,
            groups: compiledGroups
        };
    });

    const contentRuleSets: ContentRuleSet[] = (jsonConfig.contentRuleSets ?? []).map((jsonRuleSet) => {
        const compiledGroups = compileRuleGroup(jsonRuleSet.groups, `content target "${jsonRuleSet.target}" extension "${jsonRuleSet.extension}"`);

        const hasAllRules = (compiledGroups.all ?? []).length > 0;
        const hasAnyRules = (compiledGroups.any ?? []).length > 0;

        if (!hasAllRules && !hasAnyRules) {
            throw new Error(
                `Invalid content rule configuration for target "${jsonRuleSet.target}" extension "${jsonRuleSet.extension}": at least one rule is required in "groups.all" or "groups.any".`
            );
        }

        return {
            extension: jsonRuleSet.extension,
            target: jsonRuleSet.target,
            groups: compiledGroups
        };
    });

    return {
        rootDir: jsonConfig.rootDir,
        ignoredDirectories: jsonConfig.ignoredDirectories,
        extensionRuleSets,
        contentRuleSets
    };
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

    if (candidate.contentRuleSets !== undefined && !Array.isArray(candidate.contentRuleSets)) {
        return false;
    }

    const extensionRuleSetsValid = candidate.extensionRuleSets.every((ruleSet) => {
        if (!ruleSet || typeof ruleSet !== 'object') {
            return false;
        }

        const typedRuleSet = ruleSet as Partial<JsonExtensionRuleSet>;
        if (typeof typedRuleSet.extension !== 'string') {
            return false;
        }

        if (typedRuleSet.folderName !== undefined && typeof typedRuleSet.folderName !== 'string') {
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

    if (!extensionRuleSetsValid) {
        return false;
    }

    return (candidate.contentRuleSets ?? []).every((ruleSet) => {
        if (!ruleSet || typeof ruleSet !== 'object') {
            return false;
        }

        const typedRuleSet = ruleSet as Partial<JsonContentRuleSet>;
        if (typeof typedRuleSet.extension !== 'string') {
            return false;
        }

        if (!isContentTarget(typedRuleSet.target)) {
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

function isContentTarget(target: unknown): target is ContentTarget {
    return target === 'field' || target === 'inputParameter' || target === 'outputParameter';
}

function compileRuleGroup(groups: { all?: readonly JsonRuleDefinition[]; any?: readonly JsonRuleDefinition[] }, contextRoot: string): RuleGroup {
    const allRules: RuleDefinition[] = (groups.all ?? []).map((rule, index) => {
        const flags = rule.flags ?? '';
        const context = `${contextRoot} group "all" rule #${index + 1}`;
        return {
            description: rule.description,
            source: rule.pattern,
            flags,
            pattern: compileRegex(rule.pattern, flags, context)
        };
    });

    const anyRules: RuleDefinition[] = (groups.any ?? []).map((rule, index) => {
        const flags = rule.flags ?? '';
        const context = `${contextRoot} group "any" rule #${index + 1}`;
        return {
            description: rule.description,
            source: rule.pattern,
            flags,
            pattern: compileRegex(rule.pattern, flags, context)
        };
    });

    return {
        all: allRules.length > 0 ? allRules : undefined,
        any: anyRules.length > 0 ? anyRules : undefined
    };
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
