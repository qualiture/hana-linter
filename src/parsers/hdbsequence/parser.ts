import { CstParser, type TokenType } from 'chevrotain';
import {
    allTokens,
    AndKw,
    ByKw,
    CaseKw,
    Comma,
    CoalesceKw,
    CountKw,
    CycleKw,
    DependsKw,
    Dot,
    ElseKw,
    EndKw,
    Eq,
    FromKw,
    Gt,
    GtEq,
    Identifier,
    IfnullKw,
    IncrementKw,
    InnerKw,
    IsKw,
    JoinKw,
    LeftKw,
    LParen,
    Lt,
    LtEq,
    MaxKw,
    MaxvalueKw,
    MinKw,
    MinvalueKw,
    Minus,
    NoKw,
    NotEq,
    NotKw,
    NullKw,
    NumericLiteral,
    NvlKw,
    OnKw,
    OrKw,
    Plus,
    QuotedIdentifier,
    ResetKw,
    RParen,
    SelectKw,
    Semicolon,
    SequenceKw,
    Slash,
    Star,
    StartKw,
    StringLiteral,
    SumKw,
    ThenKw,
    WhenKw,
    WhereKw,
    WithKw
} from './lexer';

// ---------------------------------------------------------------------------
// The set of token types that signal the start of a new sequenceOption (or
// end of statement). Used as the GATE predicate in resetByClause to stop
// consuming tokens from the RESET BY SELECT body.
// ---------------------------------------------------------------------------

const SEQUENCE_OPTION_START_TOKENS: Set<TokenType> = new Set([
    IncrementKw,
    StartKw,
    MinvalueKw,
    MaxvalueKw,
    NoKw,
    CycleKw,
    ResetKw,
    DependsKw,
    Semicolon
]);

/**
 * Chevrotain CstParser for HANA `.hdbsequence` DDL files.
 *
 * Grammar covers:
 *  - SEQUENCE <sequenceName> { <sequenceOption> } [;]
 *  - sequenceName: [schema "."] name  (quoted or unquoted)
 *  - sequenceOption: INCREMENT BY n  |  START WITH n
 *                  | MINVALUE n      |  NO MINVALUE
 *                  | MAXVALUE n      |  NO MAXVALUE
 *                  | CYCLE           |  NO CYCLE
 *                  | RESET BY SELECT <any tokens>
 *                  | DEPENDS ON <identifier>
 *
 * The RESET BY SELECT clause is consumed as an opaque token stream via
 * a MANY+GATE pattern. No identifiers inside that clause are extracted.
 *
 * Only the `sequenceName` node is surfaced by the visitor; all option
 * sub-trees are parsed but blocked from extraction.
 *
 * Error recovery is enabled by default in CstParser.
 */
export class HdbSequenceParser extends CstParser {
    constructor() {
        super(allTokens);
        this.performSelfAnalysis();
    }

    // -----------------------------------------------------------------------
    // Top-level rule: SEQUENCE <sequenceName> { <sequenceOption> } [;]
    // -----------------------------------------------------------------------

    public sequenceStatement = this.RULE('sequenceStatement', () => {
        this.CONSUME(SequenceKw);
        this.SUBRULE(this.sequenceName);
        this.MANY(() => this.SUBRULE(this.sequenceOption));
        this.OPTION(() => this.CONSUME(Semicolon));
    });

    // -----------------------------------------------------------------------
    // Sequence name: [schema "."] name
    // Both quoted ("MY_SCHEMA"."MY_SEQ") and unquoted (MY_SEQ) are handled.
    // The visitor always extracts the LAST identifier child (local name).
    // -----------------------------------------------------------------------

    public sequenceName = this.RULE('sequenceName', () => {
        this.SUBRULE(this.identifier);
        this.OPTION(() => {
            this.CONSUME(Dot);
            this.SUBRULE2(this.identifier);
        });
    });

