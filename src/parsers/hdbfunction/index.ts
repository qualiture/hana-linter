import type { ExtractedSubject } from '../../types/issues';
import { HdbFunctionLexer } from './lexer';
import { hdbFunctionParser } from './parser';
import { HdbFunctionParameterVisitor } from './visitor';

/**
 * Extract parameter names from the content of a `.hdbfunction` DDL file.
 *
 * Uses a Chevrotain lexer and CstParser. The parser recognises the function
 * header (parameter list, RETURNS clause, and options) and consumes the entire
 * function body (AS BEGIN … END) as an opaque block, ensuring that SQL keywords
 * inside the body never contaminate the extraction result.
 *
 * HANA functions accept only IN parameters. Every parameter produces an
 * { type: 'inputParameter', name } entry. No 'outputParameter' entries are
 * ever produced. RETURNS clause types and RETURNS TABLE column names are
 * parsed structurally but not extracted.
 *
 * Handles block/line comments, quoted and unquoted identifiers, schema-qualified
 * function names, TABLE-type IN parameters, RETURNS TABLE definitions, and all
 * standard function options. Gracefully returns partial results on invalid input
 * — does not throw.
 *
 * @param fileContent - Raw UTF-8 file content (LF or CRLF).
 * @returns Array of ExtractedSubject with type 'inputParameter' only.
 */
export function extractFunctionParameters(fileContent: string): ExtractedSubject[] {
    const lexResult = HdbFunctionLexer.tokenize(fileContent);

    // Feed the token stream to the singleton parser.
    hdbFunctionParser.input = lexResult.tokens;
    const cst = hdbFunctionParser.createFunctionStatement();

    // Lex/parse errors are intentionally not re-thrown — the CST visitor
    // will extract whatever parameters could be parsed from the partial tree.
    // Guard against a completely unrecoverable parse (cst may be undefined).
    if (!cst) {
        return [];
    }

    const visitor = new HdbFunctionParameterVisitor();
    visitor.visit(cst);
    return visitor.parameters;
}
