import { CstParser } from 'chevrotain';
import {
    allTokens,
    As,
    Action,
    AlphaNum,
    BigInt,
    BinText,
    Blob,
    Boolean,
    Cascade,
    Check,
    Clob,
    ColumnKw,
    Comma,
    Constraint,
    Create,
    Date,
    Decimal,
    Default,
    Double,
    Dot,
    Equals,
    Float,
    Foreign,
    Global,
    Identifier,
    Index,
    IntegerKw,
    IntegerLiteral,
    IntKw,
    Key,
    LParen,
    NClob,
    No,
    Not,
    Null,
    Numeric,
    NVarchar,
    Partition,
    Primary,
    QuotedIdentifier,
    Real,
    References,
    Restrict,
    Row,
    RParen,
    SecondDate,
    Semicolon,
    ShortText,
    SmallInt,
    StGeometry,
    StPoint,
    StringLiteral,
    TableKw,
    Temporary,
    Text,
    Time,
    Timestamp,
    TinyInt,
    Unique,
    VarBinary,
    VarChar,
    With
} from './lexer';

/**
 * Chevrotain CstParser for HANA `.hdbtable` DDL files.
 *
 * Grammar covers:
 *  - CREATE [GLOBAL TEMPORARY] [COLUMN | ROW] TABLE <name> ( <columns> ) [<options>]
 *  - Column definitions: identifier dataType columnConstraint*
 *  - Constraint definitions: PRIMARY KEY, UNIQUE, FOREIGN KEY, CHECK, CONSTRAINT …
 *  - Table options: WITH … (loosely consumed)
 *
 * Only `columnDefinition` nodes are extracted by the visitor; all constraint
 * and option content is parsed but not surfaced.
 *
 * Error recovery is enabled by default in CstParser.
 */
export class HdbTableParser extends CstParser {
    // -----------------------------------------------------------------------
    // Top-level rule
    // -----------------------------------------------------------------------

    public createTableStatement = this.RULE('createTableStatement', () => {
        this.SUBRULE(this.tableHeader);
        this.SUBRULE(this.tableName);
        this.SUBRULE(this.columnBody);
        this.OPTION(() => this.SUBRULE(this.tableOptions));
        this.OPTION2(() => this.CONSUME(Semicolon));
    });

    // -----------------------------------------------------------------------
    // CREATE [GLOBAL TEMPORARY] [COLUMN | ROW] TABLE
    // CREATE is optional because HANA HDI artifact files omit it.
    // -----------------------------------------------------------------------

    public tableHeader = this.RULE('tableHeader', () => {
        this.OPTION(() => this.CONSUME(Create));
        this.OPTION2(() => {
            this.CONSUME(Global);
            this.CONSUME(Temporary);
        });
        this.OPTION3(() => {
            this.OR([{ ALT: () => this.CONSUME(ColumnKw) }, { ALT: () => this.CONSUME(Row) }]);
        });
        this.CONSUME(TableKw);
    });

    // -----------------------------------------------------------------------
    // Table name: [schema "."] name
    // -----------------------------------------------------------------------

    public tableName = this.RULE('tableName', () => {
        this.SUBRULE(this.identifier);
        this.OPTION(() => {
            this.CONSUME(Dot);
            this.SUBRULE2(this.identifier);
        });
    });

    // -----------------------------------------------------------------------
    // Column list body: "(" columnOrConstraint, ... ")"
    // -----------------------------------------------------------------------

    public columnBody = this.RULE('columnBody', () => {
        this.CONSUME(LParen);
        this.SUBRULE(this.columnList);
        this.CONSUME(RParen);
    });

    public columnList = this.RULE('columnList', () => {
        this.AT_LEAST_ONE_SEP({
            SEP: Comma,
            DEF: () => this.SUBRULE(this.columnOrConstraint)
        });
    });

