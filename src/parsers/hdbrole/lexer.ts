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
// that *start* with a keyword (e.g. CATALOG_ID, ROLE_ADMIN) are not split.
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
// Role DSL keyword tokens
//
// Prefix-conflict ordering rule:
//   ROLES before ROLE — ROLE is a proper prefix of ROLES.
//   In allTokens, Roles is placed before RoleKw so that input "ROLES" is
//   matched by the longer Roles token first.  Both tokens declare
//   longer_alt: Identifier to fall back for identifiers starting with these
//   strings (e.g. ROLES_LIST, ROLE_ADMIN).
// ---------------------------------------------------------------------------

export const Roles = createToken({ name: 'Roles', pattern: /ROLES/i, longer_alt: Identifier });
export const RoleKw = createToken({ name: 'RoleKw', pattern: /ROLE/i, longer_alt: Identifier });
export const Extends = createToken({ name: 'Extends', pattern: /EXTENDS/i, longer_alt: Identifier });

// ---------------------------------------------------------------------------
// Privilege clause keyword tokens
// ---------------------------------------------------------------------------

export const Catalog = createToken({ name: 'Catalog', pattern: /CATALOG/i, longer_alt: Identifier });
export const Schema = createToken({ name: 'Schema', pattern: /SCHEMA/i, longer_alt: Identifier });
export const Sql = createToken({ name: 'Sql', pattern: /SQL/i, longer_alt: Identifier });
export const Object = createToken({ name: 'Object', pattern: /OBJECT/i, longer_alt: Identifier });
export const Package = createToken({ name: 'Package', pattern: /PACKAGE/i, longer_alt: Identifier });
export const Application = createToken({ name: 'Application', pattern: /APPLICATION/i, longer_alt: Identifier });
export const Privilege = createToken({ name: 'Privilege', pattern: /PRIVILEGE/i, longer_alt: Identifier });

// ---------------------------------------------------------------------------
// Privilege type keyword tokens — consumed in privilegeList but never
// extracted as role subjects.
// ---------------------------------------------------------------------------

export const Select = createToken({ name: 'Select', pattern: /SELECT/i, longer_alt: Identifier });
export const Insert = createToken({ name: 'Insert', pattern: /INSERT/i, longer_alt: Identifier });
export const Update = createToken({ name: 'Update', pattern: /UPDATE/i, longer_alt: Identifier });
export const Delete = createToken({ name: 'Delete', pattern: /DELETE/i, longer_alt: Identifier });
export const Execute = createToken({ name: 'Execute', pattern: /EXECUTE/i, longer_alt: Identifier });
export const Create = createToken({ name: 'Create', pattern: /CREATE/i, longer_alt: Identifier });
export const Alter = createToken({ name: 'Alter', pattern: /ALTER/i, longer_alt: Identifier });
export const Drop = createToken({ name: 'Drop', pattern: /DROP/i, longer_alt: Identifier });
export const IndexKw = createToken({ name: 'IndexKw', pattern: /INDEX/i, longer_alt: Identifier });
export const Trigger = createToken({ name: 'Trigger', pattern: /TRIGGER/i, longer_alt: Identifier });
export const References = createToken({ name: 'References', pattern: /REFERENCES/i, longer_alt: Identifier });
export const Debug = createToken({ name: 'Debug', pattern: /DEBUG/i, longer_alt: Identifier });
export const Any = createToken({ name: 'Any', pattern: /ANY/i, longer_alt: Identifier });

// ---------------------------------------------------------------------------
// Punctuation
//
// ColonColon ('::') must be declared before Colon (':') so that the
// two-character sequence '::' wins over two consecutive single-colon tokens.
// ---------------------------------------------------------------------------

export const ColonColon = createToken({ name: 'ColonColon', pattern: /::/ });
export const Colon = createToken({ name: 'Colon', pattern: /:/ });
export const LBrace = createToken({ name: 'LBrace', pattern: /{/ });
export const RBrace = createToken({ name: 'RBrace', pattern: /}/ });
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
//  2. Keyword tokens with a shared prefix: longer keyword declared first.
//     - Roles before RoleKw (ROLES prefix group)
//  3. All keyword tokens before QuotedIdentifier and Identifier (catch-alls).
//  4. QuotedIdentifier before Identifier.
//  5. ColonColon ('::') before Colon (':') — multi-char before single-char.
// ---------------------------------------------------------------------------

export const allTokens: TokenType[] = [
    // Skip
    BlockComment,
    LineComment,
    WhiteSpace,
    // Role DSL keywords — ROLES-prefix group: longer token first
    Roles,
    RoleKw,
    Extends,
    // Privilege clause keywords
    Catalog,
    Schema,
    Sql,
    Object,
    Package,
    Application,
    Privilege,
    // Privilege type keywords
    Select,
    Insert,
    Update,
    Delete,
    Execute,
    Create,
    Alter,
    Drop,
    IndexKw,
    Trigger,
    References,
    Debug,
    Any,
    // Identifiers — catch-all, after all keywords
    QuotedIdentifier,
    Identifier,
    // Punctuation — multi-char before single-char sharing a prefix
    ColonColon, // '::' before ':'
    Colon,
    LBrace,
    RBrace,
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
export const HdbRoleLexer = new Lexer(allTokens);
