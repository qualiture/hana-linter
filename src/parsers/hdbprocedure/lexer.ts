import { createToken, Lexer, type TokenType } from 'chevrotain';

// ---------------------------------------------------------------------------
// Skip tokens — declared first so they are consumed before anything else.
// ---------------------------------------------------------------------------

export const BlockComment = createToken({
    name: 'BlockComment',
    pattern: /\/\*[\s\S]*?\*\//,
    group: Lexer.SKIPPED
});

export const LineComment = createToken({
    name: 'LineComment',
    pattern: /--[^\r\n]*/,
    group: Lexer.SKIPPED
});

export const WhiteSpace = createToken({
    name: 'WhiteSpace',
    pattern: /\s+/,
    group: Lexer.SKIPPED
});

// ---------------------------------------------------------------------------
// String literal — declared before keywords so a single-quoted string
// containing keyword text is never split.
// ---------------------------------------------------------------------------

export const StringLiteral = createToken({
    name: 'StringLiteral',
    pattern: /'(?:[^'\\]|\\.)*'/
});

// ---------------------------------------------------------------------------
// Identifier — defined early so keyword tokens can reference it via longer_alt.
// All keyword tokens must declare longer_alt: Identifier so that identifiers
// that *start* with a keyword (e.g. INVOICE, LANGUAGE_CODE) are not split.
// ---------------------------------------------------------------------------

export const Identifier = createToken({
    name: 'Identifier',
    pattern: /[A-Za-z_][A-Za-z0-9_]*/
});

export const QuotedIdentifier = createToken({
    name: 'QuotedIdentifier',
    pattern: /"[^"]*"/
});

// ---------------------------------------------------------------------------
// Procedure-level keyword tokens
//
// Prefix-conflict ordering rules (longest declared first within group):
//   INOUT, INVOKER  before  IN   (all start with "IN")
// ---------------------------------------------------------------------------

// IN-prefix group — longest first
export const Inout = createToken({ name: 'Inout', pattern: /INOUT/i, longer_alt: Identifier });
export const Invoker = createToken({ name: 'Invoker', pattern: /INVOKER/i, longer_alt: Identifier });
export const In = createToken({ name: 'In', pattern: /IN/i, longer_alt: Identifier });

export const Out = createToken({ name: 'Out', pattern: /OUT/i, longer_alt: Identifier });
export const Create = createToken({ name: 'Create', pattern: /CREATE/i, longer_alt: Identifier });
export const Procedure = createToken({ name: 'Procedure', pattern: /PROCEDURE/i, longer_alt: Identifier });
export const TableKw = createToken({ name: 'Table', pattern: /TABLE/i, longer_alt: Identifier });
export const Language = createToken({ name: 'Language', pattern: /LANGUAGE/i, longer_alt: Identifier });
export const Sqlscript = createToken({ name: 'Sqlscript', pattern: /SQLSCRIPT/i, longer_alt: Identifier });
export const Sql = createToken({ name: 'Sql', pattern: /SQL/i, longer_alt: Identifier });
export const Security = createToken({ name: 'Security', pattern: /SECURITY/i, longer_alt: Identifier });
export const Definer = createToken({ name: 'Definer', pattern: /DEFINER/i, longer_alt: Identifier });
export const Reads = createToken({ name: 'Reads', pattern: /READS/i, longer_alt: Identifier });
export const Modifies = createToken({ name: 'Modifies', pattern: /MODIFIES/i, longer_alt: Identifier });
export const Data = createToken({ name: 'Data', pattern: /DATA/i, longer_alt: Identifier });
export const Default = createToken({ name: 'Default', pattern: /DEFAULT/i, longer_alt: Identifier });
export const Schema = createToken({ name: 'Schema', pattern: /SCHEMA/i, longer_alt: Identifier });
export const As = createToken({ name: 'As', pattern: /AS/i, longer_alt: Identifier });
export const Begin = createToken({ name: 'Begin', pattern: /BEGIN/i, longer_alt: Identifier });
export const End = createToken({ name: 'End', pattern: /END/i, longer_alt: Identifier });
export const With = createToken({ name: 'With', pattern: /WITH/i, longer_alt: Identifier });
export const Encryption = createToken({ name: 'Encryption', pattern: /ENCRYPTION/i, longer_alt: Identifier });

// ---------------------------------------------------------------------------
// Data-type keyword tokens
//
// Prefix-conflict ordering rules:
//   TIMESTAMP before TIME  (TIMESTAMP starts with TIME)
//   NCLOB     before CLOB  (NCLOB starts with N, no CLOB conflict, but
//                            NVarchar before VarChar by convention)
// ---------------------------------------------------------------------------

