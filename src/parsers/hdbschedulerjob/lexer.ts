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
    // Matches // single-line comments used in HANA JSON config files.
    // The -- style is not applicable to JSON-format files.
    pattern: /\/\/[^\r\n]*/,
    group: Lexer.SKIPPED
});

export const WhiteSpace = createToken({
    name: 'WhiteSpace',
    pattern: /\s+/,
    group: Lexer.SKIPPED
});

// ---------------------------------------------------------------------------
// ActionKey — declared before JsonString so that the literal string "action"
// (including surrounding double-quotes) is always tokenised as ActionKey and
// never consumed by the generic JsonString pattern.
// ---------------------------------------------------------------------------

export const ActionKey = createToken({
    name: 'ActionKey',
    pattern: /"action"/
});

// ---------------------------------------------------------------------------
// String token — standard JSON string with full escape-sequence support.
// ---------------------------------------------------------------------------

export const JsonString = createToken({
    name: 'JsonString',
    // Matches a JSON string: opening ", then zero-or-more of either a
    // non-special character or a two-character escape sequence, then closing ".
    pattern: /"(?:[^"\\]|\\.)*"/
});

// ---------------------------------------------------------------------------
// Number token — full JSON number syntax (integer, decimal, exponent).
// ---------------------------------------------------------------------------

export const JsonNumber = createToken({
    name: 'JsonNumber',
    pattern: /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/
});

// ---------------------------------------------------------------------------
// JSON keyword value tokens (true / false / null).
// ---------------------------------------------------------------------------

export const TrueKw = createToken({ name: 'TrueKw', pattern: /true/ });
export const FalseKw = createToken({ name: 'FalseKw', pattern: /false/ });
export const NullKw = createToken({ name: 'NullKw', pattern: /null/ });

// ---------------------------------------------------------------------------
// Structural punctuation tokens.
// ---------------------------------------------------------------------------

export const LBrace = createToken({ name: 'LBrace', pattern: /\{/ });
export const RBrace = createToken({ name: 'RBrace', pattern: /\}/ });
export const LBracket = createToken({ name: 'LBracket', pattern: /\[/ });
export const RBracket = createToken({ name: 'RBracket', pattern: /]/ });
export const Colon = createToken({ name: 'Colon', pattern: /:/ });
export const Comma = createToken({ name: 'Comma', pattern: /,/ });

// ---------------------------------------------------------------------------
// allTokens — order is significant for Chevrotain's longest-match resolution.
//
// 1. Skip tokens first (consumed before anything else).
// 2. ActionKey before JsonString (prevents "action" from matching JsonString).
// 3. JsonString before JsonNumber (prevents a quoted number from being split).
// 4. Keyword value tokens (TrueKw, FalseKw, NullKw) after string/number.
// 5. Structural punctuation last.
// ---------------------------------------------------------------------------

export const allTokens: TokenType[] = [
    // Skip
    BlockComment,
    LineComment,
    WhiteSpace,
    // Key token — before JsonString to take priority when input is "action"
    ActionKey,
    // String and number literals
    JsonString,
    JsonNumber,
    // JSON keyword values
    TrueKw,
    FalseKw,
    NullKw,
    // Structural punctuation
    LBrace,
    RBrace,
    LBracket,
    RBracket,
    Colon,
    Comma
];

/**
 * Singleton Chevrotain Lexer for `.hdbschedulerjob` files.
 *
 * Instantiated once at module load time per Chevrotain best practices.
 * Reused across every `extractSchedulerJobAction()` call.
 */
export const HdbSchedulerJobLexer = new Lexer(allTokens);
