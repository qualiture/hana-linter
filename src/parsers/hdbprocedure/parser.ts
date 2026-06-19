import { CstParser, type TokenType } from 'chevrotain';
import {
    allTokens,
    Alphanum,
    As,
    Begin,
    Bigint,
    Blob,
    Boolean,
    Clob,
    Comma,
    Create,
    Data,
    Date,
    Decimal,
    Default,
    Definer,
    Dot,
    Double,
    End,
    Encryption,
    Float,
    Identifier,
    In,
    Integer,
    IntegerLiteral,
    Inout,
    Invoker,
    Language,
    LParen,
    Modifies,
    NClob,
    NVarchar,
    Out,
    Procedure,
    QuotedIdentifier,
    Real,
    Reads,
    RParen,
    Schema,
    Seconddate,
    Security,
    Semicolon,
    Shorttext,
    Smallint,
    Sql,
    Sqlscript,
    StringLiteral,
    TableKw,
    Time,
    Timestamp,
    Tinyint,
    Varbinary,
    VarChar,
    With
} from './lexer';

/**
 * Chevrotain CstParser for HANA `.hdbprocedure` DDL files.
 *
 * Grammar covers:
 *  - [CREATE] PROCEDURE <name> ( <parameterList> ) [<procedureOptions>] AS BEGIN ... END
 *  - parameterList: zero or more IN/OUT/INOUT parameterDeclaration entries
 *  - parameterDeclaration: <mode> <name> <type>  where type is scalar or TABLE(...)
 *  - procedureOptions: LANGUAGE SQLSCRIPT, SQL SECURITY INVOKER/DEFINER,
 *    READS/MODIFIES SQL DATA, DEFAULT SCHEMA <id>, WITH ENCRYPTION
 *  - procedureBody: BEGIN <content> END — content consumed opaquely via
 *    recursive nestedBlock rules; nothing inside the body is extracted
 *
 * Only `parameterDeclaration` nodes are surfaced by the visitor.
 * The tableColumnDefinition and procedureBody subtrees are parsed but blocked
 * from extraction by no-op visitor overrides.
 *
 * Error recovery is enabled by default in CstParser.
 */
export class HdbProcedureParser extends CstParser {
    constructor() {
        super(allTokens);
        this.performSelfAnalysis();
    }

    // -----------------------------------------------------------------------
    // Top-level rule
    // -----------------------------------------------------------------------

    public createProcedureStatement = this.RULE('createProcedureStatement', () => {
        this.OPTION(() => this.CONSUME(Create));
        this.CONSUME(Procedure);
        this.SUBRULE(this.procedureName);
        this.CONSUME(LParen);
        this.SUBRULE(this.parameterList);
        this.CONSUME(RParen);
        this.MANY(() => this.SUBRULE(this.procedureOption));
        this.CONSUME(As);
        this.SUBRULE(this.procedureBody);
        this.OPTION2(() => this.CONSUME(Semicolon));
    });

    // -----------------------------------------------------------------------
    // Procedure name: [schema "."] name
    // -----------------------------------------------------------------------

    public procedureName = this.RULE('procedureName', () => {
        this.SUBRULE(this.identifier);
        this.OPTION(() => {
            this.CONSUME(Dot);
            this.SUBRULE2(this.identifier);
        });
    });

    // -----------------------------------------------------------------------
    // Parameter list — zero or more declarations separated by commas.
    // An empty parameter list () is valid.
    // -----------------------------------------------------------------------

    public parameterList = this.RULE('parameterList', () => {
        this.OPTION(() => {
            this.SUBRULE(this.parameterDeclaration);
            this.MANY(() => {
                this.CONSUME(Comma);
                this.SUBRULE2(this.parameterDeclaration);
            });
        });
    });

    // -----------------------------------------------------------------------
    // Parameter declaration: <mode> <name> <type>
    // The visitor reads the mode token to determine inputParameter /
    // outputParameter subject type.
    // -----------------------------------------------------------------------

    public parameterDeclaration = this.RULE('parameterDeclaration', () => {
        this.SUBRULE(this.parameterMode);
        this.SUBRULE(this.parameterName);
        this.SUBRULE(this.parameterType);
    });

    // -----------------------------------------------------------------------
    // Parameter mode: IN | OUT | INOUT
    // -----------------------------------------------------------------------

    public parameterMode = this.RULE('parameterMode', () => {
        this.OR([{ ALT: () => this.CONSUME(Inout) }, { ALT: () => this.CONSUME(In) }, { ALT: () => this.CONSUME(Out) }]);
    });

