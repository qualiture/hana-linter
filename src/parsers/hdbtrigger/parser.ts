import { CstParser } from 'chevrotain';
import {
    allTokens,
    AfterKw,
    AsKw,
    BeforeKw,
    BeginKw,
    Comma,
    CreateKw,
    DeleteKw,
    Dot,
    EachKw,
    EndKw,
    ForKw,
    Identifier,
    InsertKw,
    InsteadKw,
    LParen,
    NewKw,
    NumericLiteral,
    OfKw,
    OldKw,
    OnKw,
    QuotedIdentifier,
    ReferencingKw,
    RowKw,
    RParen,
    Semicolon,
    StatementKw,
    StringLiteral,
    TableKw,
    TriggerKw,
    UpdateKw,
    WhenKw
} from './lexer';

/**
 * Chevrotain CstParser for HANA `.hdbtrigger` DDL files.
 *
 * Grammar covers:
 *  - [CREATE] TRIGGER <triggerName> <triggerTiming> <triggerEvent>
 *    ON <tableName>
 *    [REFERENCING <referencingItem>+]
 *    [FOR EACH ROW | FOR EACH STATEMENT]
 *    [WHEN ( <predicate> )]
 *    BEGIN <body> END
 *    [;]
 *
 *  - triggerName: [schema "."] name (quoted or unquoted)
 *  - triggerTiming: BEFORE | AFTER | INSTEAD OF
 *  - triggerEvent: INSERT | DELETE | UPDATE [OF <columnList>]
 *  - referencingItem: (OLD|NEW) (ROW|TABLE) AS <alias>
 *  - forEachClause: FOR EACH (ROW | STATEMENT)
 *  - whenClause: WHEN ( <predicate> )  — predicate consumed via parenGroup
 *  - triggerBody: BEGIN <content> END — content consumed opaquely via
 *    recursive nestedBlock and anyBodyToken rules; nothing inside extracted.
 *
 * Only the `triggerName` node is surfaced by the visitor.  All other sub-trees
 * are parsed but blocked from extraction by no-op visitor overrides.
 *
 * Error recovery is enabled by default in CstParser.
 */
export class HdbTriggerParser extends CstParser {
    constructor() {
        super(allTokens);
        this.performSelfAnalysis();
    }

    // -----------------------------------------------------------------------
    // Top-level rule:
    //   [CREATE] TRIGGER <triggerName> <timing> <event> ON <tableName>
    //   [REFERENCING ...] [FOR EACH ...] [WHEN (...)] BEGIN...END [;]
    //
    // TriggerKw is the mandatory anchor.  All clauses after the tableName are
    // optional (OPTION2–5). Each has a distinct LA(1) token (ReferencingKw,
    // ForKw, WhenKw, BeginKw) so there is no lookahead ambiguity.
    // -----------------------------------------------------------------------

    public triggerStatement = this.RULE('triggerStatement', () => {
        this.OPTION(() => this.CONSUME(CreateKw));
        this.CONSUME(TriggerKw);
        this.SUBRULE(this.triggerName);
        this.SUBRULE(this.triggerTiming);
        this.SUBRULE(this.triggerEvent);
        this.CONSUME(OnKw);
        this.SUBRULE(this.tableName);
        this.OPTION2(() => this.SUBRULE(this.referencingClause));
        this.OPTION3(() => this.SUBRULE(this.forEachClause));
        this.OPTION4(() => this.SUBRULE(this.whenClause));
        this.SUBRULE(this.triggerBody);
        this.OPTION5(() => this.CONSUME(Semicolon));
    });

    // -----------------------------------------------------------------------
    // triggerName: [schema "."] name
    //
    // Both quoted and unquoted forms are supported.
    // The schema qualifier (if present) is consumed structurally but NOT
    // included in the extracted subject name — the visitor always takes the
    // LAST identifier child (the local name).
    // -----------------------------------------------------------------------

    public triggerName = this.RULE('triggerName', () => {
        this.SUBRULE(this.identifier);
        this.OPTION(() => {
            this.CONSUME(Dot);
            this.SUBRULE2(this.identifier);
        });
    });

    // -----------------------------------------------------------------------
    // triggerTiming: BEFORE | AFTER | INSTEAD OF
    //
    // INSTEAD OF is a two-token sequence.  Chevrotain resolves the outer OR
    // on LA(1): BeforeKw | AfterKw | InsteadKw.  No BACKTRACK needed.
    // -----------------------------------------------------------------------

    public triggerTiming = this.RULE('triggerTiming', () => {
        this.OR([
            { ALT: () => this.CONSUME(BeforeKw) },
            { ALT: () => this.CONSUME(AfterKw) },
            {
                ALT: () => {
                    this.CONSUME(InsteadKw);
                    this.CONSUME(OfKw);
                }
            }
        ]);
    });

