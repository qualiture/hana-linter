import type { ExtractedSubject } from '../../types/issues';
import { HdbIndexLexer } from './lexer';
import { hdbIndexParser } from './parser';
import { HdbIndexVisitor } from './visitor';

/**
 * Extract the index name from the content of an `.hdbindex` DDL file.
 *
 * Uses a Chevrotain lexer and CstParser to correctly handle all SAP HANA
 * index DDL variants:
 *   - bare `INDEX <name> ON <table> (<columns>)`
 *   - `CREATE INDEX <name> ON <table> (<columns>)`
 *   - `CREATE UNIQUE INDEX <name> ON <table> (<columns>)`
 *   - `CREATE [UNIQUE] BTREE|CPBTREE|INVERTED HASH|INVERTED VALUE|INVERTED INDIVIDUAL INDEX ...`
 *
 * The parser handles block/line comments, quoted and unquoted index names,
 * schema-qualified index names (schema prefix excluded from result),
 * and optional trailing semicolons.
 *
 * Column names and sort-order keywords (ASC/DESC) inside the column list
 * are consumed structurally and never extracted.
 *
 * Gracefully returns a partial or empty result on invalid input — does
 * not throw.
 *
 * @param fileContent - Raw UTF-8 file content (LF or CRLF).
 * @returns Array containing at most one ExtractedSubject with type 'indexName'.
 */
export function extractIndexName(fileContent: string): ExtractedSubject[] {
    const lexResult = HdbIndexLexer.tokenize(fileContent);

    // Feed the token stream to the singleton parser.
    hdbIndexParser.input = lexResult.tokens;
    const cst = hdbIndexParser.indexStatement();

    // Lex/parse errors are intentionally not re-thrown — the CST visitor
    // will extract whatever could be parsed from the partial tree.
    // Guard against a completely unrecoverable parse (cst may be undefined).
    if (!cst) {
        return [];
    }

    const visitor = new HdbIndexVisitor();
    visitor.visit(cst);
    return visitor.subjects;
}
