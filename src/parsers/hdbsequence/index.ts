import type { ExtractedSubject } from '../../types/issues';
import { HdbSequenceLexer } from './lexer';
import { hdbSequenceParser } from './parser';
import { HdbSequenceNameVisitor } from './visitor';

/**
 * Extract the sequence name from the content of a `.hdbsequence` DDL file.
 *
 * Uses a Chevrotain lexer and CstParser. The parser recognises the
 * `SEQUENCE <name> [<options>]` statement and produces a CST from which
 * a visitor extracts the local sequence name as a single `sequenceName`
 * subject.
 *
 * For schema-qualified names (`"SCHEMA"."SEQ_NAME"`), only the local name
 * (the part after the dot) is returned; the schema prefix is consumed
 * structurally and excluded from the result.
 *
 * The `RESET BY SELECT` clause is consumed as an opaque token stream;
 * no identifiers within it are extracted.
 *
 * Handles block/line comments, quoted and unquoted sequence names,
 * schema-qualified names, and all standard sequence options including
 * NO MINVALUE, NO MAXVALUE, NO CYCLE, DEPENDS ON, and RESET BY SELECT.
 *
 * Gracefully returns a partial or empty result on invalid input — does
 * not throw.
 *
 * @param fileContent - Raw UTF-8 file content (LF or CRLF).
 * @returns Array containing at most one ExtractedSubject with type 'sequenceName'.
 */
export function extractSequenceName(fileContent: string): ExtractedSubject[] {
    const lexResult = HdbSequenceLexer.tokenize(fileContent);

    // Feed the token stream to the singleton parser.
    hdbSequenceParser.input = lexResult.tokens;
    const cst = hdbSequenceParser.sequenceStatement();

    // Lex/parse errors are intentionally not re-thrown — the CST visitor
    // will extract whatever could be parsed from the partial tree.
    // Guard against a completely unrecoverable parse (cst may be undefined).
    if (!cst) {
        return [];
    }

    const visitor = new HdbSequenceNameVisitor();
    visitor.visit(cst);
    return visitor.subjects;
}
