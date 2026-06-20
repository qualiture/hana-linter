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
// that start with a keyword prefix (e.g. INDEX_NAME, ON_CHANGE, ASC_SORT,
// INVERTED_FLAG, VALUE_MAP, HASH_KEY) are not split at the keyword boundary.
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
// DDL keyword tokens (all with longer_alt: Identifier)
// ---------------------------------------------------------------------------

export const CreateKw = createToken({ name: 'CreateKw', pattern: /CREATE/i, longer_alt: Identifier });
export const UniqueKw = createToken({ name: 'UniqueKw', pattern: /UNIQUE/i, longer_alt: Identifier });
export const IndexKw = createToken({ name: 'IndexKw', pattern: /INDEX/i, longer_alt: Identifier });
export const OnKw = createToken({ name: 'OnKw', pattern: /ON/i, longer_alt: Identifier });
export const AscKw = createToken({ name: 'AscKw', pattern: /ASC/i, longer_alt: Identifier });
export const DescKw = createToken({ name: 'DescKw', pattern: /DESC/i, longer_alt: Identifier });

// ---------------------------------------------------------------------------
// Index-type keyword tokens (all with longer_alt: Identifier)
// ---------------------------------------------------------------------------

export const BtreeKw = createToken({ name: 'BtreeKw', pattern: /BTREE/i, longer_alt: Identifier });
export const CpbtreeKw = createToken({ name: 'CpbtreeKw', pattern: /CPBTREE/i, longer_alt: Identifier });
export const InvertedKw = createToken({ name: 'InvertedKw', pattern: /INVERTED/i, longer_alt: Identifier });
export const HashKw = createToken({ name: 'HashKw', pattern: /HASH/i, longer_alt: Identifier });
export const ValueKw = createToken({ name: 'ValueKw', pattern: /VALUE/i, longer_alt: Identifier });
export const IndividualKw = createToken({ name: 'IndividualKw', pattern: /INDIVIDUAL/i, longer_alt: Identifier });

// ---------------------------------------------------------------------------
// Punctuation tokens
// ---------------------------------------------------------------------------

export const LParen = createToken({ name: 'LParen', pattern: /\(/ });
export const RParen = createToken({ name: 'RParen', pattern: /\)/ });
export const Comma = createToken({ name: 'Comma', pattern: /,/ });
export const Semicolon = createToken({ name: 'Semicolon', pattern: /;/ });
export const Dot = createToken({ name: 'Dot', pattern: /\./ });

// ---------------------------------------------------------------------------
// allTokens — order is significant for Chevrotain's longest-match resolution.
//
// 1. Skip tokens first (consumed before anything else).
// 2. Keywords before Identifier/QuotedIdentifier: each keyword token declares
//    longer_alt: Identifier, so when Identifier matches a longer string (e.g.
//    INDEX_NAME matches 10 chars vs INDEX's 5), Identifier wins. Keywords must
//    still precede Identifier in allTokens so Chevrotain's position-based
//    priority picks the keyword for exact matches like INDEX, CREATE, ON, etc.
// 3. QuotedIdentifier before Identifier — both are catch-alls; QuotedIdentifier
//    is declared first so a "..." sequence is not split by Identifier.
// 4. Punctuation last.
// ---------------------------------------------------------------------------

export const allTokens: TokenType[] = [
    // Skip
    BlockComment,
    LineComment,
    WhiteSpace,
    // DDL keywords (before Identifier so exact matches are captured)
    CreateKw,
    UniqueKw,
    IndexKw,
    OnKw,
    AscKw,
    DescKw,
    // Index-type keywords
    BtreeKw,
    CpbtreeKw,
    InvertedKw,
    HashKw,
    ValueKw,
    IndividualKw,
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
 * Singleton Chevrotain Lexer for `.hdbindex` DDL files.
 * Instantiated once at module load time per Chevrotain best practices.
 */
export const HdbIndexLexer = new Lexer(allTokens);
