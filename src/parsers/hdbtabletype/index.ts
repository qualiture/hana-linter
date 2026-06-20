import type { ExtractedSubject } from '../../types/issues';
import { HdbTableTypeLexer } from './lexer';
import { hdbTableTypeParser } from './parser';
import { HdbTableTypeColumnVisitor } from './visitor';

/**
 * Extract column names from the content of a `.hdbtabletype` DDL file.
 *
 * Uses a Chevrotain lexer and CstParser. The parser recognises the
 * `TYPE <name> AS TABLE ( <columnList> )` statement and produces a CST
 * from which a visitor extracts each column name as a `field` subject.
 *
 * Handles block/line comments, quoted and unquoted column identifiers,
 * schema-qualified type names, and all HANA data types with optional
 * precision/scale. The type name itself is consumed structurally but
 * never emitted as a field subject. Gracefully returns partial results
 * on invalid input — does not throw.
 *
 * @param fileContent - Raw UTF-8 file content (LF or CRLF).
 * @returns Array of ExtractedSubject with type 'field' for each column found.
 */
export function extractTableTypeColumns(fileContent: string): ExtractedSubject[] {
    const lexResult = HdbTableTypeLexer.tokenize(fileContent);

    // Feed the token stream to the singleton parser.
    hdbTableTypeParser.input = lexResult.tokens;
    const cst = hdbTableTypeParser.createTableTypeStatement();

    // Lex/parse errors are intentionally not re-thrown — the CST visitor
    // will extract whatever columns could be parsed from the partial tree.
    // Guard against a completely unrecoverable parse (cst may be undefined).
    if (!cst) {
        return [];
    }

    const visitor = new HdbTableTypeColumnVisitor();
    visitor.visit(cst);
    return visitor.columns;
}
