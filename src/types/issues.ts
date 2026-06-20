import type { ContentTarget } from './rules';

export type ExtractedSubject = {
    readonly type: ContentTarget;
    readonly name: string;
    readonly lineNumber?: number;
};

export type LintIssue = {
    readonly filePath: string;
    readonly artifactName: string;
    readonly extension: string;
    readonly subjectType?: 'artifact' | 'field' | 'inputParameter' | 'outputParameter' | 'roleName' | 'grantedRoleName' | 'sequenceName';
    readonly subjectName?: string;
    readonly lineNumber?: number;
    readonly failedRuleDescription: string;
    readonly failedPattern: string;
};
