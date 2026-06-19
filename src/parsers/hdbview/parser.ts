import { CstParser, type TokenType } from 'chevrotain';
import {
    All,
    allTokens,
    And,
    As,
    Asc,
    Between,
    By,
    Case,
    Check,
    Comma,
    Concat,
    Create,
    Cross,
    Desc,
    Distinct,
    Dot,
    Else,
    End,
    Equals,
    Except,
    Exists,
    From,
    Full,
    GreaterEqual,
    GreaterThan,
    Group,
    Having,
    Identifier,
    In,
    Inner,
    Intersect,
    IntegerLiteral,
    Is,
    Join,
    Left,
    LessEqual,
    LessThan,
    Like,
    Limit,
    LParen,
    Minus,
    Not,
    NotEqual,
    Null,
    On,
    Only,
    Option,
    Or,
    Order,
    Outer,
    Plus,
    QuotedIdentifier,
    Read,
    Right,
    RParen,
    Semicolon,
    Select,
    Slash,
    Star,
    StringLiteral,
    Then,
    Top,
    Union,
    ViewKw,
    When,
    Where,
    With
} from './lexer';

/**
 * Chevrotain CstParser for HANA `.hdbview` DDL files.
 *
 * Grammar covers:
 *  - [CREATE] VIEW <name> [(<columnList>)] AS SELECT <selectList> FROM <fromClause> ...
 *  - Explicit column list: identifiers declared before AS
 *  - SELECT aliases: AS <alias> expressions in the top-level SELECT list
 *  - Subqueries in FROM clause: parsed but visitor blocks recursion into them
 *  - JOIN clauses, WHERE, GROUP BY, HAVING, ORDER BY: consumed but not extracted
 *  - WITH READ ONLY / WITH CHECK OPTION: consumed but not extracted
 *  - UNION / INTERSECT / EXCEPT: visitor blocks extraction from secondary SELECT
 *
 * Only `selectItem` aliases (or `explicitColumnList` identifiers) are surfaced
 * by the visitor; all other content is consumed for correctness, not extracted.
 *
 * Error recovery is enabled by default in CstParser.
 */
export class HdbViewParser extends CstParser {
    // -----------------------------------------------------------------------
    // Top-level rule
    // -----------------------------------------------------------------------

    public createViewStatement = this.RULE('createViewStatement', () => {
        this.OPTION(() => this.CONSUME(Create));
        this.CONSUME(ViewKw);
        this.SUBRULE(this.viewName);
        this.OPTION2(() => this.SUBRULE(this.explicitColumnList));
        this.CONSUME(As);
        this.SUBRULE(this.selectStatement);
        this.OPTION3(() => this.SUBRULE(this.viewOptions));
        this.OPTION4(() => this.CONSUME(Semicolon));
    });

    // -----------------------------------------------------------------------
    // View name: [schema "."] name
    // -----------------------------------------------------------------------

    public viewName = this.RULE('viewName', () => {
        this.SUBRULE(this.identifier);
        this.OPTION(() => {
            this.CONSUME(Dot);
            this.SUBRULE2(this.identifier);
        });
    });

    // -----------------------------------------------------------------------
    // Explicit column list: "(" identifier, ... ")"
    // Only present when the view header declares column names before AS.
    // -----------------------------------------------------------------------

    public explicitColumnList = this.RULE('explicitColumnList', () => {
        this.CONSUME(LParen);
        this.AT_LEAST_ONE_SEP({
            SEP: Comma,
            DEF: () => this.SUBRULE(this.identifier)
        });
        this.CONSUME(RParen);
    });

    // -----------------------------------------------------------------------
    // SELECT statement
    // -----------------------------------------------------------------------