    // -----------------------------------------------------------------------
    // columnOrConstraint — the key disambiguation point.
    //
    // FIRST(columnDefinition) = { Identifier, QuotedIdentifier }
    // FIRST(inlineConstraint) = { Constraint, Primary, Unique, Foreign, Check }
    // Sets are disjoint → LL(1) lookahead is sufficient.
    // -----------------------------------------------------------------------

    public columnOrConstraint = this.RULE('columnOrConstraint', () => {
        this.OR([{ ALT: () => this.SUBRULE(this.columnDefinition) }, { ALT: () => this.SUBRULE(this.inlineConstraint) }]);
    });

    // -----------------------------------------------------------------------
    // Column definition: identifier dataType columnConstraint*
    // The visitor extracts the identifier (column name) from this node.
    // -----------------------------------------------------------------------

    public columnDefinition = this.RULE('columnDefinition', () => {
        this.SUBRULE(this.identifier);
        this.SUBRULE(this.dataType);
        this.MANY(() => this.SUBRULE(this.columnConstraint));
    });

    // -----------------------------------------------------------------------
    // Constraint definitions (parsed but not extracted)
    // -----------------------------------------------------------------------

    public inlineConstraint = this.RULE('inlineConstraint', () => {
        this.OPTION(() => {
            this.CONSUME(Constraint);
            this.OPTION2(() => this.SUBRULE(this.identifier));
        });
        this.OR([
            { ALT: () => this.SUBRULE2(this.primaryKeyConstraint) },
            { ALT: () => this.SUBRULE3(this.uniqueConstraint) },
            { ALT: () => this.SUBRULE4(this.foreignKeyConstraint) },
            { ALT: () => this.SUBRULE5(this.checkConstraint) }
        ]);
    });

    public primaryKeyConstraint = this.RULE('primaryKeyConstraint', () => {
        this.CONSUME(Primary);
        this.CONSUME(Key);
        this.SUBRULE(this.parenGroup);
    });

    public uniqueConstraint = this.RULE('uniqueConstraint', () => {
        this.CONSUME(Unique);
        this.OPTION(() => this.CONSUME(Index));
        this.OPTION2(() => this.SUBRULE(this.identifier));
        this.SUBRULE2(this.parenGroup);
    });

    public foreignKeyConstraint = this.RULE('foreignKeyConstraint', () => {
        this.CONSUME(Foreign);
        this.CONSUME(Key);
        this.SUBRULE(this.parenGroup); // FK column list
        this.CONSUME(References);
        this.SUBRULE(this.tableName);
        this.SUBRULE2(this.parenGroup); // referenced column list
        this.OPTION(() => this.SUBRULE(this.foreignKeyAction));
    });

    public foreignKeyAction = this.RULE('foreignKeyAction', () => {
        this.OR([
            {
                ALT: () => {
                    this.CONSUME(Cascade);
                }
            },
            {
                ALT: () => {
                    this.CONSUME(Restrict);
                }
            },
            {
                ALT: () => {
                    this.CONSUME(No);
                    this.CONSUME(Action);
                }
            }
        ]);
    });

    public checkConstraint = this.RULE('checkConstraint', () => {
        this.CONSUME(Check);
        this.SUBRULE(this.parenGroup);
    });

    // -----------------------------------------------------------------------
    // Column-level constraints (after data type in columnDefinition)
    // -----------------------------------------------------------------------

    public columnConstraint = this.RULE('columnConstraint', () => {
        this.OR([
            {
                ALT: () => {
                    this.CONSUME(Not);
                    this.CONSUME(Null);
                }
            },
            {
                ALT: () => {
                    this.CONSUME2(Null);
                }
            },
            {
                ALT: () => {
                    this.CONSUME(Default);
                    this.SUBRULE(this.columnDefault);
                }
            },
            {
                // Inline single-column PRIMARY KEY shorthand
                ALT: () => {
                    this.CONSUME(Primary);
                    this.CONSUME(Key);
                }
            }
        ]);
    });