    // -----------------------------------------------------------------------
    // Parameter name: a single unquoted or quoted identifier.
    // -----------------------------------------------------------------------

    public parameterName = this.RULE('parameterName', () => {
        this.SUBRULE(this.identifier);
    });

    // -----------------------------------------------------------------------
    // Parameter type: TABLE(...) or a scalar data type.
    //
    // FIRST(tableType)  = { TableKw }
    // FIRST(scalarType) = { data-type keyword tokens }
    // Sets are disjoint — LL(1) lookahead is sufficient.
    // -----------------------------------------------------------------------

    public parameterType = this.RULE('parameterType', () => {
        this.OR([{ ALT: () => this.SUBRULE(this.tableType) }, { ALT: () => this.SUBRULE(this.scalarType) }]);
    });

    // -----------------------------------------------------------------------
    // TABLE-type parameter: TABLE ( <columnList> )
    // Inner column definitions are parsed but NOT extracted by the visitor.
    // -----------------------------------------------------------------------

    public tableType = this.RULE('tableType', () => {
        this.CONSUME(TableKw);
        this.CONSUME(LParen);
        this.SUBRULE(this.tableColumnList);
        this.CONSUME(RParen);
    });

    public tableColumnList = this.RULE('tableColumnList', () => {
        this.SUBRULE(this.tableColumnDefinition);
        this.MANY(() => {
            this.CONSUME(Comma);
            this.SUBRULE2(this.tableColumnDefinition);
        });
    });

    public tableColumnDefinition = this.RULE('tableColumnDefinition', () => {
        this.SUBRULE(this.identifier);
        this.SUBRULE(this.scalarType);
    });

    // -----------------------------------------------------------------------
    // Scalar data type: <typeKeyword> [( <precision> [, <scale>] )]
    // -----------------------------------------------------------------------

