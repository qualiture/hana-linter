import type { ExtractedSubject } from '../../types/issues';
import { HdbRoleLexer } from './lexer';
import { hdbRoleParser } from './parser';
import { HdbRoleNameVisitor } from './visitor';

/**
 * Extract the role name and any granted role names from the content of
 * an `.hdbrole` DSL file (SAP HANA XS Classic format).
 *
 * Uses a Chevrotain lexer and CstParser. Handles block/line comments,
 * quoted and unquoted identifiers, plain and package-qualified role names,
 * the optional `extends roles { ... }` block, and all privilege clause
 * types (catalog schema, catalog sql object, catalog package, application
 * privilege). Privilege body content is never extracted.
 *
 * Gracefully returns partial results on invalid input — does not throw.
 *
 * @param fileContent - Raw UTF-8 file content (LF or CRLF).
 * @returns Array of ExtractedSubject:
 *   - First element (if parseable): type 'roleName', the role being defined.
 *   - Subsequent elements: type 'grantedRoleName', one per inherited role.
 */
export function extractRoleNames(fileContent: string): ExtractedSubject[] {
    const lexResult = HdbRoleLexer.tokenize(fileContent);

    // Feed the token stream to the singleton parser.
    hdbRoleParser.input = lexResult.tokens;
    const cst = hdbRoleParser.roleDefinition();

    // Lex/parse errors are intentionally not re-thrown — the CST visitor
    // will extract whatever names could be parsed from the partial tree.
    // Guard against a completely unrecoverable parse (cst may be undefined).
    if (!cst) {
        return [];
    }

    const visitor = new HdbRoleNameVisitor();
    visitor.visit(cst);
    return visitor.subjects;
}
