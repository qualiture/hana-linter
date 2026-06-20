/**
 * Public library API for hana-linter.
 *
 * Import this entry point when using hana-linter programmatically
 * (e.g. from a VS Code extension). The CLI remains available via the
 * `hana-linter` binary.
 */

export { runLint } from './lint';
export { lintFileContent } from './content-lint';
export { readJsonConfig, toLintConfig } from './config';

export type { LintIssue, ExtractedSubject } from './types/issues';
export type { LintConfig } from './types/config';
export type { JsonLintConfig, JsonExtensionRuleSet, JsonContentRuleSet, JsonRuleDefinition, JsonRuleGroup, ContentTarget } from './types/rules';