    public scalarType = this.RULE('scalarType', () => {
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
            { ALT: () => this.CONSUME(Time) },
            { ALT: () => this.CONSUME(Timestamp) },
            { ALT: () => this.CONSUME(Seconddate) },
            { ALT: () => this.CONSUME(Clob) },
            { ALT: () => this.CONSUME(NClob) },
            { ALT: () => this.CONSUME(Blob) },
            { ALT: () => this.CONSUME(Varbinary) }
        ]);
    });

    // -----------------------------------------------------------------------
    // Procedure options — zero or more clauses between ) and AS.
    //
    // The MANY loop in createProcedureStatement calls this rule repeatedly.
    // Each alternative is unambiguous from its leading keyword so the parser
    // can resolve the correct alternative with a single-token lookahead.
    // -----------------------------------------------------------------------

    public procedureOption = this.RULE('procedureOption', () => {
        this.OR([
            { ALT: () => this.SUBRULE(this.languageOption) },
            { ALT: () => this.SUBRULE(this.sqlSecurityOption) },
            { ALT: () => this.SUBRULE(this.readWriteOption) },
            { ALT: () => this.SUBRULE(this.defaultSchemaOption) },
            { ALT: () => this.SUBRULE(this.encryptionOption) }
        ]);
    });

    public languageOption = this.RULE('languageOption', () => {
        this.CONSUME(Language);
        this.CONSUME(Sqlscript);
    });

    public sqlSecurityOption = this.RULE('sqlSecurityOption', () => {
        this.CONSUME(Sql);
        this.CONSUME(Security);
        // INVOKER or DEFINER are the standard values; fall back to Identifier
        // for non-standard values without failing.
        this.OR([{ ALT: () => this.CONSUME(Invoker) }, { ALT: () => this.CONSUME(Definer) }, { ALT: () => this.CONSUME(Identifier) }]);
    });

    public readWriteOption = this.RULE('readWriteOption', () => {
        this.OR([{ ALT: () => this.CONSUME(Reads) }, { ALT: () => this.CONSUME(Modifies) }]);
        this.CONSUME(Sql);
        this.CONSUME(Data);
    });

    public defaultSchemaOption = this.RULE('defaultSchemaOption', () => {
        this.CONSUME(Default);
        this.CONSUME(Schema);
        this.SUBRULE(this.identifier);
    });

    public encryptionOption = this.RULE('encryptionOption', () => {
        this.CONSUME(With);
        this.CONSUME(Encryption);
    });

    // -----------------------------------------------------------------------
    // Procedure body: BEGIN <content> END [;]
    //
    // The body is consumed opaquely — nothing inside is extracted.
    // nestedBlock handles arbitrary nesting of BEGIN/END from SQLScript
    // control-flow statements (IF, FOR, WHILE, CASE, etc.).
    // -----------------------------------------------------------------------

    public procedureBody = this.RULE('procedureBody', () => {
        this.CONSUME(Begin);
        this.SUBRULE(this.procedureBodyContent);
        this.CONSUME(End);
    });

    // -----------------------------------------------------------------------
    // procedureBodyContent — absorbs all tokens inside the body.
    //
    // The MANY GATE stops when the next token is End (RParen is also a stop
    // condition because parenGroup consumes RParen internally; RParen at the
    // GATE level can only come from an unmatched closing paren, which is an
    // error the recovery will handle).
    // -----------------------------------------------------------------------

    public procedureBodyContent = this.RULE('procedureBodyContent', () => {
        this.MANY({
            GATE: () => {
                const next = this.LA(1).tokenType;
                return next !== End && next !== RParen;
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
    // nestedBlock — handles BEGIN … END pairs nested inside the body
    // (from IF/ELSE, FOR, WHILE, CASE, etc.).
    //
    // FIRST(nestedBlock) = { Begin } — distinct from anyBodyToken (which
    // excludes Begin) so the OR in procedureBodyContent is unambiguous.
    // -----------------------------------------------------------------------

    public nestedBlock = this.RULE('nestedBlock', () => {
        this.CONSUME(Begin);
        this.SUBRULE(this.procedureBodyContent);
        this.CONSUME(End);
    });

    // -----------------------------------------------------------------------
    // parenGroup — balanced parentheses of arbitrary depth.
    // Used for function call arguments, IN (...) lists, etc.
    // LParen/RParen are excluded from anyBodyToken so the MANY in
    // procedureBodyContent correctly delegates to this rule.
    // -----------------------------------------------------------------------

    public parenGroup = this.RULE('parenGroup', () => {
        this.CONSUME(LParen);
        this.MANY(() => {
            this.OR([{ ALT: () => this.SUBRULE(this.parenGroup) }, { ALT: () => this.SUBRULE(this.anyBodyToken) }]);
        });
        this.CONSUME(RParen);
    });

    // -----------------------------------------------------------------------
    // anyBodyToken — matches any single token except Begin, End, LParen, RParen.
    //
    // Explicitly enumerating every token ensures the MANY loops above can
    // stop reliably on End and RParen (which are not in anyBodyToken's FIRST set).
    // -----------------------------------------------------------------------

    public anyBodyToken = this.RULE('anyBodyToken', () => {
        this.OR([
            { ALT: () => this.CONSUME(StringLiteral) },
            { ALT: () => this.CONSUME(IntegerLiteral) },
            { ALT: () => this.CONSUME(Identifier) },
            { ALT: () => this.CONSUME(QuotedIdentifier) },
            { ALT: () => this.CONSUME(Comma) },
            { ALT: () => this.CONSUME(Semicolon) },
            { ALT: () => this.CONSUME(Dot) },
            { ALT: () => this.CONSUME(Inout) },
            { ALT: () => this.CONSUME(Invoker) },
            { ALT: () => this.CONSUME(In) },
            { ALT: () => this.CONSUME(Out) },
            { ALT: () => this.CONSUME(Create) },
            { ALT: () => this.CONSUME(Procedure) },
            { ALT: () => this.CONSUME(TableKw) },
            { ALT: () => this.CONSUME(Language) },
            { ALT: () => this.CONSUME(Sqlscript) },
            { ALT: () => this.CONSUME(Sql) },
            { ALT: () => this.CONSUME(Security) },
            { ALT: () => this.CONSUME(Definer) },
            { ALT: () => this.CONSUME(Reads) },
            { ALT: () => this.CONSUME(Modifies) },
            { ALT: () => this.CONSUME(Data) },
            { ALT: () => this.CONSUME(Default) },
            { ALT: () => this.CONSUME(Schema) },
            { ALT: () => this.CONSUME(As) },
            { ALT: () => this.CONSUME(With) },
            { ALT: () => this.CONSUME(Encryption) },
            { ALT: () => this.CONSUME(Timestamp) },
            { ALT: () => this.CONSUME(Seconddate) },
            { ALT: () => this.CONSUME(NVarchar) },
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
            { ALT: () => this.CONSUME(Time) },
            { ALT: () => this.CONSUME(Clob) },
            { ALT: () => this.CONSUME(NClob) },
            { ALT: () => this.CONSUME(Blob) },
            { ALT: () => this.CONSUME(Varbinary) }
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
export const hdbProcedureParser = new HdbProcedureParser();
