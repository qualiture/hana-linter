import { LintIssue } from './types/issues';

/**
 * Print lint result report to stdout/stderr.
 * Issues are grouped by file, then by failed rule.
 *
 * @param issues - Found naming violations.
 * @param filesToValidate - Number of candidate files processed.
 */
export function printReport(issues: readonly LintIssue[], filesToValidate: readonly string[]): void {
    if (issues.length === 0) {
        console.info(`✅ HANA naming lint passed. Checked ${filesToValidate.length} file(s).`);
        return;
    }

    console.error(`❌ HANA naming lint failed. Violations: ${issues.length}`);
    console.error('');

    // Group issues by file path.
    const byFile = new Map<string, LintIssue[]>();
    for (const issue of issues) {
        const bucket = byFile.get(issue.filePath);
        if (bucket) {
            bucket.push(issue);
        } else {
            byFile.set(issue.filePath, [issue]);
        }
    }

    for (const [filePath, fileIssues] of byFile) {
        const count = fileIssues.length;
        console.error(`File: ${filePath}  (${count} violation${count === 1 ? '' : 's'})`);

        // Group file issues by failed rule description.
        const byRule = new Map<string, LintIssue[]>();
        for (const issue of fileIssues) {
            const key = `${issue.failedRuleDescription}||${issue.failedPattern}`;
            const bucket = byRule.get(key);
            if (bucket) {
                bucket.push(issue);
            } else {
                byRule.set(key, [issue]);
            }
        }

        for (const ruleIssues of byRule.values()) {
            const { failedRuleDescription, failedPattern } = ruleIssues[0]!;
            console.error(`  Rule: "${failedRuleDescription}" (pattern: ${failedPattern})`);

            for (const issue of ruleIssues) {
                const location = issue.lineNumber !== undefined ? ` at line ${issue.lineNumber}` : '';
                if (issue.subjectType && issue.subjectName) {
                    console.error(`    - ${issue.subjectType} "${issue.subjectName}"${location}`);
                } else {
                    console.error(`    - artifact "${issue.artifactName}"${location}`);
                }
            }
        }

        console.error('');
    }
}
