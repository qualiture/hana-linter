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
// that *start* with a keyword (e.g. ORDERLY, INNER_JOIN) are not split.
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
// DML / DDL keyword tokens
//
// Prefix-conflict ordering rules (longer before shorter):
//  - INTERSECT > INNER > IN   (all share prefix IN-)
//  - ORDER > OR               (ORDER shares prefix OR-)
//  - OPTION > ONLY > ON       (all share prefix ON-)
// ---------------------------------------------------------------------------

export const Create = createToken({ name: 'Create', pattern: /CREATE/i, longer_alt: Identifier });
export const ViewKw = createToken({ name: 'View', pattern: /VIEW/i, longer_alt: Identifier });
// Asc and Desc declared before As — ASC/DESC share the AS/DE prefix with As
// and must appear before it in allTokens so Chevrotain's positional matching
// resolves in favour of the longer token.
export const Asc = createToken({ name: 'Asc', pattern: /ASC/i, longer_alt: Identifier });
export const Desc = createToken({ name: 'Desc', pattern: /DESC/i, longer_alt: Identifier });
export const As = createToken({ name: 'As', pattern: /AS/i, longer_alt: Identifier });
export const Select = createToken({ name: 'Select', pattern: /SELECT/i, longer_alt: Identifier });
export const Distinct = createToken({ name: 'Distinct', pattern: /DISTINCT/i, longer_alt: Identifier });
export const All = createToken({ name: 'All', pattern: /ALL/i, longer_alt: Identifier });
export const Top = createToken({ name: 'Top', pattern: /TOP/i, longer_alt: Identifier });
export const From = createToken({ name: 'From', pattern: /FROM/i, longer_alt: Identifier });
export const Where = createToken({ name: 'Where', pattern: /WHERE/i, longer_alt: Identifier });
export const Group = createToken({ name: 'Group', pattern: /GROUP/i, longer_alt: Identifier });
export const By = createToken({ name: 'By', pattern: /BY/i, longer_alt: Identifier });
export const Having = createToken({ name: 'Having', pattern: /HAVING/i, longer_alt: Identifier });
// IN prefix group: INTERSECT before INNER before IN.
export const Intersect = createToken({ name: 'Intersect', pattern: /INTERSECT/i, longer_alt: Identifier });
export const Inner = createToken({ name: 'Inner', pattern: /INNER/i, longer_alt: Identifier });
export const In = createToken({ name: 'In', pattern: /IN/i, longer_alt: Identifier });
export const Join = createToken({ name: 'Join', pattern: /JOIN/i, longer_alt: Identifier });
export const Left = createToken({ name: 'Left', pattern: /LEFT/i, longer_alt: Identifier });
export const Right = createToken({ name: 'Right', pattern: /RIGHT/i, longer_alt: Identifier });
export const Full = createToken({ name: 'Full', pattern: /FULL/i, longer_alt: Identifier });
export const Outer = createToken({ name: 'Outer', pattern: /OUTER/i, longer_alt: Identifier });
export const Cross = createToken({ name: 'Cross', pattern: /CROSS/i, longer_alt: Identifier });
// OR prefix group: ORDER before OR.
export const Order = createToken({ name: 'Order', pattern: /ORDER/i, longer_alt: Identifier });
export const Or = createToken({ name: 'Or', pattern: /OR/i, longer_alt: Identifier });
export const Union = createToken({ name: 'Union', pattern: /UNION/i, longer_alt: Identifier });
export const Except = createToken({ name: 'Except', pattern: /EXCEPT/i, longer_alt: Identifier });
// ON prefix group: OPTION before ONLY before ON.
export const Option = createToken({ name: 'Option', pattern: /OPTION/i, longer_alt: Identifier });
export const Only = createToken({ name: 'Only', pattern: /ONLY/i, longer_alt: Identifier });
export const On = createToken({ name: 'On', pattern: /ON/i, longer_alt: Identifier });
export const With = createToken({ name: 'With', pattern: /WITH/i, longer_alt: Identifier });
export const Read = createToken({ name: 'Read', pattern: /READ/i, longer_alt: Identifier });
export const Check = createToken({ name: 'Check', pattern: /CHECK/i, longer_alt: Identifier });
export const Case = createToken({ name: 'Case', pattern: /CASE/i, longer_alt: Identifier });
export const When = createToken({ name: 'When', pattern: /WHEN/i, longer_alt: Identifier });
export const Then = createToken({ name: 'Then', pattern: /THEN/i, longer_alt: Identifier });
export const Else = createToken({ name: 'Else', pattern: /ELSE/i, longer_alt: Identifier });
export const End = createToken({ name: 'End', pattern: /END/i, longer_alt: Identifier });
export const Not = createToken({ name: 'Not', pattern: /NOT/i, longer_alt: Identifier });
export const Null = createToken({ name: 'Null', pattern: /NULL/i, longer_alt: Identifier });
export const And = createToken({ name: 'And', pattern: /AND/i, longer_alt: Identifier });
export const Is = createToken({ name: 'Is', pattern: /IS/i, longer_alt: Identifier });
export const Between = createToken({ name: 'Between', pattern: /BETWEEN/i, longer_alt: Identifier });
export const Like = createToken({ name: 'Like', pattern: /LIKE/i, longer_alt: Identifier });
export const Exists = createToken({ name: 'Exists', pattern: /EXISTS/i, longer_alt: Identifier });
export const Limit = createToken({ name: 'Limit', pattern: /LIMIT/i, longer_alt: Identifier });

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
// Punctuation and operators
//
// Multi-character operators must be declared before their single-character
// prefixes: Concat (||) before any |, NotEqual (<>) before < and >,
// LessEqual (<=) before <, GreaterEqual (>=) before >.
// ---------------------------------------------------------------------------

