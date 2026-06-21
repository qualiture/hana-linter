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
// that *start* with a keyword (e.g. SEQUENCE_ID, NO_WAIT, CYCLE_COUNT,
// START_DATE, RESET_FLAG) are not split at the keyword boundary.
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
// Sequence DDL keyword tokens (all with longer_alt: Identifier)
// ---------------------------------------------------------------------------

export const SequenceKw = createToken({ name: 'SequenceKw', pattern: /SEQUENCE/i, longer_alt: Identifier });
export const IncrementKw = createToken({ name: 'IncrementKw', pattern: /INCREMENT/i, longer_alt: Identifier });
export const ByKw = createToken({ name: 'ByKw', pattern: /BY/i, longer_alt: Identifier });
export const StartKw = createToken({ name: 'StartKw', pattern: /START/i, longer_alt: Identifier });
export const WithKw = createToken({ name: 'WithKw', pattern: /WITH/i, longer_alt: Identifier });
export const MinvalueKw = createToken({ name: 'MinvalueKw', pattern: /MINVALUE/i, longer_alt: Identifier });
export const MaxvalueKw = createToken({ name: 'MaxvalueKw', pattern: /MAXVALUE/i, longer_alt: Identifier });
// NotKw must be declared before NoKw because 'NOT' starts with 'NO'.
// NoKw uses longer_alt: [NotKw, Identifier] (chained) so that:
//   'NOT'    → NotKw (longer match wins over NoKw's 'NO')
//   'NO'     → NoKw  (Identifier matches same length → NoKw wins)
//   'NO_WAIT'→ Identifier (Identifier matches longer than NoKw's 'NO')
export const NotKw = createToken({ name: 'NotKw', pattern: /NOT/i, longer_alt: Identifier });
export const NoKw = createToken({ name: 'NoKw', pattern: /NO/i, longer_alt: [NotKw, Identifier] });
export const CycleKw = createToken({ name: 'CycleKw', pattern: /CYCLE/i, longer_alt: Identifier });
export const ResetKw = createToken({ name: 'ResetKw', pattern: /RESET/i, longer_alt: Identifier });
export const DependsKw = createToken({ name: 'DependsKw', pattern: /DEPENDS/i, longer_alt: Identifier });
export const OnKw = createToken({ name: 'OnKw', pattern: /ON/i, longer_alt: Identifier });

// ---------------------------------------------------------------------------
// SQL clause / function keyword tokens used inside RESET BY SELECT bodies.
// All declare longer_alt: Identifier so that column names beginning with
// these strings (e.g. SELECT_COUNT, FROM_DATE) are correctly tokenised.
// ---------------------------------------------------------------------------

export const SelectKw = createToken({ name: 'SelectKw', pattern: /SELECT/i, longer_alt: Identifier });
export const FromKw = createToken({ name: 'FromKw', pattern: /FROM/i, longer_alt: Identifier });
export const WhereKw = createToken({ name: 'WhereKw', pattern: /WHERE/i, longer_alt: Identifier });
export const IfnullKw = createToken({ name: 'IfnullKw', pattern: /IFNULL/i, longer_alt: Identifier });
export const CoalesceKw = createToken({ name: 'CoalesceKw', pattern: /COALESCE/i, longer_alt: Identifier });
export const NvlKw = createToken({ name: 'NvlKw', pattern: /NVL/i, longer_alt: Identifier });
export const MaxKw = createToken({ name: 'MaxKw', pattern: /MAX/i, longer_alt: Identifier });
export const MinKw = createToken({ name: 'MinKw', pattern: /MIN/i, longer_alt: Identifier });
export const CountKw = createToken({ name: 'CountKw', pattern: /COUNT/i, longer_alt: Identifier });
export const SumKw = createToken({ name: 'SumKw', pattern: /SUM/i, longer_alt: Identifier });
export const AndKw = createToken({ name: 'AndKw', pattern: /AND/i, longer_alt: Identifier });
export const OrKw = createToken({ name: 'OrKw', pattern: /OR/i, longer_alt: Identifier });
export const IsKw = createToken({ name: 'IsKw', pattern: /IS/i, longer_alt: Identifier });
export const NullKw = createToken({ name: 'NullKw', pattern: /NULL/i, longer_alt: Identifier });
export const CaseKw = createToken({ name: 'CaseKw', pattern: /CASE/i, longer_alt: Identifier });
export const WhenKw = createToken({ name: 'WhenKw', pattern: /WHEN/i, longer_alt: Identifier });
export const ThenKw = createToken({ name: 'ThenKw', pattern: /THEN/i, longer_alt: Identifier });
export const ElseKw = createToken({ name: 'ElseKw', pattern: /ELSE/i, longer_alt: Identifier });
export const EndKw = createToken({ name: 'EndKw', pattern: /END/i, longer_alt: Identifier });
export const JoinKw = createToken({ name: 'JoinKw', pattern: /JOIN/i, longer_alt: Identifier });
export const InnerKw = createToken({ name: 'InnerKw', pattern: /INNER/i, longer_alt: Identifier });
export const LeftKw = createToken({ name: 'LeftKw', pattern: /LEFT/i, longer_alt: Identifier });

