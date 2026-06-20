import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ExtractedSubject, LintIssue } from './types/issues';
import { ContentRuleSet, RuleDefinition } from './types/rules';
import { extractTableColumns } from './parsers/hdbtable/index';
import { extractViewColumns } from './parsers/hdbview/index';
import { extractProcedureParameters } from './parsers/hdbprocedure/index';
import { extractFunctionParameters } from './parsers/hdbfunction/index';
import { extractTableTypeColumns } from './parsers/hdbtabletype/index';
import { extractRoleNames } from './parsers/hdbrole/index';
import { extractCalculationViewOutputs } from './parsers/hdbcalculationview/index';
import { extractSequenceName } from './parsers/hdbsequence/index';
import { extractSchedulerJobAction } from './parsers/hdbschedulerjob/index';
import { extractIndexName } from './parsers/hdbindex/index';

/**
 * Run content-based naming lint for a file.
 *
 * @param filePath - Candidate file path.
 * @param contentRuleSets - Configured content rule sets.
 * @returns List of content-based lint issues.
 */
export async function lintFileContent(filePath: string, contentRuleSets: readonly ContentRuleSet[]): Promise<LintIssue[]> {
    const extension = path.extname(filePath);
    const matchingRuleSets = contentRuleSets.filter((ruleSet) => ruleSet.extension === '*' || ruleSet.extension === extension);

    if (matchingRuleSets.length === 0) {
        return [];
    }

    const fileContent = await fs.readFile(filePath, { encoding: 'utf-8' });
    const extractedSubjects = extractSubjects(extension, fileContent);

    if (extractedSubjects.length === 0) {
        return [];
    }

    const issues: LintIssue[] = [];

    for (const subject of extractedSubjects) {
        const targetRuleSets = matchingRuleSets.filter((ruleSet) => ruleSet.target === subject.type);
        if (targetRuleSets.length === 0) {
            continue;
        }

        const allRules = targetRuleSets.flatMap((ruleSet) => ruleSet.groups.all ?? []);
        const anyRules = targetRuleSets.flatMap((ruleSet) => ruleSet.groups.any ?? []);

        if (allRules.length > 0) {
            issues.push(...evaluateAllRules(filePath, extension, subject, allRules));
        }

        if (anyRules.length > 0) {
            issues.push(...evaluateAnyRules(filePath, extension, subject, anyRules));
        }
    }

    return issues;
}

function extractSubjects(extension: string, fileContent: string): ExtractedSubject[] {
    if (extension === '.hdbtable') {
        return extractTableColumns(fileContent);
    }

    if (extension === '.hdbview') {
        return extractViewColumns(fileContent);
    }

    if (extension === '.hdbprocedure') {
        return extractProcedureParameters(fileContent);
    }

    if (extension === '.hdbfunction') {
        return extractFunctionParameters(fileContent);
    }

    if (extension === '.hdbtabletype') {
        return extractTableTypeColumns(fileContent);
    }

    if (extension === '.hdbrole') {
        return extractRoleNames(fileContent);
    }

    if (extension === '.hdbcalculationview') {
        return extractCalculationViewOutputs(fileContent);
    }

    if (extension === '.hdbsequence') {
        return extractSequenceName(fileContent);
    }

    if (extension === '.hdbschedulerjob') {
        return extractSchedulerJobAction(fileContent);
    }

    if (extension === '.hdbindex') {
        return extractIndexName(fileContent);
    }

    return [];
}

function evaluateAllRules(filePath: string, extension: string, subject: ExtractedSubject, rules: readonly RuleDefinition[]): LintIssue[] {
    const issues: LintIssue[] = [];

    for (const rule of rules) {
        if (!rule.pattern.test(subject.name)) {
            issues.push({
                filePath,
                artifactName: path.parse(filePath).name,
                extension,
                subjectType: subject.type,
                subjectName: subject.name,
                lineNumber: subject.lineNumber,
                failedRuleDescription: rule.description,
                failedPattern: toRegexLiteral(rule)
            });
        }
    }

    return issues;
}

function evaluateAnyRules(filePath: string, extension: string, subject: ExtractedSubject, rules: readonly RuleDefinition[]): LintIssue[] {
    const hasAtLeastOneMatch = rules.some((rule) => rule.pattern.test(subject.name));

    if (hasAtLeastOneMatch) {
        return [];
    }

    return [
        {
            filePath,
            artifactName: path.parse(filePath).name,
            extension,
            subjectType: subject.type,
            subjectName: subject.name,
            lineNumber: subject.lineNumber,
            failedRuleDescription: 'At least one OR-group rule must match: ' + rules.map((rule) => rule.description).join(' | '),
            failedPattern: rules.map(toRegexLiteral).join(' OR ')
        }
    ];
}

function toRegexLiteral(rule: RuleDefinition): string {
    return `/${rule.source}/${rule.flags}`;
}
