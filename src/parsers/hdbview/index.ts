import type { ExtractedSubject } from '../../types/issues';
import { HdbViewLexer } from './lexer';
import { hdbViewParser } from './parser';
import { HdbViewColumnVisitor } from './visitor';

/**
 * Extract column alias names from the content of a `.hdbview` DDL file.
 *
 * Uses a Chevrotain lexer and CstParser. Handles block/line comments,
 * multi-line expressions, quoted and unquoted identifiers, schema-qualified
 * view names, subquery isolation, and both extraction modes:
 *   - Explicit column list:  VIEW V ("A","B") AS SELECT ...
 *   - SELECT-clause aliases: VIEW V AS SELECT T.X AS "A", T.Y AS "B" FROM T
 *
 * Gracefully returns partial results on invalid input — does not throw.
 *
 * @param fileContent - Raw UTF-8 file content (LF or CRLF).
 * @returns Array of ExtractedSubject with type 'field' for each alias found.
 */
export function extractViewColumns(fileContent: string): ExtractedSubject[] {
    const lexResult = HdbViewLexer.tokenize(fileContent);

    // Feed the token stream to the singleton parser.
    hdbViewParser.input = lexResult.tokens;
    const cst = hdbViewParser.createViewStatement();

    // Lex/parse errors are intentionally not re-thrown — the CST visitor
    // will extract whatever columns could be parsed from the partial tree.
    // Guard against a completely unrecoverable parse (cst may be undefined).
    if (!cst) {
        return [];
    }

    const visitor = new HdbViewColumnVisitor();
    visitor.visit(cst);
    return visitor.columns;
}