    public columnDefault = this.RULE('columnDefault', () => {
        this.OR([
            { ALT: () => this.CONSUME(StringLiteral) },
            { ALT: () => this.CONSUME(IntegerLiteral) },
            { ALT: () => this.CONSUME(Null) },
            { ALT: () => this.SUBRULE(this.identifier) }
        ]);
    });

    // -----------------------------------------------------------------------
    // Data type: keyword ( precision [, scale] )?
    // -----------------------------------------------------------------------

    public dataType = this.RULE('dataType', () => {
        this.SUBRULE(this.dataTypeKeyword);
        this.OPTION(() => {
            this.CONSUME(LParen);
            this.CONSUME(IntegerLiteral);
            this.OPTION2(() => {
                this.CONSUME(Comma);
                this.CONSUME2(IntegerLiteral);
            });
            this.CONSUME(RParen);
        });
    });

    public dataTypeKeyword = this.RULE('dataTypeKeyword', () => {
        this.OR([
            { ALT: () => this.CONSUME(NVarchar) },
            { ALT: () => this.CONSUME(VarChar) },
            { ALT: () => this.CONSUME(AlphaNum) },
            { ALT: () => this.CONSUME(ShortText) },
            { ALT: () => this.CONSUME(BinText) },
            { ALT: () => this.CONSUME(Text) },
            { ALT: () => this.CONSUME(BigInt) },
            { ALT: () => this.CONSUME(SmallInt) },
            { ALT: () => this.CONSUME(TinyInt) },
            { ALT: () => this.CONSUME(IntegerKw) },
            { ALT: () => this.CONSUME(IntKw) },
            { ALT: () => this.CONSUME(Decimal) },
            { ALT: () => this.CONSUME(Numeric) },
            { ALT: () => this.CONSUME(Float) },
            { ALT: () => this.CONSUME(Double) },
            { ALT: () => this.CONSUME(Real) },
            { ALT: () => this.CONSUME(Boolean) },
            { ALT: () => this.CONSUME(SecondDate) },
            { ALT: () => this.CONSUME(Timestamp) },
            { ALT: () => this.CONSUME(Time) },
            { ALT: () => this.CONSUME(Date) },
            { ALT: () => this.CONSUME(NClob) },
            { ALT: () => this.CONSUME(Clob) },
            { ALT: () => this.CONSUME(Blob) },
            { ALT: () => this.CONSUME(VarBinary) },
            { ALT: () => this.CONSUME(StPoint) },
            { ALT: () => this.CONSUME(StGeometry) }
        ]);
    });

    // -----------------------------------------------------------------------
    // identifier — unquoted or double-quoted
    // -----------------------------------------------------------------------

    public identifier = this.RULE('identifier', () => {
        this.OR([{ ALT: () => this.CONSUME(Identifier) }, { ALT: () => this.CONSUME(QuotedIdentifier) }]);
    });

    // -----------------------------------------------------------------------
    // identifierList — comma-separated identifiers (used in constraint bodies)
    // -----------------------------------------------------------------------

    public identifierList = this.RULE('identifierList', () => {
        this.AT_LEAST_ONE_SEP({
            SEP: Comma,
            DEF: () => this.SUBRULE(this.identifier)
        });
    });

    // -----------------------------------------------------------------------
    // parenGroup — balanced parentheses containing arbitrary content.
    // Used to "skip over" constraint bodies and other structures we don't
    // need to extract.  MANY stops when the next token is RParen (it is not
    // in anyToken's FIRST set), allowing the outer RParen CONSUME to succeed.
    // -----------------------------------------------------------------------

    public parenGroup = this.RULE('parenGroup', () => {
        this.CONSUME(LParen);
        this.MANY(() => {
            this.OR([{ ALT: () => this.SUBRULE(this.parenGroup) }, { ALT: () => this.SUBRULE2(this.anyToken) }]);
        });
        this.CONSUME(RParen);
    });

