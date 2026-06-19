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
// that *start* with a keyword (e.g. NULLABLE, TIMESTAMPS) are not split.
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
// DDL keyword tokens
// ---------------------------------------------------------------------------

export const Create = createToken({ name: 'Create', pattern: /CREATE/i, longer_alt: Identifier });
export const TableKw = createToken({ name: 'Table', pattern: /TABLE/i, longer_alt: Identifier });
export const ColumnKw = createToken({ name: 'Column', pattern: /COLUMN/i, longer_alt: Identifier });
export const Row = createToken({ name: 'Row', pattern: /ROW/i, longer_alt: Identifier });
export const Global = createToken({ name: 'Global', pattern: /GLOBAL/i, longer_alt: Identifier });
export const Temporary = createToken({ name: 'Temporary', pattern: /TEMPORARY/i, longer_alt: Identifier });
export const Constraint = createToken({ name: 'Constraint', pattern: /CONSTRAINT/i, longer_alt: Identifier });
// Must come before any shorter token sharing the same prefix.
export const References = createToken({ name: 'References', pattern: /REFERENCES/i, longer_alt: Identifier });
export const Restrict = createToken({ name: 'Restrict', pattern: /RESTRICT/i, longer_alt: Identifier });
export const Primary = createToken({ name: 'Primary', pattern: /PRIMARY/i, longer_alt: Identifier });
export const Unique = createToken({ name: 'Unique', pattern: /UNIQUE/i, longer_alt: Identifier });
export const Foreign = createToken({ name: 'Foreign', pattern: /FOREIGN/i, longer_alt: Identifier });
export const Key = createToken({ name: 'Key', pattern: /KEY/i, longer_alt: Identifier });
export const Check = createToken({ name: 'Check', pattern: /CHECK/i, longer_alt: Identifier });
export const Partition = createToken({ name: 'Partition', pattern: /PARTITION/i, longer_alt: Identifier });
export const Index = createToken({ name: 'Index', pattern: /INDEX/i, longer_alt: Identifier });
export const Default = createToken({ name: 'Default', pattern: /DEFAULT/i, longer_alt: Identifier });
export const Cascade = createToken({ name: 'Cascade', pattern: /CASCADE/i, longer_alt: Identifier });
export const With = createToken({ name: 'With', pattern: /WITH/i, longer_alt: Identifier });
// Not must come before No (same starting chars).
export const Not = createToken({ name: 'Not', pattern: /NOT/i, longer_alt: Identifier });
export const No = createToken({ name: 'No', pattern: /NO/i, longer_alt: Identifier });
export const Null = createToken({ name: 'Null', pattern: /NULL/i, longer_alt: Identifier });
export const Action = createToken({ name: 'Action', pattern: /ACTION/i, longer_alt: Identifier });
export const As = createToken({ name: 'As', pattern: /AS/i, longer_alt: Identifier });

// ---------------------------------------------------------------------------
// Data-type keyword tokens
// Ordering rule: longer/more-specific patterns before shorter ones that share
// a prefix.  Affected pairs: Timestamp > Time, IntegerKw > IntKw.
// ---------------------------------------------------------------------------

