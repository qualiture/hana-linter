import { ContentRuleSet, ExtensionRuleSet } from './rules';

export type LintConfig = {
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
    /**
     * Optional compiled content rule sets.
     */
    readonly contentRuleSets: readonly ContentRuleSet[];
};
