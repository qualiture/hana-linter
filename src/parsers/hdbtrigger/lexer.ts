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
// Literals — declared before keywords so quoted/numeric content is not split.
// ---------------------------------------------------------------------------

export const StringLiteral = createToken({
    name: 'StringLiteral',
    pattern: /'(?:[^'\\]|\\.)*'/
});

export const NumericLiteral = createToken({
    name: 'NumericLiteral',
    pattern: /[0-9]+(?:\.[0-9]+)?/
});

// ---------------------------------------------------------------------------
// Identifier — defined before keyword tokens so keyword tokens can reference
// it via longer_alt.  All keyword tokens must declare longer_alt: Identifier
// so that identifiers that *start* with a keyword prefix (e.g. TRIGGER_NAME,
// BEFORE_DATE, INSERT_FLAG, INSTEAD_OF_LOOKUP, REFERENCING_TABLE,
// STATEMENT_ID, ON_CHANGE) are not split at the keyword boundary.
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
// Trigger DDL keyword tokens (all with longer_alt: Identifier)
//
// Prefix-conflict notes:
//   INSERT (/INSERT/i) vs INSTEAD (/INSTEAD/i) — no shared prefix conflict:
//     INSERT = I-N-S-E-R-T, INSTEAD = I-N-S-T-E-A-D (diverge at char 4).
//   No other keyword pairs share a common prefix among the tokens defined here.
// ---------------------------------------------------------------------------

export const CreateKw = createToken({ name: 'CreateKw', pattern: /CREATE/i, longer_alt: Identifier });
export const TriggerKw = createToken({ name: 'TriggerKw', pattern: /TRIGGER/i, longer_alt: Identifier });
export const BeforeKw = createToken({ name: 'BeforeKw', pattern: /BEFORE/i, longer_alt: Identifier });
export const AfterKw = createToken({ name: 'AfterKw', pattern: /AFTER/i, longer_alt: Identifier });
export const InsteadKw = createToken({ name: 'InsteadKw', pattern: /INSTEAD/i, longer_alt: Identifier });
export const OfKw = createToken({ name: 'OfKw', pattern: /OF/i, longer_alt: Identifier });
export const InsertKw = createToken({ name: 'InsertKw', pattern: /INSERT/i, longer_alt: Identifier });
export const UpdateKw = createToken({ name: 'UpdateKw', pattern: /UPDATE/i, longer_alt: Identifier });
export const DeleteKw = createToken({ name: 'DeleteKw', pattern: /DELETE/i, longer_alt: Identifier });
export const OnKw = createToken({ name: 'OnKw', pattern: /ON/i, longer_alt: Identifier });
export const ReferencingKw = createToken({ name: 'ReferencingKw', pattern: /REFERENCING/i, longer_alt: Identifier });
export const OldKw = createToken({ name: 'OldKw', pattern: /OLD/i, longer_alt: Identifier });
export const NewKw = createToken({ name: 'NewKw', pattern: /NEW/i, longer_alt: Identifier });
export const RowKw = createToken({ name: 'RowKw', pattern: /ROW/i, longer_alt: Identifier });
export const TableKw = createToken({ name: 'TableKw', pattern: /TABLE/i, longer_alt: Identifier });
export const AsKw = createToken({ name: 'AsKw', pattern: /AS/i, longer_alt: Identifier });
export const ForKw = createToken({ name: 'ForKw', pattern: /FOR/i, longer_alt: Identifier });
export const EachKw = createToken({ name: 'EachKw', pattern: /EACH/i, longer_alt: Identifier });
export const StatementKw = createToken({ name: 'StatementKw', pattern: /STATEMENT/i, longer_alt: Identifier });
export const WhenKw = createToken({ name: 'WhenKw', pattern: /WHEN/i, longer_alt: Identifier });
export const BeginKw = createToken({ name: 'BeginKw', pattern: /BEGIN/i, longer_alt: Identifier });
export const EndKw = createToken({ name: 'EndKw', pattern: /END/i, longer_alt: Identifier });

// ---------------------------------------------------------------------------
// Punctuation tokens
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
//  1. Skip tokens first (consumed before anything else).
//  2. Literals before keywords (avoids partial matches on quoted/numeric text).
//  3. All keyword tokens before QuotedIdentifier and Identifier.
//     Each keyword declares longer_alt: Identifier — when an identifier is
//     strictly longer than the keyword match (e.g. TRIGGER_NAME vs TRIGGER),
//     the Identifier token wins.
//  4. QuotedIdentifier before Identifier.
//  5. Punctuation last.
// ---------------------------------------------------------------------------

export const allTokens: TokenType[] = [
    // Skip
    BlockComment,
    LineComment,
    WhiteSpace,
    // Literals (before keywords and identifiers)
    StringLiteral,
    NumericLiteral,
    // Keywords (before Identifier so exact matches are captured by the keyword token)
    CreateKw,
    TriggerKw,
    BeforeKw,
    AfterKw,
    InsteadKw,
    OfKw,
    InsertKw,
    UpdateKw,
    DeleteKw,
    OnKw,
    ReferencingKw,
    OldKw,
    NewKw,
    RowKw,
    TableKw,
    AsKw,
    ForKw,
    EachKw,
    StatementKw,
    WhenKw,
    BeginKw,
    EndKw,
    // Identifiers — catch-alls after all keywords
    QuotedIdentifier,
    Identifier,
    // Punctuation
    LParen,
    RParen,
    Comma,
    Semicolon,
    Dot
];

/**
 * Singleton Chevrotain Lexer for `.hdbtrigger` DDL files.
 * Instantiated once at module load time per Chevrotain best practices.
 */
export const HdbTriggerLexer: Lexer = new Lexer(allTokens);