    // -----------------------------------------------------------------------
    // Sequence option: one of the seven recognised clause types.
    //
    // Ordering in the OR list matters: resetByOption is placed LAST so that
    // INCREMENT, START, MINVALUE, MAXVALUE, NO, CYCLE, and DEPENDS are tried
    // first (all have unambiguous first tokens distinct from RESET).
    // -----------------------------------------------------------------------

    public sequenceOption = this.RULE('sequenceOption', () => {
        this.OR([
            { ALT: () => this.SUBRULE(this.incrementByOption) },
            { ALT: () => this.SUBRULE(this.startWithOption) },
            { ALT: () => this.SUBRULE(this.minvalueOption) },
            { ALT: () => this.SUBRULE(this.maxvalueOption) },
            { ALT: () => this.SUBRULE(this.cycleOption) },
            { ALT: () => this.SUBRULE(this.dependsOnOption) },
            { ALT: () => this.SUBRULE(this.resetByOption) }
        ]);
    });

    // -----------------------------------------------------------------------
    // INCREMENT BY <numericLiteral>
    // -----------------------------------------------------------------------

    public incrementByOption = this.RULE('incrementByOption', () => {
        this.CONSUME(IncrementKw);
        this.CONSUME(ByKw);
        this.CONSUME(NumericLiteral);
    });

    // -----------------------------------------------------------------------
    // START WITH <numericLiteral>
    // -----------------------------------------------------------------------

    public startWithOption = this.RULE('startWithOption', () => {
        this.CONSUME(StartKw);
        this.CONSUME(WithKw);
        this.CONSUME(NumericLiteral);
    });

    // -----------------------------------------------------------------------
    // MINVALUE <numericLiteral>  |  NO MINVALUE
    // -----------------------------------------------------------------------

    public minvalueOption = this.RULE('minvalueOption', () => {
        this.OR([
            {
                ALT: () => {
                    this.CONSUME(MinvalueKw);
                    this.CONSUME(NumericLiteral);
                }
            },
            {
                ALT: () => {
                    this.CONSUME(NoKw);
                    this.CONSUME2(MinvalueKw);
                }
            }
        ]);
    });

    // -----------------------------------------------------------------------
    // MAXVALUE <numericLiteral>  |  NO MAXVALUE
    // -----------------------------------------------------------------------

    public maxvalueOption = this.RULE('maxvalueOption', () => {
        this.OR([
            {
                ALT: () => {
                    this.CONSUME(MaxvalueKw);
                    this.CONSUME(NumericLiteral);
                }
            },
            {
                ALT: () => {
                    this.CONSUME(NoKw);
                    this.CONSUME2(MaxvalueKw);
                }
            }
        ]);
    });

    // -----------------------------------------------------------------------
    // CYCLE  |  NO CYCLE
    // -----------------------------------------------------------------------

    public cycleOption = this.RULE('cycleOption', () => {
        this.OR([
            { ALT: () => this.CONSUME(CycleKw) },
            {
                ALT: () => {
                    this.CONSUME(NoKw);
                    this.CONSUME2(CycleKw);
                }
            }
        ]);
    });

    // -----------------------------------------------------------------------
    // DEPENDS ON <identifier>
    // -----------------------------------------------------------------------

    public dependsOnOption = this.RULE('dependsOnOption', () => {
        this.CONSUME(DependsKw);
        this.CONSUME(OnKw);
        this.SUBRULE(this.identifier);
    });

    // -----------------------------------------------------------------------
    // RESET BY SELECT <resetByToken>*
    //
    // The MANY loop uses a GATE predicate to stop consuming tokens when it
    // encounters the start of a new sequenceOption or a semicolon.
    // This lets the parser recover context without knowing the full SQL
    // grammar of the embedded SELECT statement.
    // -----------------------------------------------------------------------

    public resetByOption = this.RULE('resetByOption', () => {
        this.CONSUME(ResetKw);
        this.CONSUME(ByKw);
        this.SUBRULE(this.resetByClause);
    });

    public resetByClause = this.RULE('resetByClause', () => {
        this.CONSUME(SelectKw);
        this.MANY({
            GATE: () => !SEQUENCE_OPTION_START_TOKENS.has(this.LA(1).tokenType),
            DEF: () => this.SUBRULE(this.resetByToken)
        });
    });