    // -----------------------------------------------------------------------
    // triggerEvent: INSERT | DELETE | UPDATE [OF <columnList>]
    //
    // The UPDATE alternative uses OPTION to consume the optional OF clause.
    // OfKw here is unambiguous — it only appears after UpdateKw in this rule
    // (and after InsteadKw in triggerTiming, which is already consumed).
    // -----------------------------------------------------------------------

    public triggerEvent = this.RULE('triggerEvent', () => {
        this.OR([
            { ALT: () => this.CONSUME(InsertKw) },
            { ALT: () => this.CONSUME(DeleteKw) },
            {
                ALT: () => {
                    this.CONSUME(UpdateKw);
                    this.OPTION(() => {
                        this.CONSUME(OfKw);
                        this.SUBRULE(this.updateColumnList);
                    });
                }
            }
        ]);
    });

    // -----------------------------------------------------------------------
    // updateColumnList: <identifier> ("," <identifier>)*
    //
    // Consumed without extraction.  Visitor overrides this rule as a no-op.
    // -----------------------------------------------------------------------

    public updateColumnList = this.RULE('updateColumnList', () => {
        this.SUBRULE(this.identifier);
        this.MANY(() => {
            this.CONSUME(Comma);
            this.SUBRULE2(this.identifier);
        });
    });

    // -----------------------------------------------------------------------
    // tableName: [schema "."] name
    //
    // Same structure as triggerName; consumed entirely without extraction.
    // -----------------------------------------------------------------------

    public tableName = this.RULE('tableName', () => {
        this.SUBRULE(this.identifier);
        this.OPTION(() => {
            this.CONSUME(Dot);
            this.SUBRULE2(this.identifier);
        });
    });

    // -----------------------------------------------------------------------
    // referencingClause: REFERENCING <referencingItem>+
    //
    // AT_LEAST_ONE requires at least one binding (HANA DDL requires at least
    // one correlation name when the REFERENCING clause is present).
    // -----------------------------------------------------------------------

    public referencingClause = this.RULE('referencingClause', () => {
        this.CONSUME(ReferencingKw);
        this.AT_LEAST_ONE(() => this.SUBRULE(this.referencingItem));
    });

    // -----------------------------------------------------------------------
    // referencingItem: (OLD | NEW) (ROW | TABLE) AS <alias>
    //
    // The alias identifier is consumed but never extracted.
    // Visitor overrides this rule as a no-op to prevent auto-traversal.
    // -----------------------------------------------------------------------

    public referencingItem = this.RULE('referencingItem', () => {
        this.OR([{ ALT: () => this.CONSUME(OldKw) }, { ALT: () => this.CONSUME(NewKw) }]);
        this.OR2([{ ALT: () => this.CONSUME(RowKw) }, { ALT: () => this.CONSUME(TableKw) }]);
        this.CONSUME(AsKw);
        this.SUBRULE(this.identifier);
    });

    // -----------------------------------------------------------------------
    // forEachClause: FOR EACH (ROW | STATEMENT)
    //
    // Consumed without extraction.
    // -----------------------------------------------------------------------

    public forEachClause = this.RULE('forEachClause', () => {
        this.CONSUME(ForKw);
        this.CONSUME(EachKw);
        this.OR([{ ALT: () => this.CONSUME(RowKw) }, { ALT: () => this.CONSUME(StatementKw) }]);
    });

    // -----------------------------------------------------------------------
    // whenClause: WHEN <parenGroup>
    //
    // The WHEN predicate is consumed as a balanced parenthesised expression
    // by reusing the parenGroup rule.  The parenGroup handles nested parens
    // (e.g. function calls like f(g(x))).  No extraction is performed.
    // -----------------------------------------------------------------------

    public whenClause = this.RULE('whenClause', () => {
        this.CONSUME(WhenKw);
        this.SUBRULE(this.parenGroup);
    });

    // -----------------------------------------------------------------------
    // triggerBody: BEGIN <content> END
    //
    // The body is consumed opaquely — nothing inside is extracted.
    // nestedBlock handles arbitrary nesting of BEGIN/END from SQLScript
    // control-flow statements (IF/END IF, FOR/END FOR, WHILE/END WHILE,
    // CASE/END CASE, etc.).
    //
    // Note: SQLScript uses "END IF", "END FOR", etc. where "END" terminates
    // the block. Our grammar treats ANY EndKw as a block closer. This means
    // "END IF" is parsed as the closing END of a nestedBlock (or of the outer
    // body). For name-extraction purposes this is irrelevant — the trigger
    // name is captured before the body is ever entered.
    // -----------------------------------------------------------------------

