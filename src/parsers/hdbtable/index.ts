import type { ExtractedSubject } from '../../types/issues';
import { HdbTableLexer } from './lexer';
import { hdbTableParser } from './parser';
import { HdbTableColumnVisitor } from './visitor';

/**
 * Extract column names from the content of a `.hdbtable` DDL file.
 *
 * Uses a Chevrotain lexer and CstParser. Handles block/line comments,
 * multi-line definitions, quoted and unquoted identifiers, and HANA-
 * specific table variants (COLUMN TABLE, ROW TABLE, GLOBAL TEMPORARY
 * COLUMN TABLE). Gracefully returns partial results on invalid input —
 * does not throw.
 *
 * @param fileContent - Raw UTF-8 file content (LF or CRLF).
 * @returns Array of ExtractedSubject with type 'field' for each column found.
 */
export function extractTableColumns(fileContent: string): ExtractedSubject[] {
    const lexResult = HdbTableLexer.tokenize(fileContent);

    // Feed the token stream to the singleton parser.
    hdbTableParser.input = lexResult.tokens;
    const cst = hdbTableParser.createTableStatement();

    // Lex/parse errors are intentionally not re-thrown — the CST visitor
    // will extract whatever columns could be parsed from the partial tree.
    // Guard against a completely unrecoverable parse (cst may be undefined).
    if (!cst) {
        return [];
    }

    const visitor = new HdbTableColumnVisitor();
    visitor.visit(cst);
    return visitor.columns;
}