    /**
     * Matches any single token that is not LParen, RParen, or EOF.
     * Enumerating every token type allows MANY in parenGroup to correctly stop
     * when it encounters RParen (which is in neither parenGroup's FIRST set
     * nor anyToken's alternatives).
     */
    public anyToken = this.RULE('anyToken', () => {
        this.OR([
            { ALT: () => this.CONSUME(StringLiteral) },
            { ALT: () => this.CONSUME(IntegerLiteral) },
            { ALT: () => this.CONSUME(Identifier) },
            { ALT: () => this.CONSUME(QuotedIdentifier) },
            { ALT: () => this.CONSUME(Comma) },
            { ALT: () => this.CONSUME(Semicolon) },
            { ALT: () => this.CONSUME(Dot) },
            { ALT: () => this.CONSUME(Equals) },
            { ALT: () => this.CONSUME(Create) },
            { ALT: () => this.CONSUME(TableKw) },
            { ALT: () => this.CONSUME(ColumnKw) },
            { ALT: () => this.CONSUME(Row) },
            { ALT: () => this.CONSUME(Global) },
            { ALT: () => this.CONSUME(Temporary) },
            { ALT: () => this.CONSUME(Constraint) },
            { ALT: () => this.CONSUME(Primary) },
            { ALT: () => this.CONSUME(Unique) },
            { ALT: () => this.CONSUME(Foreign) },
            { ALT: () => this.CONSUME(Key) },
            { ALT: () => this.CONSUME(References) },
            { ALT: () => this.CONSUME(Check) },
            { ALT: () => this.CONSUME(Index) },
            { ALT: () => this.CONSUME(Partition) },
            { ALT: () => this.CONSUME(With) },
            { ALT: () => this.CONSUME(Not) },
            { ALT: () => this.CONSUME(Null) },
            { ALT: () => this.CONSUME(Default) },
            { ALT: () => this.CONSUME(As) },
            { ALT: () => this.CONSUME(No) },
            { ALT: () => this.CONSUME(Action) },
            { ALT: () => this.CONSUME(Cascade) },
            { ALT: () => this.CONSUME(Restrict) },
            { ALT: () => this.CONSUME(NVarchar) },
            { ALT: () => this.CONSUME(VarChar) },
            { ALT: () => this.CONSUME(AlphaNum) },
            { ALT: () => this.CONSUME(ShortText) },
            { ALT: () => this.CONSUME(Text) },
            { ALT: () => this.CONSUME(BinText) },
            { ALT: () => this.CONSUME(BigInt) },
            { ALT: () => this.CONSUME(SmallInt) },
            { ALT: () => this.CONSUME(TinyInt) },
            { ALT: () => this.CONSUME(IntegerKw) },
            { ALT: () => this.CONSUME(IntKw) },
            { ALT: () => this.CONSUME(Decimal) },
            { ALT: () => this.CONSUME(Numeric) },
            { ALT: () => this.CONSUME(Float) },
            { ALT: () => this.CONSUME(Double) },
            { ALT: () => this.CONSUME(Real) },
            { ALT: () => this.CONSUME(Boolean) },
            { ALT: () => this.CONSUME(Date) },
            { ALT: () => this.CONSUME(Time) },
            { ALT: () => this.CONSUME(Timestamp) },
            { ALT: () => this.CONSUME(SecondDate) },
            { ALT: () => this.CONSUME(Clob) },
            { ALT: () => this.CONSUME(NClob) },
            { ALT: () => this.CONSUME(Blob) },
            { ALT: () => this.CONSUME(VarBinary) },
            { ALT: () => this.CONSUME(StPoint) },
            { ALT: () => this.CONSUME(StGeometry) }
        ]);
    });

    // -----------------------------------------------------------------------
    // tableOptions — loosely consume everything after WITH until EOF or ';'.
    // Not extracted; must not throw.
    // -----------------------------------------------------------------------

    public tableOptions = this.RULE('tableOptions', () => {
        this.CONSUME(With);
        this.MANY(() => {
            this.OR([{ ALT: () => this.SUBRULE(this.parenGroup) }, { ALT: () => this.SUBRULE2(this.anyToken) }]);
        });
    });

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
export const hdbTableParser = new HdbTableParser();