    public triggerBody = this.RULE('triggerBody', () => {
        this.CONSUME(BeginKw);
        this.SUBRULE(this.triggerBodyContent);
        this.CONSUME(EndKw);
    });

    // -----------------------------------------------------------------------
    // triggerBodyContent — absorbs all tokens inside the body.
    //
    // The MANY GATE stops when the next token is EndKw or RParen.
    // -----------------------------------------------------------------------

    public triggerBodyContent = this.RULE('triggerBodyContent', () => {
        this.MANY({
            GATE: () => {
                const next = this.LA(1).tokenType;
                return next !== EndKw && next !== RParen;
            },
            DEF: () => {
                this.OR([
                    { ALT: () => this.SUBRULE(this.nestedBlock) },
                    { ALT: () => this.SUBRULE(this.parenGroup) },
                    { ALT: () => this.SUBRULE(this.anyBodyToken) }
                ]);
            }
        });
    });

    // -----------------------------------------------------------------------
    // nestedBlock — handles BEGIN … END pairs nested inside the body.
    //
    // FIRST(nestedBlock) = { BeginKw } — distinct from anyBodyToken (which
    // excludes BeginKw) so the OR in triggerBodyContent is unambiguous.
    // -----------------------------------------------------------------------

    public nestedBlock = this.RULE('nestedBlock', () => {
        this.CONSUME(BeginKw);
        this.SUBRULE(this.triggerBodyContent);
        this.CONSUME(EndKw);
    });

    // -----------------------------------------------------------------------
    // parenGroup — balanced parentheses of arbitrary depth.
    //
    // Used for WHEN clause predicates (via whenClause) and for function-call
    // argument lists inside the body. LParen/RParen are excluded from
    // anyBodyToken so the MANY loop in triggerBodyContent correctly delegates
    // to this rule.
    // -----------------------------------------------------------------------

    public parenGroup = this.RULE('parenGroup', () => {
        this.CONSUME(LParen);
        this.MANY(() => {
            this.OR([{ ALT: () => this.SUBRULE(this.parenGroup) }, { ALT: () => this.SUBRULE(this.anyBodyToken) }]);
        });
        this.CONSUME(RParen);
    });

    // -----------------------------------------------------------------------
    // anyBodyToken — matches any single token except BeginKw, EndKw,
    //               LParen, and RParen.
    //
    // Explicitly enumerating every token ensures the MANY GATE loops in
    // triggerBodyContent and parenGroup can stop reliably on EndKw and RParen
    // (which are not in anyBodyToken's FIRST set).
    // -----------------------------------------------------------------------

    public anyBodyToken = this.RULE('anyBodyToken', () => {
        this.OR([
            { ALT: () => this.CONSUME(StringLiteral) },
            { ALT: () => this.CONSUME(NumericLiteral) },
            { ALT: () => this.CONSUME(Identifier) },
            { ALT: () => this.CONSUME(QuotedIdentifier) },
            { ALT: () => this.CONSUME(Comma) },
            { ALT: () => this.CONSUME(Semicolon) },
            { ALT: () => this.CONSUME(Dot) },
            { ALT: () => this.CONSUME(CreateKw) },
            { ALT: () => this.CONSUME(TriggerKw) },
            { ALT: () => this.CONSUME(BeforeKw) },
            { ALT: () => this.CONSUME(AfterKw) },
            { ALT: () => this.CONSUME(InsteadKw) },
            { ALT: () => this.CONSUME(OfKw) },
            { ALT: () => this.CONSUME(InsertKw) },
            { ALT: () => this.CONSUME(UpdateKw) },
            { ALT: () => this.CONSUME(DeleteKw) },
            { ALT: () => this.CONSUME(OnKw) },
            { ALT: () => this.CONSUME(ReferencingKw) },
            { ALT: () => this.CONSUME(OldKw) },
            { ALT: () => this.CONSUME(NewKw) },
            { ALT: () => this.CONSUME(RowKw) },
            { ALT: () => this.CONSUME(TableKw) },
            { ALT: () => this.CONSUME(AsKw) },
            { ALT: () => this.CONSUME(ForKw) },
            { ALT: () => this.CONSUME(EachKw) },
            { ALT: () => this.CONSUME(StatementKw) },
            { ALT: () => this.CONSUME(WhenKw) }
        ]);
    });

    // -----------------------------------------------------------------------
    // identifier — unquoted or double-quoted
    // -----------------------------------------------------------------------

    public identifier = this.RULE('identifier', () => {
        this.OR([{ ALT: () => this.CONSUME(Identifier) }, { ALT: () => this.CONSUME(QuotedIdentifier) }]);
    });
}

/**
 * Singleton parser instance — instantiated once at module load time per
 * Chevrotain best practices (NFR-3).
 */
export const hdbTriggerParser = new HdbTriggerParser();
