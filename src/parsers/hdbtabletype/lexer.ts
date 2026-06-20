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
// Identifier — defined early so keyword tokens can reference it via longer_alt.
// All keyword tokens must declare longer_alt: Identifier so that identifiers
// that *start* with a keyword (e.g. TYPE_CODE, TABLE_NAME, ASSET) are not split.
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
// Table-type keyword tokens (all with longer_alt: Identifier)
// ---------------------------------------------------------------------------

export const TypeKw = createToken({ name: 'TypeKw', pattern: /TYPE/i, longer_alt: Identifier });
export const As = createToken({ name: 'As', pattern: /AS/i, longer_alt: Identifier });
export const TableKw = createToken({ name: 'TableKw', pattern: /TABLE/i, longer_alt: Identifier });

// ---------------------------------------------------------------------------
// Data-type keyword tokens (all with longer_alt: Identifier)
//
// Ordering constraints:
//  - Timestamp before Time   ("TIMESTAMP" must not be tokenised as TIME + STAMP)
//  - Varbinary before VarChar ("VARBINARY" must not be tokenised as VARCHAR + …)
//  - NClob before Clob       ("NCLOB" must not be tokenised as CLOB)
// ---------------------------------------------------------------------------

export const Timestamp = createToken({ name: 'Timestamp', pattern: /TIMESTAMP/i, longer_alt: Identifier });
export const Seconddate = createToken({ name: 'Seconddate', pattern: /SECONDDATE/i, longer_alt: Identifier });
export const NVarchar = createToken({ name: 'NVarchar', pattern: /NVARCHAR/i, longer_alt: Identifier });
export const Varbinary = createToken({ name: 'Varbinary', pattern: /VARBINARY/i, longer_alt: Identifier });
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
export const Time = createToken({ name: 'Time', pattern: /TIME/i, longer_alt: Identifier });
export const NClob = createToken({ name: 'NClob', pattern: /NCLOB/i, longer_alt: Identifier });
export const Clob = createToken({ name: 'Clob', pattern: /CLOB/i, longer_alt: Identifier });
export const Blob = createToken({ name: 'Blob', pattern: /BLOB/i, longer_alt: Identifier });
export const Binary = createToken({ name: 'Binary', pattern: /BINARY/i, longer_alt: Identifier });

// ---------------------------------------------------------------------------
// Literals
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
//  1. Skip tokens first (BlockComment, LineComment, WhiteSpace).
//  2. All keyword tokens before QuotedIdentifier and Identifier
//     (keywords have longer_alt: Identifier, so they take priority).
//  3. QuotedIdentifier before Identifier.
//  4. IntegerLiteral after Identifier.
//  5. Within data-type groups: longer token before shorter prefix.
//     - Timestamp before Time
//     - Varbinary before VarChar
//     - NClob before Clob
// ---------------------------------------------------------------------------

export const allTokens: TokenType[] = [
    // Skip
    BlockComment,
    LineComment,
    WhiteSpace,
    // Table-type keywords
    TypeKw,
    As,
    TableKw,
    // Data-type keywords — prefix-conflict groups in longest-first order
    Timestamp, // before Time
    Seconddate,
    NVarchar,
    Varbinary, // before VarChar
    VarChar,
    Alphanum,
    Shorttext,
    Integer,
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
    NClob, // before Clob
    Clob,
    Blob,
    Binary,
    // Identifiers (catch-all — after all keywords)
    QuotedIdentifier,
    Identifier,
    // Numeric literal
    IntegerLiteral,
    // Punctuation
    LParen,
    RParen,
    Comma,
    Semicolon,
    Dot
];

// ---------------------------------------------------------------------------
// Singleton Lexer instance — instantiated once at module load per Chevrotain
// best practices (re-instantiating on every call is wasteful).
// ---------------------------------------------------------------------------

export const HdbTableTypeLexer = new Lexer(allTokens);
