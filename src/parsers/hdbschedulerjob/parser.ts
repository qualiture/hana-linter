import { CstParser, type TokenType } from 'chevrotain';
import { allTokens, ActionKey, Comma, FalseKw, JsonNumber, JsonString, LBrace, LBracket, NullKw, RBrace, RBracket, Colon, TrueKw } from './lexer';

/**
 * Chevrotain CstParser for HANA `.hdbschedulerjob` JSON-like config files.
 *
 * Grammar covers:
 *  - schedulerJobDocument: a top-level JSON object
 *  - object: { member* }  (trailing comma accepted)
 *  - member: actionMember | JsonString : value
 *  - actionMember: "action" : JsonString   ← sole extraction point
 *  - value: JsonString | JsonNumber | true | false | null | object | array
 *  - array: [ value* ]  (trailing comma accepted)
 *
 * Trailing commas are tolerated via a MANY+GATE pattern that exits when
 * the next token is the closing `}` or `]`, allowing an optional comma to
 * have been consumed inside the loop body without triggering a parse error.
 *
 * Nested objects and arrays (e.g., the `schedules` array of schedule objects)
 * are recursively consumed via the `value` rule. Because the visitor only
 * overrides the `actionMember` method, no identifiers from nested structures
 * are extracted.
 *
 * Error recovery is enabled by default in CstParser (single-token deletion /
 * insertion). Invalid tokens cause the parser to skip and continue rather than
 * throwing, so `extractSchedulerJobAction()` always returns a result.
 */
export class HdbSchedulerJobParser extends CstParser {
    constructor() {
        super(allTokens);
        this.performSelfAnalysis();
    }

    // -----------------------------------------------------------------------
    // Top-level: a .hdbschedulerjob file is a single JSON object.
    // -----------------------------------------------------------------------

    public schedulerJobDocument = this.RULE('schedulerJobDocument', () => {
        this.SUBRULE(this.object);
    });

    // -----------------------------------------------------------------------
    // JSON object: { member* }
    //
    // The MANY+GATE pattern gates on LA(1) !== RBrace. This means:
    //   - {}                 → MANY exits immediately
    //   - {"a":1}           → match member, MANY exits on }
    //   - {"a":1,"b":2}     → match both members, MANY exits on }
    //   - {"a":1,"b":2,}    → match both members + trailing comma, MANY exits on }
    // -----------------------------------------------------------------------

    public object = this.RULE('object', () => {
        this.CONSUME(LBrace);
        this.MANY({
            GATE: () => (this.LA(1).tokenType as TokenType) !== RBrace,
            DEF: () => {
                this.SUBRULE(this.member);
                this.OPTION(() => this.CONSUME(Comma));
            }
        });
        this.CONSUME(RBrace);
    });

    // -----------------------------------------------------------------------
    // Member: either the "action" key-value pair or a generic key-value pair.
    //
    // The OR is unambiguous with one-token lookahead:
    //   - ActionKey ("action") → actionMember
    //   - JsonString           → generic member
    // -----------------------------------------------------------------------

    public member = this.RULE('member', () => {
        this.OR([
            { ALT: () => this.SUBRULE(this.actionMember) },
            {
                ALT: () => {
                    this.CONSUME(JsonString);
                    this.CONSUME(Colon);
                    this.SUBRULE(this.value);
                }
            }
        ]);
    });

    // -----------------------------------------------------------------------
    // actionMember: "action" : <string-value>
    //
    // This is the sole CST node surfaced by the visitor for extraction.
    // The JsonString token image (including surrounding double-quotes) is
    // read by HdbSchedulerJobVisitor.actionMember() and stripped of its
    // outer quotes to produce the final `name` value.
    // -----------------------------------------------------------------------

    public actionMember = this.RULE('actionMember', () => {
        this.CONSUME(ActionKey);
        this.CONSUME(Colon);
        this.CONSUME(JsonString);
    });

    // -----------------------------------------------------------------------
    // JSON value: string | number | true | false | null | object | array
    // -----------------------------------------------------------------------

    public value = this.RULE('value', () => {
        this.OR([
            { ALT: () => this.CONSUME(JsonString) },
            { ALT: () => this.CONSUME(JsonNumber) },
            { ALT: () => this.CONSUME(TrueKw) },
            { ALT: () => this.CONSUME(FalseKw) },
            { ALT: () => this.CONSUME(NullKw) },
            { ALT: () => this.SUBRULE(this.object) },
            { ALT: () => this.SUBRULE(this.array) }
        ]);
    });

    // -----------------------------------------------------------------------
    // JSON array: [ value* ]  (trailing comma accepted via same GATE pattern)
    // -----------------------------------------------------------------------

    public array = this.RULE('array', () => {
        this.CONSUME(LBracket);
        this.MANY({
            GATE: () => (this.LA(1).tokenType as TokenType) !== RBracket,
            DEF: () => {
                this.SUBRULE(this.value);
                this.OPTION(() => this.CONSUME(Comma));
            }
        });
        this.CONSUME(RBracket);
    });
}

/**
 * Singleton parser instance — instantiated once at module load time.
 *
 * Reused across every `extractSchedulerJobAction()` call.
 * Caller must reset `hdbSchedulerJobParser.input` before each parse.
 */
export const hdbSchedulerJobParser = new HdbSchedulerJobParser();
