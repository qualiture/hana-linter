export type JsonRuleDefinition = {
    /**
     * Human-readable rule label.
     */
    readonly description: string;
    /**
     * Regex source string (without leading/trailing slashes).
     */
    readonly pattern: string;
    /**
     * Optional regex flags, e.g. "i", "u", "iu".
     */
    readonly flags?: string;
};

export type JsonRuleGroup = {
    /**
     * Rules that must all pass.
     */
    readonly all?: readonly JsonRuleDefinition[];
    /**
     * Rules where at least one must pass.
     */
    readonly any?: readonly JsonRuleDefinition[];
};

export type JsonExtensionRuleSet = {
    /**
     * File extension this rule set applies to.
     * Example: ".hdbtable". Use "*" to apply rules to all extensions.
     */
    readonly extension: string;
    /**
     * Optional folder name that files must be located in (at any depth under rootDir).
     */
    readonly folderName?: string;
    /**
     * Grouped rule logic for this extension.
     */
    readonly groups: JsonRuleGroup;
};

export type ContentTarget = 'field' | 'inputParameter' | 'outputParameter';

export type JsonContentRuleSet = {
    /**
     * File extension this content rule set applies to.
     * Example: ".hdbtable". Use "*" to apply rules to all extensions.
     */
    readonly extension: string;
    /**
     * Extracted identifier type to validate.
     */
    readonly target: ContentTarget;
    /**
     * Grouped rule logic for this content target.
     */
    readonly groups: JsonRuleGroup;
};

export type JsonLintConfig = {
    /**
     * Base folder to scan in full-scan mode, usually "db/src".
     */
    readonly rootDir: string;
    /**
     * Directory names to skip during recursive traversal.
     */
    readonly ignoredDirectories: readonly string[];
    /**
     * Rule sets grouped by extension.
     */
    readonly extensionRuleSets: readonly JsonExtensionRuleSet[];
    /**
     * Optional content-based rule sets (fields/parameters inside files).
     */
    readonly contentRuleSets?: readonly JsonContentRuleSet[];
};

export type RuleDefinition = {
    /**
     * Human-readable rule label.
     */
    readonly description: string;
    /**
     * Compiled regex pattern.
     */
    readonly pattern: RegExp;
    /**
     * Original regex source from config.
     */
    readonly source: string;
    /**
     * Original regex flags from config.
     */
    readonly flags: string;
};

export type RuleGroup = {
    /**
     * Rules that must all pass.
     */
    readonly all?: readonly RuleDefinition[];
    /**
     * Rules where at least one must pass.
     */
    readonly any?: readonly RuleDefinition[];
};

export type ExtensionRuleSet = {
    /**
     * File extension this rule set applies to.
     * "*" means rules apply to all extensions.
     */
    readonly extension: string;
    /**
     * Optional folder name that files must be located in (at any depth under rootDir).
     */
    readonly folderName?: string;
    /**
     * Grouped rule logic for this extension.
     */
    readonly groups: RuleGroup;
};

export type ContentRuleSet = {
    /**
     * File extension this content rule set applies to.
     * "*" means rules apply to all extensions.
     */
    readonly extension: string;
    /**
     * Extracted identifier type to validate.
     */
    readonly target: ContentTarget;
    /**
     * Grouped rule logic for this content target.
     */
    readonly groups: RuleGroup;
};
