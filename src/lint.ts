import path from 'node:path';
import { lintFileContent } from './content-lint';
import { LintIssue } from './types/issues';
import { LintConfig } from './types/config';
import { ExtensionRuleSet, RuleDefinition } from './types/rules';

/**
 * Run naming lint and return all discovered issues.
 *
 * @param config - Lint configuration.
 * @param filesToValidate - File paths to validate.
 * @returns All naming violations.
 */
export async function runLint(config: LintConfig, filesToValidate: readonly string[]): Promise<LintIssue[]> {
    const issues: LintIssue[] = [];

    for (const filePath of filesToValidate) {
        const fileIssues = validateFileName(filePath, config.extensionRuleSets, config.rootDir);
        issues.push(...fileIssues);

        if (config.contentRuleSets.length > 0) {
            const contentIssues = await lintFileContent(filePath, config.contentRuleSets);
            issues.push(...contentIssues);
        }
    }

    return issues;
}

/**
 * Validate a single file against configured rule groups for its extension.
 *
 * @param filePath - Full file path.
 * @param extensionRuleSets - Configured extension rule sets.
 * @param rootDir - Configured root directory.
 * @returns List of lint issues.
 */
function validateFileName(filePath: string, extensionRuleSets: readonly ExtensionRuleSet[], rootDir: string): LintIssue[] {
    const extension = path.extname(filePath);
    const matchedRuleSets = findRuleSetsForExtension(extension, extensionRuleSets);
    const ruleSet = mergeRuleSets(extension, matchedRuleSets);

    if (!ruleSet) {
        return [];
    }

    const artifactName = getArtifactNameFromFilePath(filePath);
    const issues: LintIssue[] = [];

    if (ruleSet.folderName && !isFileInRequiredFolder(filePath, rootDir, ruleSet.folderName)) {
        issues.push({
            filePath,
            artifactName,
            extension,
            subjectType: 'artifact',
            subjectName: artifactName,
            failedRuleDescription: `File must be located in folder "${ruleSet.folderName}" under configured rootDir`,
            failedPattern: `folder:${ruleSet.folderName}`
        });
    }

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
 * Resolve matching rule sets for a file extension.
 *
 * @param extension - File extension.
 * @param extensionRuleSets - Configured extension rule sets.
 * @returns Matching extension rule sets.
 */
function findRuleSetsForExtension(extension: string, extensionRuleSets: readonly ExtensionRuleSet[]): ExtensionRuleSet[] {
    return extensionRuleSets.filter((ruleSet) => ruleSet.extension === '*' || ruleSet.extension === extension);
}

/**
 * Merge multiple rule sets into a single effective set.
 *
 * @param extension - File extension.
 * @param ruleSets - Matching rule sets for extension.
 * @returns Merged rule set or undefined when no rules apply.
 */
function mergeRuleSets(extension: string, ruleSets: readonly ExtensionRuleSet[]): ExtensionRuleSet | undefined {
    if (ruleSets.length === 0) {
        return undefined;
    }

    const specificRuleSets = ruleSets.filter((ruleSet) => ruleSet.extension === extension);
    const wildcardRuleSets = ruleSets.filter((ruleSet) => ruleSet.extension === '*');

    const specificFolderName = specificRuleSets.find((ruleSet) => ruleSet.folderName !== undefined)?.folderName;
    const wildcardFolderName = wildcardRuleSets.find((ruleSet) => ruleSet.folderName !== undefined)?.folderName;

    const allRules = ruleSets.flatMap((ruleSet) => ruleSet.groups.all ?? []);
    const anyRules = ruleSets.flatMap((ruleSet) => ruleSet.groups.any ?? []);

    return {
        extension,
        folderName: specificFolderName ?? wildcardFolderName,
        groups: {
            all: allRules.length > 0 ? allRules : undefined,
            any: anyRules.length > 0 ? anyRules : undefined
        }
    };
}

/**
 * Check whether a file is located under a target folder name within rootDir.
 *
 * @param filePath - Candidate file path.
 * @param rootDir - Configured root directory.
 * @param requiredFolderName - Folder name to enforce.
 * @returns True when file is under rootDir and contained in required folder.
 */
function isFileInRequiredFolder(filePath: string, rootDir: string, requiredFolderName: string): boolean {
    const absoluteRootDir = path.resolve(rootDir);
    const absoluteFilePath = path.resolve(filePath);
    const relativeToRoot = path.relative(absoluteRootDir, absoluteFilePath);

    // Files outside rootDir are never valid for folder enforcement.
    if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
        return false;
    }

    const parentDirectory = path.dirname(relativeToRoot);
    if (parentDirectory === '.' || parentDirectory.length === 0) {
        return false;
    }

    const folderSegments = parentDirectory.split(path.sep);
    return folderSegments.includes(requiredFolderName);
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
                subjectType: 'artifact',
                subjectName: artifactName,
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
            subjectType: 'artifact',
            subjectName: artifactName,
            failedRuleDescription: 'At least one OR-group rule must match: ' + rules.map((rule) => rule.description).join(' | '),
            failedPattern: rules.map(toRegexLiteral).join(' OR ')
        }
    ];
}