    // -----------------------------------------------------------------------
    // resetByToken: consumes exactly one token from the set of token types
    // that can legally appear inside a RESET BY SELECT body.
    //
    // The GATE in resetByClause ensures this rule is only called when the
    // current token is NOT a sequenceOption start token; therefore we do not
    // need to list IncrementKw, StartKw, MinvalueKw, MaxvalueKw, NoKw,
    // CycleKw, ResetKw, DependsKw, or Semicolon here.
    // -----------------------------------------------------------------------

    public resetByToken = this.RULE('resetByToken', () => {
        this.OR([
            // Sequence DDL keywords that can also appear in SQL bodies
            { ALT: () => this.CONSUME(SequenceKw) },
            { ALT: () => this.CONSUME(ByKw) },
            { ALT: () => this.CONSUME(WithKw) },
            { ALT: () => this.CONSUME(OnKw) },
            // SQL clause / aggregate / function keywords
            { ALT: () => this.CONSUME(SelectKw) },
            { ALT: () => this.CONSUME(FromKw) },
            { ALT: () => this.CONSUME(WhereKw) },
            { ALT: () => this.CONSUME(IfnullKw) },
            { ALT: () => this.CONSUME(CoalesceKw) },
            { ALT: () => this.CONSUME(NvlKw) },
            { ALT: () => this.CONSUME(MaxKw) },
            { ALT: () => this.CONSUME(MinKw) },
            { ALT: () => this.CONSUME(CountKw) },
            { ALT: () => this.CONSUME(SumKw) },
            { ALT: () => this.CONSUME(AndKw) },
            { ALT: () => this.CONSUME(OrKw) },
            { ALT: () => this.CONSUME(IsKw) },
            { ALT: () => this.CONSUME(NullKw) },
            { ALT: () => this.CONSUME(NotKw) },
            { ALT: () => this.CONSUME(CaseKw) },
            { ALT: () => this.CONSUME(WhenKw) },
            { ALT: () => this.CONSUME(ThenKw) },
            { ALT: () => this.CONSUME(ElseKw) },
            { ALT: () => this.CONSUME(EndKw) },
            { ALT: () => this.CONSUME(JoinKw) },
            { ALT: () => this.CONSUME(InnerKw) },
            { ALT: () => this.CONSUME(LeftKw) },
            // Identifiers
            { ALT: () => this.CONSUME(QuotedIdentifier) },
            { ALT: () => this.CONSUME(Identifier) },
            // Literals
            { ALT: () => this.CONSUME(NumericLiteral) },
            { ALT: () => this.CONSUME(StringLiteral) },
            // Punctuation
            { ALT: () => this.CONSUME(LParen) },
            { ALT: () => this.CONSUME(RParen) },
            { ALT: () => this.CONSUME(Comma) },
            { ALT: () => this.CONSUME(Dot) },
            { ALT: () => this.CONSUME(Plus) },
            { ALT: () => this.CONSUME(Minus) },
            { ALT: () => this.CONSUME(Star) },
            { ALT: () => this.CONSUME(Slash) },
            { ALT: () => this.CONSUME(NotEq) },
            { ALT: () => this.CONSUME(LtEq) },
            { ALT: () => this.CONSUME(GtEq) },
            { ALT: () => this.CONSUME(Eq) },
            { ALT: () => this.CONSUME(Lt) },
            { ALT: () => this.CONSUME(Gt) }
        ]);
    });

    // -----------------------------------------------------------------------
    // identifier: unquoted or double-quoted identifier.
    // -----------------------------------------------------------------------

    public identifier = this.RULE('identifier', () => {
        this.OR([{ ALT: () => this.CONSUME(Identifier) }, { ALT: () => this.CONSUME(QuotedIdentifier) }]);
    });
}

// ---------------------------------------------------------------------------
// Singleton parser instance — instantiated once at module load time per
// Chevrotain best practices (NFR-3).
// ---------------------------------------------------------------------------

export const hdbSequenceParser = new HdbSequenceParser();