    public selectStatement = this.RULE('selectStatement', () => {
        this.CONSUME(Select);
        this.OPTION(() => {
            this.OR([
                { ALT: () => this.CONSUME(Distinct) },
                { ALT: () => this.CONSUME(All) },
                {
                    ALT: () => {
                        this.CONSUME(Top);
                        this.CONSUME(IntegerLiteral);
                    }
                }
            ]);
        });
        this.SUBRULE(this.selectList);
        this.SUBRULE(this.fromClause);
        this.OPTION2(() => this.SUBRULE(this.whereClause));
        this.OPTION3(() => this.SUBRULE(this.groupByClause));
        this.OPTION4(() => this.SUBRULE(this.havingClause));
        this.OPTION5(() => this.SUBRULE(this.orderByClause));
        this.OPTION6(() => this.SUBRULE(this.unionClause));
    });

    // -----------------------------------------------------------------------
    // SELECT list: one or more selectItems separated by commas.
    //
    // Note: SELECT * is handled naturally — selectExpression consumes the Star
    // token via anyToken, and no AS alias is present, so the visitor skips it.
    // A separate Star-only alternative would be ambiguous with selectItem (Star
    // also appears in anyToken's FIRST set).
    // -----------------------------------------------------------------------

    public selectList = this.RULE('selectList', () => {
        this.AT_LEAST_ONE_SEP({
            SEP: Comma,
            DEF: () => this.SUBRULE(this.selectItem)
        });
    });

    // -----------------------------------------------------------------------
    // Select item: <expression> [AS <identifier>]
    //
    // The visitor extracts the identifier from the optional AS alias.
    // Items without an AS alias are silently skipped (per AC-9).
    // -----------------------------------------------------------------------

    public selectItem = this.RULE('selectItem', () => {
        this.SUBRULE(this.selectExpression);
        this.OPTION(() => {
            this.CONSUME(As);
            this.SUBRULE(this.identifier);
        });
    });

    // -----------------------------------------------------------------------
    // selectExpression — greedy token consumer for the expression part of a
    // select item. Stops (via GATE) when the next token is a select-item
    // terminator at the current (depth-0) level. Nested parentheses are
    // consumed opaquely via parenGroup so inner AS/commas never trigger a
    // false stop (e.g. CAST(x AS INTEGER), COUNT(*), CASE...END).
    // -----------------------------------------------------------------------

    public selectExpression = this.RULE('selectExpression', () => {
        this.MANY({
            GATE: () => !this.isSelectItemTerminator(this.LA(1).tokenType),
            DEF: () => {
                this.OR([{ ALT: () => this.SUBRULE(this.parenGroup) }, { ALT: () => this.SUBRULE(this.anyToken) }]);
            }
        });
    });

    // -----------------------------------------------------------------------
    // FROM clause: FROM <fromItem> [<join> ...]
    // -----------------------------------------------------------------------

    public fromClause = this.RULE('fromClause', () => {
        this.CONSUME(From);
        this.SUBRULE(this.fromItem);
        this.MANY(() => this.SUBRULE(this.joinClause));
    });

    // -----------------------------------------------------------------------
    // fromItem: subquery alias | viewName [alias]
    //
    // FIRST(subquery) = { LParen }
    // FIRST(viewName) = { Identifier, QuotedIdentifier }
    // Sets are disjoint — LL(1) lookahead is sufficient.
    // -----------------------------------------------------------------------

    public fromItem = this.RULE('fromItem', () => {
        this.OR([
            {
                ALT: () => {
                    this.SUBRULE(this.subquery);
                    this.OPTION(() => this.SUBRULE(this.alias));
                }
            },
            {
                ALT: () => {
                    this.SUBRULE(this.viewName);
                    this.OPTION2(() => this.SUBRULE2(this.alias));
                }
            }
        ]);
    });

    // -----------------------------------------------------------------------
    // subquery — a parenthesised SELECT statement.
    // The visitor overrides this rule with a no-op to prevent extraction of
    // aliases from derived-table subqueries.
    // -----------------------------------------------------------------------

