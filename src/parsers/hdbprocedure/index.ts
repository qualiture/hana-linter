import type { ExtractedSubject } from '../../types/issues';
import { HdbProcedureLexer } from './lexer';
import { hdbProcedureParser } from './parser';
import { HdbProcedureParameterVisitor } from './visitor';

/**
 * Extract parameter names from the content of a `.hdbprocedure` DDL file.
 *
 * Uses a Chevrotain lexer and CstParser. The parser recognises the procedure
 * header (parameter list + options) and consumes the entire procedure body
 * (AS BEGIN … END) as an opaque block, ensuring that SQL keywords IN/OUT/INOUT
 * inside the body never contaminate the extraction result.
 *
 * Each IN or INOUT parameter produces an { type: 'inputParameter', name } entry.
 * Each OUT or INOUT parameter produces an { type: 'outputParameter', name } entry.
 * An INOUT parameter therefore yields two entries (one of each type).
 *
 * Handles block/line comments, quoted and unquoted identifiers, schema-qualified
 * procedure names, TABLE-type parameters, and all standard procedure options.
 * Gracefully returns partial results on invalid input — does not throw.
 *
 * @param fileContent - Raw UTF-8 file content (LF or CRLF).
 * @returns Array of ExtractedSubject with type 'inputParameter' or 'outputParameter'.
 */
export function extractProcedureParameters(fileContent: string): ExtractedSubject[] {
    const lexResult = HdbProcedureLexer.tokenize(fileContent);

    // Feed the token stream to the singleton parser.
    hdbProcedureParser.input = lexResult.tokens;
    const cst = hdbProcedureParser.createProcedureStatement();

    // Lex/parse errors are intentionally not re-thrown — the CST visitor
    // will extract whatever parameters could be parsed from the partial tree.
    // Guard against a completely unrecoverable parse (cst may be undefined).
    if (!cst) {
        return [];
    }

    const visitor = new HdbProcedureParameterVisitor();
    visitor.visit(cst);
    return visitor.parameters;
}