export const LParen = createToken({ name: 'LParen', pattern: /\(/ });
export const RParen = createToken({ name: 'RParen', pattern: /\)/ });
export const Comma = createToken({ name: 'Comma', pattern: /,/ });
export const Semicolon = createToken({ name: 'Semicolon', pattern: /;/ });
export const Dot = createToken({ name: 'Dot', pattern: /\./ });
export const Star = createToken({ name: 'Star', pattern: /\*/ });
export const Plus = createToken({ name: 'Plus', pattern: /\+/ });
export const Minus = createToken({ name: 'Minus', pattern: /-/ });
export const Slash = createToken({ name: 'Slash', pattern: /\// });
export const Concat = createToken({ name: 'Concat', pattern: /\|\|/ });
export const NotEqual = createToken({ name: 'NotEqual', pattern: /<>/ });
export const LessEqual = createToken({ name: 'LessEqual', pattern: /<=/ });
export const GreaterEqual = createToken({ name: 'GreaterEqual', pattern: />=/ });
export const LessThan = createToken({ name: 'LessThan', pattern: /</ });
export const GreaterThan = createToken({ name: 'GreaterThan', pattern: />/ });
export const Equals = createToken({ name: 'Equals', pattern: /=/ });

// ---------------------------------------------------------------------------
// allTokens — ordered array passed to the Lexer constructor.
//
// Critical ordering constraints:
//  1. Skip tokens first (BlockComment, LineComment, WhiteSpace).
//  2. String literal before identifiers to avoid partial matches.
//  3. All keyword tokens before Identifier (longer_alt: Identifier takes priority).
//  4. Within prefix-conflict groups: longest token first.
//  5. QuotedIdentifier before Identifier (catch-all).
//  6. IntegerLiteral after identifiers.
//  7. Multi-char operators before single-char variants sharing a prefix.
// ---------------------------------------------------------------------------

export const allTokens: TokenType[] = [
    // Skip
    BlockComment,
    LineComment,
    WhiteSpace,
    // String literal (before identifiers — avoids partial matches in patterns)
    StringLiteral,
    // DML/DDL keywords (longer_alt: Identifier; prefix-conflict groups in order)
    Create,
    ViewKw,
    Asc, // before As — ASC prefix conflict
    Desc,
    As,
    Select,
    Distinct,
    All,
    Top,
    From,
    Where,
    Group,
    By,
    Having,
    Intersect, // IN prefix group: longest first
    Inner,
    In,
    Join,
    Left,
    Right,
    Full,
    Outer,
    Cross,
    Order, // OR prefix group: longest first
    Or,
    Union,
    Except,
    Option, // ON prefix group: longest first
    Only,
    On,
    With,
    Read,
    Check,
    Case,
    When,
    Then,
    Else,
    End,
    Not,
    Null,
    And,
    Is,
    Between,
    Like,
    Exists,
    Limit,
    // Identifiers — catch-all, after all keywords
    QuotedIdentifier,
    Identifier,
    // Numeric literal — after identifiers so digits in names don't interfere
    IntegerLiteral,
    // Multi-char operators before single-char variants sharing a prefix
    Concat,
    NotEqual,
    LessEqual,
    GreaterEqual,
    // Remaining punctuation
    LParen,
    RParen,
    Comma,
    Semicolon,
    Dot,
    Star,
    Plus,
    Minus,
    Slash,
    LessThan,
    GreaterThan,
    Equals
];

/**
 * Singleton Lexer instance — instantiated once at module load time per
 * Chevrotain best practices (NFR-3).
 */
export const HdbViewLexer = new Lexer(allTokens);