    public subquery = this.RULE('subquery', () => {
        this.CONSUME(LParen);
        this.SUBRULE(this.selectStatement);
        this.CONSUME(RParen);
    });

    // -----------------------------------------------------------------------
    // alias — AS? identifier (table / subquery alias in FROM clause)
    // -----------------------------------------------------------------------

    public alias = this.RULE('alias', () => {
        this.OPTION(() => this.CONSUME(As));
        this.SUBRULE(this.identifier);
    });

    // -----------------------------------------------------------------------
    // JOIN clause: [join-type] JOIN <fromItem> ON <expression>
    //
    // The join-type keywords (LEFT, RIGHT, FULL OUTER, INNER, CROSS) may be
    // consumed by the preceding ON expression (see §9 performance notes).
    // We parse them here opportunistically: if the current token IS a join-type
    // keyword AND the next is JOIN, consume it; otherwise skip.
    // -----------------------------------------------------------------------

    public joinClause = this.RULE('joinClause', () => {
        this.OPTION(() => {
            this.OR([
                { ALT: () => this.CONSUME(Inner) },
                {
                    ALT: () => {
                        this.CONSUME(Left);
                        this.OPTION2(() => this.CONSUME(Outer));
                    }
                },
                {
                    ALT: () => {
                        this.CONSUME(Right);
                        this.OPTION3(() => this.CONSUME2(Outer));
                    }
                },
                {
                    ALT: () => {
                        this.CONSUME(Full);
                        this.OPTION4(() => this.CONSUME3(Outer));
                    }
                },
                { ALT: () => this.CONSUME(Cross) }
            ]);
        });
        this.CONSUME(Join);
        this.SUBRULE(this.fromItem);
        this.CONSUME(On);
        this.SUBRULE(this.expression);
    });

    // -----------------------------------------------------------------------
    // expression — loose consumer for WHERE, ON, HAVING, GROUP BY, ORDER BY.
    // Uses the same GATE+parenGroup strategy as selectExpression; stops at
    // clause-boundary tokens so the parser can move to the next clause.
    // JOIN keyword is also a stop-token: join-type prefix keywords (LEFT etc.)
    // may be absorbed into the expression, but JOIN itself always terminates.
    // -----------------------------------------------------------------------

    public expression = this.RULE('expression', () => {
        this.MANY({
            GATE: () => !this.isExpressionTerminator(this.LA(1).tokenType),
            DEF: () => {
                this.OR([{ ALT: () => this.SUBRULE(this.parenGroup) }, { ALT: () => this.SUBRULE(this.anyToken) }]);
            }
        });
    });

    // -----------------------------------------------------------------------
    // WHERE, GROUP BY, HAVING, ORDER BY, UNION/INTERSECT/EXCEPT
    // -----------------------------------------------------------------------

    public whereClause = this.RULE('whereClause', () => {
        this.CONSUME(Where);
        this.SUBRULE(this.expression);
    });

    public groupByClause = this.RULE('groupByClause', () => {
        this.CONSUME(Group);
        this.CONSUME(By);
        this.AT_LEAST_ONE_SEP({
            SEP: Comma,
            DEF: () => this.SUBRULE(this.expression)
        });
    });

    public havingClause = this.RULE('havingClause', () => {
        this.CONSUME(Having);
        this.SUBRULE(this.expression);
    });

    public orderByClause = this.RULE('orderByClause', () => {
        this.CONSUME(Order);
        this.CONSUME(By);
        this.AT_LEAST_ONE_SEP({
            SEP: Comma,
            DEF: () => this.SUBRULE(this.expression)
        });
    });

    public unionClause = this.RULE('unionClause', () => {
        this.OR([
            {
                ALT: () => {
                    this.CONSUME(Union);
                    this.OPTION(() => this.CONSUME(All));
                }
            },
            { ALT: () => this.CONSUME(Intersect) },
            { ALT: () => this.CONSUME(Except) }
        ]);
        this.SUBRULE(this.selectStatement);
    });