// ---------------------------------------------------------------------------
// Literal tokens
// ---------------------------------------------------------------------------

export const NumericLiteral = createToken({
    name: 'NumericLiteral',
    pattern: /[0-9]+/
});

export const StringLiteral = createToken({
    name: 'StringLiteral',
    pattern: /'(?:[^'\\]|\\.)*'/
});

// ---------------------------------------------------------------------------
// Punctuation
//
// Multi-character operators must be declared before single-character operators
// that share the same leading character:
//   '<>' and '<=' before '<'
//   '>=' before '>'
// ---------------------------------------------------------------------------

export const NotEq = createToken({ name: 'NotEq', pattern: /<>/ });
export const LtEq = createToken({ name: 'LtEq', pattern: /<=/ });
export const GtEq = createToken({ name: 'GtEq', pattern: />=/ });
export const LParen = createToken({ name: 'LParen', pattern: /\(/ });
export const RParen = createToken({ name: 'RParen', pattern: /\)/ });
export const Comma = createToken({ name: 'Comma', pattern: /,/ });
export const Semicolon = createToken({ name: 'Semicolon', pattern: /;/ });
export const Dot = createToken({ name: 'Dot', pattern: /\./ });
export const Plus = createToken({ name: 'Plus', pattern: /\+/ });
export const Minus = createToken({ name: 'Minus', pattern: /-/ });
export const Star = createToken({ name: 'Star', pattern: /\*/ });
export const Slash = createToken({ name: 'Slash', pattern: /\// });
export const Eq = createToken({ name: 'Eq', pattern: /=/ });
export const Lt = createToken({ name: 'Lt', pattern: /</ });
export const Gt = createToken({ name: 'Gt', pattern: />/ });

// ---------------------------------------------------------------------------
// allTokens — ordered array passed to the Lexer constructor.
//
// Critical ordering constraints:
//  1. Skip tokens first (BlockComment, LineComment, WhiteSpace).
//  2. All keyword tokens before QuotedIdentifier and Identifier (catch-alls);
//     keywords have longer_alt: Identifier so they take priority over
//     the catch-all when the entire word is a known keyword.
//  3. QuotedIdentifier before Identifier.
//  4. NumericLiteral after all keyword/identifier tokens (digits never
//     start identifiers or keywords).
//  5. Multi-character punctuation before single-character sharing a prefix:
//       '<>' and '<=' before '<';  '>=' before '>'.
// ---------------------------------------------------------------------------

export const allTokens: TokenType[] = [
    // Skip
    BlockComment,
    LineComment,
    WhiteSpace,
    // Sequence DDL keywords
    SequenceKw,
    IncrementKw,
    ByKw,
    StartKw,
    WithKw,
    MinvalueKw,
    MaxvalueKw,
    NotKw, // before NoKw — 'NOT' is a prefix-conflict with 'NO'
    NoKw,
    CycleKw,
    ResetKw,
    DependsKw,
    OnKw,
    // SQL clause / function keywords (for RESET BY SELECT body)
    SelectKw,
    FromKw,
    WhereKw,
    IfnullKw,
    CoalesceKw,
    NvlKw,
    MaxKw,
    MinKw,
    CountKw,
    SumKw,
    AndKw,
    OrKw,
    IsKw,
    NullKw,
    CaseKw,
    WhenKw,
    ThenKw,
    ElseKw,
    EndKw,
    JoinKw,
    InnerKw,
    LeftKw,
    // Identifiers — catch-all, after all keywords
    QuotedIdentifier,
    Identifier,
    // Literals
    NumericLiteral,
    StringLiteral,
    // Punctuation — multi-char operators before single-char sharing a prefix
    NotEq, // '<>' before '<'
    LtEq, // '<=' before '<'
    GtEq, // '>=' before '>'
    LParen,
    RParen,
    Comma,
    Semicolon,
    Dot,
    Plus,
    Minus,
    Star,
    Slash,
    Eq,
    Lt,
    Gt
];

// ---------------------------------------------------------------------------
// Singleton Lexer instance — instantiated once at module load time per
// Chevrotain best practices (NFR-3).
// ---------------------------------------------------------------------------

export const HdbSequenceLexer = new Lexer(allTokens);
