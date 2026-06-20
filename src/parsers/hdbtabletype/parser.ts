import { CstParser } from 'chevrotain';
import {
    allTokens,
    Alphanum,
    As,
    Bigint,
    Binary,
    Blob,
    Boolean,
    Clob,
    Comma,
    Date,
    Decimal,
    Dot,
    Double,
    Float,
    Identifier,
    Integer,
    IntegerLiteral,
    LParen,
    NClob,
    NVarchar,
    QuotedIdentifier,
    Real,
    RParen,
    Seconddate,
    Semicolon,
    Shorttext,
    Smallint,
    TableKw,
    Time,
    Timestamp,
    Tinyint,
    TypeKw,
    Varbinary,
    VarChar
} from './lexer';

/**
 * Chevrotain CstParser for HANA `.hdbtabletype` DDL files.
 *
 * Grammar covers:
 *  - TYPE <typeName> AS TABLE ( <columnList> ) [;]
 *  - typeName: [schema "."] name  (quoted or unquoted)
 *  - columnList: zero or more columnDefinition entries separated by commas
 *  - columnDefinition: identifier dataType
 *  - dataType: dataTypeKeyword [(precision [, scale])]
 *
 * No constraint clauses, index definitions, partition clauses, or table
 * options exist for .hdbtabletype — the grammar is intentionally minimal.
 *
 * Only `columnDefinition` nodes are surfaced by the visitor; the typeName
 * sub-tree is parsed but blocked from extraction by a no-op visitor override.
 *
 * Error recovery is enabled by default in CstParser.
 */
export class HdbTableTypeParser extends CstParser {
    constructor() {
        super(allTokens);
        this.performSelfAnalysis();
    }

    // -----------------------------------------------------------------------
    // Top-level rule: TYPE <typeName> AS TABLE ( <columnList> ) [;]
    // -----------------------------------------------------------------------

    public createTableTypeStatement = this.RULE('createTableTypeStatement', () => {
        this.CONSUME(TypeKw);
        this.SUBRULE(this.typeName);
        this.CONSUME(As);
        this.CONSUME(TableKw);
        this.CONSUME(LParen);
        this.SUBRULE(this.columnList);
        this.CONSUME(RParen);
        this.OPTION(() => this.CONSUME(Semicolon));
    });

    // -----------------------------------------------------------------------
    // Type name: [schema "."] name
    // Both quoted ("MY_SCHEMA"."MY_TYPE") and unquoted (MY_TYPE) are handled.
    // -----------------------------------------------------------------------

    public typeName = this.RULE('typeName', () => {
        this.SUBRULE(this.identifier);
        this.OPTION(() => {
            this.CONSUME(Dot);
            this.SUBRULE2(this.identifier);
        });
    });

    // -----------------------------------------------------------------------
    // Column list: zero or more columnDefinition entries, comma-separated.
    // Optional rather than AT_LEAST_ONE so an empty list () does not fail.
    // -----------------------------------------------------------------------

    public columnList = this.RULE('columnList', () => {
        this.OPTION(() => {
            this.SUBRULE(this.columnDefinition);
            this.MANY(() => {
                this.CONSUME(Comma);
                this.SUBRULE2(this.columnDefinition);
            });
        });
    });

    // -----------------------------------------------------------------------
    // Column definition: <identifier> <dataType>
    // The identifier is the column name (extracted by the visitor).
    // -----------------------------------------------------------------------

    public columnDefinition = this.RULE('columnDefinition', () => {
        this.SUBRULE(this.identifier);
        this.SUBRULE(this.dataType);
    });

    // -----------------------------------------------------------------------
    // Data type: keyword [(precision [, scale])]
    // e.g. NVARCHAR(100), DECIMAL(15, 2), INTEGER
    // Precision and scale are consumed but never extracted.
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

    // -----------------------------------------------------------------------
    // Data type keyword — any recognised HANA data type token.
    // Using OR with explicit alternatives makes the grammar self-documenting
    // and ensures Chevrotain can validate token coverage at construction time.
    // -----------------------------------------------------------------------

    public dataTypeKeyword = this.RULE('dataTypeKeyword', () => {
        this.OR([
            { ALT: () => this.CONSUME(NVarchar) },
            { ALT: () => this.CONSUME(Varbinary) },
            { ALT: () => this.CONSUME(VarChar) },
            { ALT: () => this.CONSUME(Alphanum) },
            { ALT: () => this.CONSUME(Shorttext) },
            { ALT: () => this.CONSUME(Integer) },
            { ALT: () => this.CONSUME(Bigint) },
            { ALT: () => this.CONSUME(Smallint) },
            { ALT: () => this.CONSUME(Tinyint) },
            { ALT: () => this.CONSUME(Decimal) },
            { ALT: () => this.CONSUME(Double) },
            { ALT: () => this.CONSUME(Float) },
            { ALT: () => this.CONSUME(Real) },
            { ALT: () => this.CONSUME(Boolean) },
            { ALT: () => this.CONSUME(Date) },
            { ALT: () => this.CONSUME(Timestamp) },
            { ALT: () => this.CONSUME(Seconddate) },
            { ALT: () => this.CONSUME(Time) },
            { ALT: () => this.CONSUME(NClob) },
            { ALT: () => this.CONSUME(Clob) },
            { ALT: () => this.CONSUME(Blob) },
            { ALT: () => this.CONSUME(Binary) },
            // Fallback: any unrecognised identifier-shaped token is accepted as
            // a data type keyword to avoid hard failures on HANA types not in
            // the catalogue (e.g. ST_POINT, ST_GEOMETRY, vendor extensions).
            { ALT: () => this.CONSUME(Identifier) }
        ]);
    });

    // -----------------------------------------------------------------------
    // Identifier: unquoted or double-quoted
    // -----------------------------------------------------------------------

    public identifier = this.RULE('identifier', () => {
        this.OR([{ ALT: () => this.CONSUME(Identifier) }, { ALT: () => this.CONSUME(QuotedIdentifier) }]);
    });
}

// ---------------------------------------------------------------------------
// Singleton parser instance — instantiated once at module load per Chevrotain
// best practices.  Callers set hdbTableTypeParser.input before each parse run.
// ---------------------------------------------------------------------------

export const hdbTableTypeParser = new HdbTableTypeParser();
