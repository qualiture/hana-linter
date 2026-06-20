import type { ExtractedSubject } from '../../types/issues';
import { HdbSchedulerJobLexer } from './lexer';
import { hdbSchedulerJobParser } from './parser';
import { HdbSchedulerJobVisitor } from './visitor';

/**
 * Extract the job action name from the content of an `.hdbschedulerjob` file.
 *
 * Uses a Chevrotain lexer and CstParser to handle C-style comments
 * (`//` and `/* … *\/`), trailing commas, and nested JSON structures that
 * standard `JSON.parse()` cannot tolerate.
 *
 * The function locates the top-level `"action"` key and returns its string
 * value (outer double-quotes stripped) as a single `jobAction` subject.
 *
 * Nested objects and arrays (e.g., the `schedules` array) are consumed
 * structurally; no values within them are extracted.
 *
 * Gracefully returns a partial or empty result on invalid input — does
 * not throw.
 *
 * @param fileContent - Raw UTF-8 file content (LF or CRLF). A leading
 *   UTF-8 BOM is stripped automatically before tokenisation.
 * @returns Array containing at most one ExtractedSubject with type 'jobAction'.
 */
export function extractSchedulerJobAction(fileContent: string): ExtractedSubject[] {
    // Strip UTF-8 BOM if present (AC-11).
    const normalised = fileContent.startsWith('\uFEFF') ? fileContent.slice(1) : fileContent;

    const lexResult = HdbSchedulerJobLexer.tokenize(normalised);

    // Feed the token stream to the singleton parser.
    hdbSchedulerJobParser.input = lexResult.tokens;
    const cst = hdbSchedulerJobParser.schedulerJobDocument();

    // Lex/parse errors are intentionally not re-thrown — the CST visitor
    // will extract whatever could be parsed from the partial tree.
    // Guard against a completely unrecoverable parse (cst may be undefined).
    if (!cst) {
        return [];
    }

    const visitor = new HdbSchedulerJobVisitor();
    visitor.visit(cst);
    return visitor.subjects;
}