export const NVarchar = createToken({ name: 'NVarchar', pattern: /NVARCHAR/i, longer_alt: Identifier });
export const VarChar = createToken({ name: 'VarChar', pattern: /VARCHAR/i, longer_alt: Identifier });
export const AlphaNum = createToken({ name: 'AlphaNum', pattern: /ALPHANUM/i, longer_alt: Identifier });
export const ShortText = createToken({ name: 'ShortText', pattern: /SHORTTEXT/i, longer_alt: Identifier });
export const BinText = createToken({ name: 'BinText', pattern: /BINTEXT/i, longer_alt: Identifier });
export const Text = createToken({ name: 'Text', pattern: /TEXT/i, longer_alt: Identifier });
export const BigInt = createToken({ name: 'BigInt', pattern: /BIGINT/i, longer_alt: Identifier });
export const SmallInt = createToken({ name: 'SmallInt', pattern: /SMALLINT/i, longer_alt: Identifier });
export const TinyInt = createToken({ name: 'TinyInt', pattern: /TINYINT/i, longer_alt: Identifier });
// IntegerKw before IntKw — "INTEGER" must not be tokenised as INT + ER.
export const IntegerKw = createToken({ name: 'Integer', pattern: /INTEGER/i, longer_alt: Identifier });
export const IntKw = createToken({ name: 'Int', pattern: /INT/i, longer_alt: Identifier });
export const Decimal = createToken({ name: 'Decimal', pattern: /DECIMAL/i, longer_alt: Identifier });
export const Numeric = createToken({ name: 'Numeric', pattern: /NUMERIC/i, longer_alt: Identifier });
export const Float = createToken({ name: 'Float', pattern: /FLOAT/i, longer_alt: Identifier });
export const Double = createToken({ name: 'Double', pattern: /DOUBLE/i, longer_alt: Identifier });
export const Real = createToken({ name: 'Real', pattern: /REAL/i, longer_alt: Identifier });
export const Boolean = createToken({ name: 'Boolean', pattern: /BOOLEAN/i, longer_alt: Identifier });
export const SecondDate = createToken({ name: 'SecondDate', pattern: /SECONDDATE/i, longer_alt: Identifier });
// Timestamp before Time — "TIMESTAMP" must not be tokenised as TIME + STAMP.
export const Timestamp = createToken({ name: 'Timestamp', pattern: /TIMESTAMP/i, longer_alt: Identifier });
export const Time = createToken({ name: 'Time', pattern: /TIME/i, longer_alt: Identifier });
export const Date = createToken({ name: 'Date', pattern: /DATE/i, longer_alt: Identifier });
export const NClob = createToken({ name: 'NClob', pattern: /NCLOB/i, longer_alt: Identifier });
export const Clob = createToken({ name: 'Clob', pattern: /CLOB/i, longer_alt: Identifier });
export const Blob = createToken({ name: 'Blob', pattern: /BLOB/i, longer_alt: Identifier });
export const VarBinary = createToken({ name: 'VarBinary', pattern: /VARBINARY/i, longer_alt: Identifier });
export const StPoint = createToken({ name: 'StPoint', pattern: /ST_POINT/i, longer_alt: Identifier });
export const StGeometry = createToken({ name: 'StGeometry', pattern: /ST_GEOMETRY/i, longer_alt: Identifier });

// ---------------------------------------------------------------------------
// Literals
// ---------------------------------------------------------------------------

export const StringLiteral = createToken({
    name: 'StringLiteral',
    pattern: /'(?:[^'\\]|\\.)*'/
});

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
export const Equals = createToken({ name: 'Equals', pattern: /=/ });

// ---------------------------------------------------------------------------
// allTokens — ordered array passed to the Lexer constructor.
//
// Critical ordering constraints:
//  1. Skip tokens first (BlockComment, LineComment, WhiteSpace).
//  2. All keyword tokens before Identifier (keywords have longer_alt: Identifier,
//     so they take priority over the catch-all).
//  3. QuotedIdentifier before Identifier.
//  4. IntegerLiteral after keywords (avoids shadowing digit sequences in tokens).
//  5. Pairs where one is a prefix of another: longer one listed first.
// ---------------------------------------------------------------------------

export const allTokens: TokenType[] = [
    // Skip
    BlockComment,
    LineComment,
    WhiteSpace,
    // Literals (before Identifier to avoid partial matches)
    StringLiteral,
    // DDL keywords (longer_alt: Identifier — must appear before Identifier)
    Create,
    Constraint,
    References,
    Restrict,
    Primary,
    Partition,
    Temporary,
    Unique,
    Foreign,
    Default,
    Cascade,
    Global,
    ColumnKw,
    TableKw,
    Check,
    Index,
    With,
    Row,
    Key,
    Not, // before No
    No,
    Null,
    Action,
    As,
    // Data-type keywords (longer_alt: Identifier)
    NVarchar,
    VarBinary,
    VarChar,
    AlphaNum,
    ShortText,
    BinText,
    Text,
    BigInt,
    SmallInt,
    TinyInt,
    IntegerKw, // before IntKw
    IntKw,
    Decimal,
    Numeric,
    Float,
    Double,
    Real,
    Boolean,
    SecondDate,
    Timestamp, // before Time
    Time,
    Date,
    NClob,
    Clob,
    Blob,
    StPoint,
    StGeometry,
    // Identifiers — catch-all, after all keywords
    QuotedIdentifier,
    Identifier,
    // Numeric literal — after identifiers so digits in names don't interfere
    IntegerLiteral,
    // Punctuation
    LParen,
    RParen,
    Comma,
    Semicolon,
    Dot,
    Equals
];

/**
 * Singleton Lexer instance — instantiated once at module load time per
 * Chevrotain best practices (NFR-3).
 */
export const HdbTableLexer = new Lexer(allTokens);
