import type { ExtractedSubject } from '../../types/issues';
import { HdbTriggerLexer } from './lexer';
import { hdbTriggerParser } from './parser';
import { HdbTriggerNameVisitor } from './visitor';

/**
 * Extract the trigger name from the content of an `.hdbtrigger` DDL file.
 *
 * Uses a Chevrotain lexer and CstParser to correctly handle all SAP HANA
 * trigger DDL variants:
 *   - `[CREATE] TRIGGER <name> BEFORE|AFTER INSERT|UPDATE|DELETE ON <table> ...`
 *   - `[CREATE] TRIGGER <name> INSTEAD OF INSERT|UPDATE|DELETE ON <table> ...`
 *   - Optional `UPDATE OF <column_list>` event modifier
 *   - Optional `REFERENCING OLD|NEW ROW|TABLE AS <alias>` clause
 *   - Optional `FOR EACH ROW | FOR EACH STATEMENT` granularity clause
 *   - Optional `WHEN (<condition>)` predicate clause
 *
 * The trigger body (`BEGIN … END`) is consumed opaquely at the grammar level
 * so that SQLScript keywords and identifiers inside the body are never
 * extracted as trigger-name subjects.
 *
 * The parser handles block/line comments, quoted and unquoted trigger names,
 * schema-qualified trigger names (schema prefix excluded from result), and
 * optional trailing semicolons.
 *
 * Gracefully returns a partial or empty result on invalid input — does not
 * throw.
 *
 * @param fileContent - Raw UTF-8 file content (LF or CRLF).
 * @returns Array containing at most one ExtractedSubject with type 'triggerName'.
 */
export function extractTriggerName(fileContent: string): ExtractedSubject[] {
    const lexResult = HdbTriggerLexer.tokenize(fileContent);

    // Feed the token stream to the singleton parser.
    hdbTriggerParser.input = lexResult.tokens;
    const cst = hdbTriggerParser.triggerStatement();

    // Lex/parse errors are intentionally not re-thrown — the CST visitor
    // will extract whatever could be parsed from the partial tree.
    // Guard against a completely unrecoverable parse (cst may be undefined).
    if (!cst) {
        return [];
    }

    const visitor = new HdbTriggerNameVisitor();
    visitor.visit(cst);
    return visitor.subjects;
}
