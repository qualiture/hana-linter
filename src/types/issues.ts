export type LintIssue = {
    readonly filePath: string;
    readonly artifactName: string;
    readonly extension: string;
    readonly subjectType?: 'artifact' | 'field' | 'inputParameter' | 'outputParameter';
    readonly subjectName?: string;
    readonly failedRuleDescription: string;
    readonly failedPattern: string;
};