    // -----------------------------------------------------------------------
    // WITH READ ONLY | WITH CHECK OPTION
    // -----------------------------------------------------------------------

    public viewOptions = this.RULE('viewOptions', () => {
        this.CONSUME(With);
        this.OR([
            {
                ALT: () => {
                    this.CONSUME(Read);
                    this.CONSUME(Only);
                }
            },
            {
                ALT: () => {
                    this.CONSUME(Check);
                    this.CONSUME(Option);
                }
            }
        ]);
    });

    // -----------------------------------------------------------------------
    // identifier — unquoted or double-quoted
    // -----------------------------------------------------------------------

    public identifier = this.RULE('identifier', () => {
        this.OR([{ ALT: () => this.CONSUME(Identifier) }, { ALT: () => this.CONSUME(QuotedIdentifier) }]);
    });

    // -----------------------------------------------------------------------
    // parenGroup — balanced parentheses containing arbitrary content.
    // Used inside selectExpression and expression to absorb nested parens
    // (function calls, CASE sub-expressions, scalar subqueries, etc.)
    // without triggering the outer GATE's stop-token checks.
    //
    // MANY stops when next token is RParen (not in anyToken's FIRST set),
    // allowing the outer CONSUME(RParen) to match it.
    // -----------------------------------------------------------------------

    public parenGroup = this.RULE('parenGroup', () => {
        this.CONSUME(LParen);
        this.MANY(() => {
            this.OR([{ ALT: () => this.SUBRULE(this.parenGroup) }, { ALT: () => this.SUBRULE(this.anyToken) }]);
        });
        this.CONSUME(RParen);
    });

    // -----------------------------------------------------------------------
    // anyToken — matches any single token except LParen and RParen.
    //
    // Enumerating every token type allows MANY in parenGroup (and GATE loops
    // in selectExpression / expression) to correctly stop when it encounters
    // RParen, which is in neither parenGroup's FIRST set nor anyToken's set.
    // -----------------------------------------------------------------------

    public anyToken = this.RULE('anyToken', () => {
        this.OR([
            { ALT: () => this.CONSUME(StringLiteral) },
            { ALT: () => this.CONSUME(IntegerLiteral) },
            { ALT: () => this.CONSUME(Identifier) },
            { ALT: () => this.CONSUME(QuotedIdentifier) },
            { ALT: () => this.CONSUME(Comma) },
            { ALT: () => this.CONSUME(Semicolon) },
            { ALT: () => this.CONSUME(Dot) },
            { ALT: () => this.CONSUME(Star) },
            { ALT: () => this.CONSUME(Plus) },
            { ALT: () => this.CONSUME(Minus) },
            { ALT: () => this.CONSUME(Slash) },
            { ALT: () => this.CONSUME(Concat) },
            { ALT: () => this.CONSUME(NotEqual) },
            { ALT: () => this.CONSUME(LessEqual) },
            { ALT: () => this.CONSUME(GreaterEqual) },
            { ALT: () => this.CONSUME(LessThan) },
            { ALT: () => this.CONSUME(GreaterThan) },
            { ALT: () => this.CONSUME(Equals) },
            { ALT: () => this.CONSUME(Create) },
            { ALT: () => this.CONSUME(ViewKw) },
            { ALT: () => this.CONSUME(As) },
            { ALT: () => this.CONSUME(Select) },
            { ALT: () => this.CONSUME(Distinct) },
            { ALT: () => this.CONSUME(All) },
            { ALT: () => this.CONSUME(Top) },
            { ALT: () => this.CONSUME(From) },
            { ALT: () => this.CONSUME(Where) },
            { ALT: () => this.CONSUME(Group) },
            { ALT: () => this.CONSUME(By) },
            { ALT: () => this.CONSUME(Having) },
            { ALT: () => this.CONSUME(Intersect) },
            { ALT: () => this.CONSUME(Inner) },
            { ALT: () => this.CONSUME(In) },
            { ALT: () => this.CONSUME(Join) },
            { ALT: () => this.CONSUME(Left) },
            { ALT: () => this.CONSUME(Right) },
            { ALT: () => this.CONSUME(Full) },
            { ALT: () => this.CONSUME(Outer) },
            { ALT: () => this.CONSUME(Cross) },
            { ALT: () => this.CONSUME(Order) },
            { ALT: () => this.CONSUME(Or) },
            { ALT: () => this.CONSUME(Union) },
            { ALT: () => this.CONSUME(Except) },
            { ALT: () => this.CONSUME(Option) },
            { ALT: () => this.CONSUME(Only) },
            { ALT: () => this.CONSUME(On) },
            { ALT: () => this.CONSUME(With) },
            { ALT: () => this.CONSUME(Read) },
            { ALT: () => this.CONSUME(Check) },
            { ALT: () => this.CONSUME(Case) },
            { ALT: () => this.CONSUME(When) },
            { ALT: () => this.CONSUME(Then) },
            { ALT: () => this.CONSUME(Else) },
            { ALT: () => this.CONSUME(End) },
            { ALT: () => this.CONSUME(Not) },
            { ALT: () => this.CONSUME(Null) },
            { ALT: () => this.CONSUME(And) },
            { ALT: () => this.CONSUME(Is) },
            { ALT: () => this.CONSUME(Between) },
            { ALT: () => this.CONSUME(Like) },
            { ALT: () => this.CONSUME(Exists) },
            { ALT: () => this.CONSUME(Asc) },
            { ALT: () => this.CONSUME(Desc) },
            { ALT: () => this.CONSUME(Limit) }
        ]);
    });

