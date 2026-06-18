import { LintIssue } from './types/issues';

/**
 * Print lint result report to stdout/stderr.
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

    for (const issue of issues) {
        console.error(`- File: ${issue.filePath}`);
        console.error(`  Artifact: ${issue.artifactName}`);
        if (issue.subjectType && issue.subjectName) {
            console.error(`  Subject: ${issue.subjectType} (${issue.subjectName})`);
        }
        console.error(`  Type: ${issue.extension}`);
        console.error(`  Failed rule: ${issue.failedRuleDescription}`);
        console.error(`  Expected regex: ${issue.failedPattern}`);
        console.error('');
    }
}