// TIMESTAMP prefix group
export const Timestamp = createToken({ name: 'Timestamp', pattern: /TIMESTAMP/i, longer_alt: Identifier });
export const Seconddate = createToken({ name: 'Seconddate', pattern: /SECONDDATE/i, longer_alt: Identifier });
export const NVarchar = createToken({ name: 'NVarchar', pattern: /NVARCHAR/i, longer_alt: Identifier });
export const VarChar = createToken({ name: 'VarChar', pattern: /VARCHAR/i, longer_alt: Identifier });
export const Alphanum = createToken({ name: 'Alphanum', pattern: /ALPHANUM/i, longer_alt: Identifier });
export const Shorttext = createToken({ name: 'Shorttext', pattern: /SHORTTEXT/i, longer_alt: Identifier });
export const Integer = createToken({ name: 'Integer', pattern: /INTEGER/i, longer_alt: Identifier });
export const Bigint = createToken({ name: 'Bigint', pattern: /BIGINT/i, longer_alt: Identifier });
export const Smallint = createToken({ name: 'Smallint', pattern: /SMALLINT/i, longer_alt: Identifier });
export const Tinyint = createToken({ name: 'Tinyint', pattern: /TINYINT/i, longer_alt: Identifier });
export const Decimal = createToken({ name: 'Decimal', pattern: /DECIMAL/i, longer_alt: Identifier });
export const Double = createToken({ name: 'Double', pattern: /DOUBLE/i, longer_alt: Identifier });
export const Float = createToken({ name: 'Float', pattern: /FLOAT/i, longer_alt: Identifier });
export const Real = createToken({ name: 'Real', pattern: /REAL/i, longer_alt: Identifier });
export const Boolean = createToken({ name: 'Boolean', pattern: /BOOLEAN/i, longer_alt: Identifier });
export const Date = createToken({ name: 'Date', pattern: /DATE/i, longer_alt: Identifier });
export const Time = createToken({ name: 'Time', pattern: /TIME/i, longer_alt: Identifier }); // after Timestamp
export const Clob = createToken({ name: 'Clob', pattern: /CLOB/i, longer_alt: Identifier });
export const NClob = createToken({ name: 'NClob', pattern: /NCLOB/i, longer_alt: Identifier });
export const Blob = createToken({ name: 'Blob', pattern: /BLOB/i, longer_alt: Identifier });
export const Varbinary = createToken({ name: 'Varbinary', pattern: /VARBINARY/i, longer_alt: Identifier });

// ---------------------------------------------------------------------------
// Numeric literal
// ---------------------------------------------------------------------------

export const IntegerLiteral = createToken({
    name: 'IntegerLiteral',
    pattern: /[0-9]+/
});

// ---------------------------------------------------------------------------
// Punctuation
// ---------------------------------------------------------------------------

export const LParen = createToken({ name: 'LParen', pattern: /\(/ });
export const RParen = createToken({ name: 'RParen', pattern: /\)/ });
export const Comma = createToken({ name: 'Comma', pattern: /,/ });
export const Semicolon = createToken({ name: 'Semicolon', pattern: /;/ });
export const Dot = createToken({ name: 'Dot', pattern: /\./ });

// ---------------------------------------------------------------------------
// allTokens — ordered array passed to the Lexer constructor.
//
// Critical ordering constraints:
//  1. Skip tokens first.
//  2. StringLiteral before keywords (avoids partial matches on quoted strings).
//  3. Keyword tokens with shared prefix: longer one declared first.
//     - Inout, Invoker before In  (IN-prefix group)
//     - Timestamp before Time     (TIME-prefix group)
//  4. All keyword/data-type tokens before QuotedIdentifier and Identifier.
//  5. QuotedIdentifier before Identifier.
//  6. IntegerLiteral after identifiers.
// ---------------------------------------------------------------------------

export const allTokens: TokenType[] = [
    // Skip
    BlockComment,
    LineComment,
    WhiteSpace,
    // String literal (before keywords)
    StringLiteral,
    // Procedure keywords — IN-prefix group: longest first
    // Integer must also precede In (INTEGER starts with IN; if In comes first
    // its longer_alt:Identifier would consume INTEGER before Integer is tried).
    Inout,
    Invoker,
    Integer, // before In — INTEGER starts with IN
    In,
    Out,
    Create,
    Procedure,
    TableKw,
    Language,
    Sqlscript,
    Sql,
    Security,
    Definer,
    Reads,
    Modifies,
    Data,
    Default,
    Schema,
    As,
    Begin,
    End,
    With,
    Encryption,
    // Data-type keywords — TIME-prefix group: longest first
    Timestamp,
    Seconddate,
    NVarchar,
    VarChar,
    Alphanum,
    Shorttext,
    // Integer is already listed above (before In) — do not repeat here
    Bigint,
    Smallint,
    Tinyint,
    Decimal,
    Double,
    Float,
    Real,
    Boolean,
    Date,
    Time, // after Timestamp
    NClob,
    Clob,
    Blob,
    Varbinary,
    // Identifiers — catch-all, after all keywords
    QuotedIdentifier,
    Identifier,
    // Numeric literal — after identifiers
    IntegerLiteral,
    // Punctuation
    LParen,
    RParen,
    Comma,
    Semicolon,
    Dot
];

/**
 * Singleton Lexer instance — instantiated once at module load time per
 * Chevrotain best practices (NFR-3).
 */
export const HdbProcedureLexer = new Lexer(allTokens);