    // -----------------------------------------------------------------------
    // GATE helpers
    // -----------------------------------------------------------------------

    /**
     * Returns true when the given token type should terminate a selectItem's
     * expression, causing the MANY in selectExpression to exit.
     *
     * Stops at: AS (alias separator), Comma (item separator), and all
     * clause-boundary keywords. Does NOT stop at join-type keywords (LEFT,
     * INNER, etc.) because those can appear in function calls in SELECT items
     * (e.g. LEFT(col, 3)). parenGroup absorbs any AS/commas inside (…).
     */
    private isSelectItemTerminator(tokenType: TokenType): boolean {
        return (
            tokenType === As ||
            tokenType === Comma ||
            tokenType === From ||
            tokenType === Where ||
            tokenType === Group ||
            tokenType === Having ||
            tokenType === Order ||
            tokenType === Union ||
            tokenType === Intersect ||
            tokenType === Except ||
            tokenType === Limit
        );
    }

    /**
     * Returns true when the given token type should terminate a loose
     * expression (used in WHERE, ON, HAVING, GROUP BY, ORDER BY).
     *
     * Stops at clause-boundary keywords and JOIN (which always signals the
     * start of a new join clause). Join-type prefix keywords (LEFT, INNER,
     * etc.) may be absorbed by the expression, but JOIN itself is preserved.
     */
    private isExpressionTerminator(tokenType: TokenType): boolean {
        return (
            tokenType === From ||
            tokenType === Where ||
            tokenType === Group ||
            tokenType === Having ||
            tokenType === Order ||
            tokenType === Union ||
            tokenType === Intersect ||
            tokenType === Except ||
            tokenType === Limit ||
            tokenType === Semicolon ||
            tokenType === Join
        );
    }

    // -----------------------------------------------------------------------

    constructor() {
        super(allTokens);
        // performSelfAnalysis must be called after all RULE definitions.
        this.performSelfAnalysis();
    }
}

/**
 * Singleton parser instance — instantiated once at module load time per
 * Chevrotain best practices (NFR-3).
 */
export const hdbViewParser = new HdbViewParser();
