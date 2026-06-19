import type { ContentTarget } from './rules';

export type ExtractedSubject = {
    readonly type: ContentTarget;
    readonly name: string;
};

export type LintIssue = {
    readonly filePath: string;
    readonly artifactName: string;
    readonly extension: string;
    readonly subjectType?: 'artifact' | 'field' | 'inputParameter' | 'outputParameter';
    readonly subjectName?: string;
    readonly failedRuleDescription: string;
    readonly failedPattern: string;
};
