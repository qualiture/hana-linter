# Technical Design Specification: Chevrotain Lexer/Parser for `.hdbrole`

**PRD**: [prd.md](./prd.md)  
**Feature**: Chevrotain `.hdbrole` Role & Granted-Role Name Extractor  
**Status**: Ready for Implementation

---

## 1. System Architecture Overview

### Current state

`extractSubjects()` in `src/content-lint.ts` has no handler for `.hdbrole` files; the function falls through to `return []`, silently producing no subjects regardless of any configured `contentRuleSets`.

```
content-lint.ts
  └── extractSubjects()
        ├── '.hdbtable'       → extractTableColumns()
        ├── '.hdbview'        → extractViewColumns()
        ├── '.hdbprocedure'   → extractProcedureParameters()
        ├── '.hdbfunction'    → extractFunctionParameters()
        ├── '.hdbtabletype'   → extractTableTypeColumns()
        └── (default)         → []   ← .hdbrole falls here
```

### Target state

A new `src/parsers/hdbrole/` sub-module mirrors the structure of all prior `.hdb*` parser modules. `extractSubjects()` gains a `.hdbrole` branch that delegates to the new module's public function. Two new `ContentTarget` literal values — `'roleName'` and `'grantedRoleName'` — are added to the shared type union.

```
content-lint.ts
  └── extractSubjects()
        ├── '.hdbtable'       → extractTableColumns()
        ├── '.hdbview'        → extractViewColumns()
        ├── '.hdbprocedure'   → extractProcedureParameters()
        ├── '.hdbfunction'    → extractFunctionParameters()
        ├── '.hdbtabletype'   → extractTableTypeColumns()
        └── '.hdbrole'        → extractRoleNames()   ← NEW

src/parsers/hdbrole/
  ├── lexer.ts      Token definitions + singleton Lexer instance
  ├── parser.ts     CstParser subclass + grammar rules
  ├── visitor.ts    CST visitor that collects role and granted-role names
  └── index.ts      Public API: extractRoleNames()
```

Everything above `extractSubjects()` — `lintFileContent()`, `runLint()`, and the public `src/index.ts` entry point — is unchanged. The type changes in `src/types/rules.ts` and `src/types/issues.ts` are purely additive.

---

## 2. Technology Stack

| Concern          | Choice                 | Rationale                                                  |
| ---------------- | ---------------------- | ---------------------------------------------------------- |
| Parser framework | **Chevrotain** (v11.x) | Already a `dependencies` entry; no new dependency required |
| Language         | TypeScript (existing)  | Matches the project                                        |
| Build            | `tsc` (existing)       | No additional build tooling needed                         |
| Runtime          | Node.js (existing)     | No change                                                  |

No new `npm install` step is needed. `chevrotain` is already present in `package.json` as a production dependency.

---

## 3. Component Design

### 3.1 File layout

```
src/
  parsers/
    hdbrole/
      lexer.ts
      parser.ts
      visitor.ts
      index.ts
      __tests__/
        extractRoleNames.test.ts
```

### 3.2 `src/parsers/hdbrole/lexer.ts`

#### Responsibility

Define every token the grammar needs and export a singleton `Lexer` instance.

#### Token ordering rules (Chevrotain-specific)

1. Skip tokens (`BlockComment`, `LineComment`, `WhiteSpace`) must be declared first.
2. The `ColonColon` (`::`) token must be declared **before** `Colon` (`:`) — both are punctuation, and `::` (2 chars) must win over two consecutive `:` (1 char) via maximal munch priority.
3. `Identifier` must be defined early (before keyword tokens) so that keyword tokens can reference it via `longer_alt`.
4. All keyword tokens must declare `longer_alt: Identifier` (or a chain) so identifiers that start with a keyword substring are not split at the keyword boundary.
5. The `Roles` keyword token must be declared **before** `RoleKw` in the `allTokens` array, because `ROLE` is a proper prefix of `ROLES`. Additionally, `RoleKw` must declare `longer_alt: [Roles, Identifier]` (chained) so that the input `ROLES` is recognised as the `Roles` token and the input `ROLE_MANAGER` falls back to `Identifier`.
6. `QuotedIdentifier` must appear before `Identifier` in `allTokens`.
7. Multi-character punctuation (`ColonColon`, `NotEqual`-style) must appear before single-character variants that share a leading character.

#### Prefix-conflict pairs requiring explicit ordering

| Longer token | Shorter token | Ordering constraint                                                              |
| ------------ | ------------- | -------------------------------------------------------------------------------- |
| `Roles`      | `RoleKw`      | Declare `Roles` before `RoleKw`; `RoleKw` uses `longer_alt: [Roles, Identifier]` |
| `ColonColon` | `Colon`       | Declare `ColonColon` before `Colon` in `allTokens`                               |

No other prefix conflicts exist in this token catalogue (all remaining keyword pairs diverge before one becomes a prefix of another).

#### Token catalogue

**Skip tokens** (declared first):

| Token name     | Pattern              | Mode                       |
| -------------- | -------------------- | -------------------------- |
| `BlockComment` | `/\/\*[\s\S]*?\*\//` | `{ group: Lexer.SKIPPED }` |
| `LineComment`  | `/--[^\r\n]*/`       | `{ group: Lexer.SKIPPED }` |
| `WhiteSpace`   | `/\s+/`              | `{ group: Lexer.SKIPPED }` |

**Identifier** (defined before keywords, referenced by `longer_alt`):

| Token name         | Pattern                    | Notes                                          |
| ------------------ | -------------------------- | ---------------------------------------------- |
| `Identifier`       | `/[A-Za-z_][A-Za-z0-9_]*/` | Catch-all; all keyword tokens use `longer_alt` |
| `QuotedIdentifier` | `/"[^"]*"/`                | Declared before `Identifier` in `allTokens`    |

**Role DSL keyword tokens** (all declare `longer_alt: Identifier` unless noted):

| Token name | Pattern      | Notes                                                                  |
| ---------- | ------------ | ---------------------------------------------------------------------- |
| `Roles`    | `/ROLES/i`   | Declared before `RoleKw`; `longer_alt: Identifier`                     |
| `RoleKw`   | `/ROLE/i`    | `longer_alt: [Roles, Identifier]` (chained — `ROLES` wins over `ROLE`) |
| `Extends`  | `/EXTENDS/i` | `longer_alt: Identifier`                                               |

**Privilege clause keyword tokens** (all declare `longer_alt: Identifier`):

| Token name    | Pattern          | Notes |
| ------------- | ---------------- | ----- |
| `Catalog`     | `/CATALOG/i`     |       |
| `Schema`      | `/SCHEMA/i`      |       |
| `Sql`         | `/SQL/i`         |       |
| `Object`      | `/OBJECT/i`      |       |
| `Package`     | `/PACKAGE/i`     |       |
| `Application` | `/APPLICATION/i` |       |
| `Privilege`   | `/PRIVILEGE/i`   |       |

**Privilege type keyword tokens** (consumed in `privilegeList`; all declare `longer_alt: Identifier`):

| Token name   | Pattern         | Notes |
| ------------ | --------------- | ----- |
| `Select`     | `/SELECT/i`     |       |
| `Insert`     | `/INSERT/i`     |       |
| `Update`     | `/UPDATE/i`     |       |
| `Delete`     | `/DELETE/i`     |       |
| `Execute`    | `/EXECUTE/i`    |       |
| `Create`     | `/CREATE/i`     |       |
| `Alter`      | `/ALTER/i`      |       |
| `Drop`       | `/DROP/i`       |       |
| `IndexKw`    | `/INDEX/i`      |       |
| `Trigger`    | `/TRIGGER/i`    |       |
| `References` | `/REFERENCES/i` |       |
| `Debug`      | `/DEBUG/i`      |       |
| `Any`        | `/ANY/i`        |       |

**Punctuation tokens**:

| Token name   | Pattern | Notes                                                      |
| ------------ | ------- | ---------------------------------------------------------- |
| `ColonColon` | `::`    | Declared **before** `Colon`; matches 2-char `::` separator |
| `Colon`      | `:`     | Single-colon separator in privilege clauses                |
| `LBrace`     | `{`     |                                                            |
| `RBrace`     | `}`     |                                                            |
| `LParen`     | `(`     | Not in current `.hdbrole` DSL but required for recovery    |
| `RParen`     | `)`     | Not in current `.hdbrole` DSL but required for recovery    |
| `Comma`      | `,`     |                                                            |
| `Semicolon`  | `;`     |                                                            |
| `Dot`        | `.`     | Package path separator in qualified names                  |

#### `allTokens` array ordering (summary)

```
[
  // Skip
  BlockComment, LineComment, WhiteSpace,
  // Identifiers (declared early for longer_alt references)
  Identifier, QuotedIdentifier,
  // Role DSL keywords — Roles before RoleKw (prefix conflict)
  Roles, RoleKw, Extends,
  // Privilege clause keywords
  Catalog, Schema, Sql, Object, Package, Application, Privilege,
  // Privilege type keywords
  Select, Insert, Update, Delete, Execute,
  Create, Alter, Drop, IndexKw, Trigger, References, Debug, Any,
  // Multi-char punctuation before single-char sharing a leading char
  ColonColon,   // '::' before ':'
  // Remaining punctuation
  Colon, LBrace, RBrace, LParen, RParen, Comma, Semicolon, Dot
]
```

#### Exported symbols

```typescript
export const allTokens: TokenType[];
export const HdbRoleLexer: Lexer; // singleton — instantiated at module load
```

---

### 3.3 `src/parsers/hdbrole/parser.ts`

#### Responsibility

Define the grammar as a `CstParser` subclass. Expose a singleton parser instance.

#### Grammar notation

> `?` = optional, `*` = zero-or-more, `+` = one-or-more, `|` = alternation, `()` = grouping.

#### Grammar rules

```
roleDefinition
    RoleKw roleName
    (Extends Roles LBrace grantedRoleList RBrace)?
    LBrace privilegeClause* RBrace

roleName
    // Branch 1: unquoted identifier path, optionally package-qualified
    Identifier (Dot Identifier)* (ColonColon (Identifier | QuotedIdentifier))?
    // Branch 2: leading quoted identifier (plain quoted name only)
    | QuotedIdentifier

grantedRoleList
    grantedRoleName (Comma grantedRoleName)*

grantedRoleName
    // Same shape as roleName — re-uses identical rule body
    Identifier (Dot Identifier)* (ColonColon (Identifier | QuotedIdentifier))?
    | QuotedIdentifier

privilegeClause
    catalogSchemaPrivilege
    | catalogObjectPrivilege
    | catalogPackagePrivilege
    | applicationPrivilege

catalogSchemaPrivilege
    Catalog Schema quotedOrUnquotedIdentifier Colon privilegeList Semicolon?

catalogObjectPrivilege
    Catalog Sql Object
    quotedOrUnquotedIdentifier Dot quotedOrUnquotedIdentifier
    Colon privilegeList Semicolon?

catalogPackagePrivilege
    Catalog Package quotedOrUnquotedIdentifier Colon privilegeList Semicolon?

applicationPrivilege
    Application Privilege Colon applicationPrivilegeName Semicolon?

applicationPrivilegeName
    // Package-qualified application privilege name, or plain identifier
    Identifier (Dot Identifier)* (ColonColon (Identifier | QuotedIdentifier))?
    | QuotedIdentifier

privilegeList
    privilegeKeyword (Comma privilegeKeyword)*

privilegeKeyword
    Select | Insert | Update | Delete | Execute
    | Create | Alter | Drop | IndexKw | Trigger | References | Debug | Any

quotedOrUnquotedIdentifier
    QuotedIdentifier | Identifier
```

#### Key disambiguation: `roleName` — leading-quoted vs leading-unquoted

The two `roleName` alternatives have disjoint `FIRST` sets:

| Alternative | First token        |
| ----------- | ------------------ |
| Branch 1    | `Identifier`       |
| Branch 2    | `QuotedIdentifier` |

Chevrotain resolves this with LL(1) lookahead — no `GATE` predicate or backtracking needed.

#### Key disambiguation: `privilegeClause` alternatives

| Alternative               | First token   | Second token (LA-2) |
| ------------------------- | ------------- | ------------------- |
| `catalogSchemaPrivilege`  | `Catalog`     | `Schema`            |
| `catalogObjectPrivilege`  | `Catalog`     | `Sql`               |
| `catalogPackagePrivilege` | `Catalog`     | `Package`           |
| `applicationPrivilege`    | `Application` | —                   |

`Application` vs `Catalog` is LL(1). Among the three `Catalog`-prefix alternatives, LL(2) is sufficient. Chevrotain's default `k` value covers this automatically.

#### Key design: `roleName` package-path ambiguity

Both `Branch 1` alternatives start with `Identifier`. The disambiguation issue is: does a trailing `(Dot Identifier)*` consume package-path segments, or should it stop before consuming tokens that belong to the next grammar rule?

- After `roleName` in `roleDefinition`, the following token is either `Extends`, `LBrace`, or end-of-input.
- After `grantedRoleName` in `grantedRoleList`, the following token is either `Comma` or `RBrace`.

Neither `Dot` nor `ColonColon` appears as a follow token for `roleName` or `grantedRoleName`, so the `MANY: (Dot Identifier)` loop terminates correctly via Chevrotain's automatic follow-set computation (LL(k) stop condition).

#### Error recovery

Use Chevrotain's default single-token insertion/deletion recovery. Do **not** override recovery methods — the defaults return partial CSTs rather than throwing exceptions, which satisfies AC-11.

#### Exported symbols

```typescript
export class HdbRoleParser extends CstParser { ... }
export const hdbRoleParser: HdbRoleParser; // singleton
```

---

### 3.4 `src/parsers/hdbrole/visitor.ts`

#### Responsibility

Walk the CST produced by `HdbRoleParser` and collect:

1. The role name defined by the file → `{ type: 'roleName', name }` (exactly one)
2. Each inherited role name from `extends roles { ... }` → `{ type: 'grantedRoleName', name }` (zero or more)

Privilege body content is never extracted.

#### Extraction strategy

```
visit roleDefinition:
    1. Extract roleName from CST node → push { type: 'roleName', name }
    2. If grantedRoleList CST node present:
           for each grantedRoleName child:
               extract name → push { type: 'grantedRoleName', name }
    3. Do NOT visit privilegeClause nodes (override to no-op)
```

#### Implementation detail: reconstructing a qualified name from CST children

Both `roleName` and `grantedRoleName` rules produce a CST node with children keyed by token type name:

| Key in `ctx`       | Contents                                                         |
| ------------------ | ---------------------------------------------------------------- |
| `Identifier`       | Array of all `Identifier` tokens consumed (package segs + local) |
| `QuotedIdentifier` | Array containing the quoted token if present                     |
| `ColonColon`       | Array containing the `::` token if present                       |
| `Dot`              | Array of all `.` tokens separating package segments              |

To reconstruct the full name string, collect all these token images, sort them by `startOffset`, and concatenate:

```typescript
private reconstructRoleName(ctx: CstChildrenDictionary): string {
    const identifiers   = (ctx['Identifier']       as IToken[] | undefined) ?? [];
    const quotedIdents  = (ctx['QuotedIdentifier'] as IToken[] | undefined) ?? [];
    const colonColons   = (ctx['ColonColon']        as IToken[] | undefined) ?? [];
    const dots          = (ctx['Dot']               as IToken[] | undefined) ?? [];

    // Plain quoted name: "AdminRole" → AdminRole
    if (quotedIdents.length > 0 && identifiers.length === 0 && colonColons.length === 0) {
        return quotedIdents[0].image.slice(1, -1);
    }

    if (identifiers.length === 0) return '';

    // Plain unquoted name with no package path: AdminRole
    if (colonColons.length === 0 && dots.length === 0) {
        return identifiers[0].image;
    }

    // Package-qualified: sort all token images by startOffset, join
    const parts: Array<{ offset: number; image: string }> = [
        ...identifiers.map(t => ({ offset: t.startOffset, image: t.image })),
        ...quotedIdents.map(t => ({ offset: t.startOffset, image: t.image.slice(1, -1) })),
        ...colonColons.map(t => ({ offset: t.startOffset, image: '::' })),
        ...dots.map(t => ({ offset: t.startOffset, image: '.' })),
    ];
    parts.sort((a, b) => a.offset - b.offset);
    return parts.map(p => p.image).join('');
}
```

This correctly handles all three name forms:

- `com.example.app::AdminRole` → `['com', '.', 'example', '.', 'app', '::', 'AdminRole']` → `com.example.app::AdminRole`
- `AdminRole` → `['AdminRole']` → `AdminRole`
- `"AdminRole"` → strip quotes → `AdminRole`

And handles the mixed case `com.example.app::"AdminRole"` (quoted local segment after `::`) by stripping quotes from the `QuotedIdentifier` token in the sorted sequence.

#### Implementation detail: suppressing privilege clause extraction

The visitor extends `BaseCstVisitorWithDefaults`. The default base class auto-visits all child `CstNode` elements. Override all `privilegeClause` rule methods to perform **no action** (no super call, no child visit):

```typescript
catalogSchemaPrivilege(_ctx: CstChildrenDictionary): void {
    // Intentionally empty — privilege body is not extracted.
}

catalogObjectPrivilege(_ctx: CstChildrenDictionary): void {
    // Intentionally empty — privilege body is not extracted.
}

catalogPackagePrivilege(_ctx: CstChildrenDictionary): void {
    // Intentionally empty — privilege body is not extracted.
}

applicationPrivilege(_ctx: CstChildrenDictionary): void {
    // Intentionally empty — privilege body is not extracted.
}
```

This ensures that schema names, object names, and application privilege names inside the privilege body are never pushed to `this.subjects`.

#### Implementation detail: `roleDefinition` visitor method

```typescript
roleDefinition(ctx: CstChildrenDictionary): void {
    // 1. Extract the top-level role name (always present)
    const roleNameNodes = ctx['roleName'] as CstNode[] | undefined;
    if (roleNameNodes && roleNameNodes.length > 0) {
        const name = this.reconstructRoleName(roleNameNodes[0].children ?? {});
        if (name) this.subjects.push({ type: 'roleName', name });
    }

    // 2. Extract each granted role name (only if extends block present)
    const grantedNodes = ctx['grantedRoleName'] as CstNode[] | undefined;
    if (grantedNodes) {
        for (const node of grantedNodes) {
            const name = this.reconstructRoleName(node.children ?? {});
            if (name) this.subjects.push({ type: 'grantedRoleName', name });
        }
    }

    // 3. Do NOT visit privilegeClause children.
    //    The no-op overrides above prevent extraction from privilege bodies.
}
```

#### Exported symbols

```typescript
export class HdbRoleNameVisitor { ... }
// subjects: ExtractedSubject[] — public field read by index.ts after visit
```

---

### 3.5 `src/parsers/hdbrole/index.ts`

#### Responsibility

Public API boundary. Orchestrates tokenise → parse → visit.

#### Implementation

```typescript
import type { ExtractedSubject } from '../../types/issues';
import { HdbRoleLexer } from './lexer';
import { hdbRoleParser } from './parser';
import { HdbRoleNameVisitor } from './visitor';

export function extractRoleNames(fileContent: string): ExtractedSubject[] {
    const lexResult = HdbRoleLexer.tokenize(fileContent);

    hdbRoleParser.input = lexResult.tokens;
    const cst = hdbRoleParser.roleDefinition();

    if (!cst) {
        return [];
    }

    const visitor = new HdbRoleNameVisitor();
    visitor.visit(cst);
    return visitor.subjects;
}
```

Lex/parse errors are intentionally not re-thrown. The CST visitor extracts whatever was recoverable from the partial tree. Callers in `content-lint.ts` must not throw on bad input.

---

### 3.6 Changes to existing files

#### `src/types/rules.ts`

Extend the `ContentTarget` union type by appending two new literal values:

```typescript
// Before
export type ContentTarget = 'field' | 'inputParameter' | 'outputParameter';

// After
export type ContentTarget = 'field' | 'inputParameter' | 'outputParameter' | 'roleName' | 'grantedRoleName';
```

No other changes to `rules.ts`.

#### `src/types/issues.ts`

Extend the `subjectType` literal union inside `LintIssue` to include the two new values:

```typescript
// Before
readonly subjectType?: 'artifact' | 'field' | 'inputParameter' | 'outputParameter';

// After
readonly subjectType?: 'artifact' | 'field' | 'inputParameter' | 'outputParameter' | 'roleName' | 'grantedRoleName';
```

No other changes to `issues.ts`.

#### `src/content-lint.ts`

Two minimal changes only:

**1. Add import** at the top alongside existing parser imports:

```typescript
import { extractRoleNames } from './parsers/hdbrole/index';
```

**2. Add branch** inside `extractSubjects()`:

```typescript
// After the existing '.hdbtabletype' branch:
if (extension === '.hdbrole') {
    return extractRoleNames(fileContent);
}
```

The final `extractSubjects()` function reads:

```typescript
function extractSubjects(extension: string, fileContent: string): ExtractedSubject[] {
    if (extension === '.hdbtable') {
        return extractTableColumns(fileContent);
    }
    if (extension === '.hdbview') {
        return extractViewColumns(fileContent);
    }
    if (extension === '.hdbprocedure') {
        return extractProcedureParameters(fileContent);
    }
    if (extension === '.hdbfunction') {
        return extractFunctionParameters(fileContent);
    }
    if (extension === '.hdbtabletype') {
        return extractTableTypeColumns(fileContent);
    }
    if (extension === '.hdbrole') {
        return extractRoleNames(fileContent);
    }
    return [];
}
```

No changes to `lintFileContent()`, `evaluateAllRules()`, `evaluateAnyRules()`, or any other function in `content-lint.ts`.

---

## 4. Data Models

No new persistent data models. The only type crossing the parser boundary is the existing `ExtractedSubject`, extended to accept the two new `ContentTarget` values:

```typescript
type ExtractedSubject = {
    readonly type: ContentTarget; // 'roleName' | 'grantedRoleName' for .hdbrole files
    readonly name: string; // normalised identifier (double-quotes stripped, full qualified form preserved)
    readonly lineNumber?: number; // optional; populated from token.startLine when available
};
```

**Subject type mapping:**

| `.hdbrole` element                   | `ExtractedSubject.type` | `name` example                  |
| ------------------------------------ | ----------------------- | ------------------------------- |
| Role being defined (`role <name>`)   | `'roleName'`            | `'com.example.app::AdminRole'`  |
| Each role in `extends roles { ... }` | `'grantedRoleName'`     | `'com.sap.security::AuditRole'` |

---

## 5. API Specifications

### Public function

```typescript
/**
 * Extract the role name and any granted role names from the content of
 * an `.hdbrole` DSL file (SAP HANA XS Classic format).
 *
 * Uses a Chevrotain lexer and CstParser. Handles block/line comments,
 * quoted and unquoted identifiers, plain and package-qualified role names,
 * the optional `extends roles { ... }` block, and all privilege clause
 * types (catalog schema, catalog sql object, catalog package, application
 * privilege). Privilege body content is never extracted.
 *
 * Gracefully returns partial results on invalid input — does not throw.
 *
 * @param fileContent - Raw UTF-8 file content (LF or CRLF).
 * @returns Array of ExtractedSubject:
 *   - First element (if parseable): type 'roleName', the role being defined.
 *   - Subsequent elements: type 'grantedRoleName', one per inherited role.
 */
export function extractRoleNames(fileContent: string): ExtractedSubject[];
```

### Internal module exports (not part of public API)

| Symbol                           | Module       | Visibility       |
| -------------------------------- | ------------ | ---------------- |
| `allTokens`, `HdbRoleLexer`      | `lexer.ts`   | Package-internal |
| `HdbRoleParser`, `hdbRoleParser` | `parser.ts`  | Package-internal |
| `HdbRoleNameVisitor`             | `visitor.ts` | Package-internal |

---

## 6. Unit Test Design

Test file: `src/parsers/hdbrole/__tests__/extractRoleNames.test.ts`

The test file follows the same conventions as `extractTableColumns.test.ts` and `extractProcedureParameters.test.ts`: one `describe` block per acceptance criterion, a `names()` helper for quick name-list assertions, and direct `extractRoleNames()` calls for full `ExtractedSubject[]` shape assertions.

```typescript
import { describe, it, expect } from 'vitest';
import { extractRoleNames } from '../index';

function names(dsl: string): string[] {
    return extractRoleNames(dsl).map((s) => s.name);
}

function types(dsl: string): string[] {
    return extractRoleNames(dsl).map((s) => s.type);
}
```

### Test cases by acceptance criterion

**AC-1 — Role name extraction (unqualified)**

```typescript
describe('AC-1: unqualified role name extraction', () => {
    it('extracts a plain unqualified role name', () => {
        const dsl = `role AdminRole { }`;
        expect(extractRoleNames(dsl)).toEqual([{ type: 'roleName', name: 'AdminRole' }]);
    });

    it('result has type "roleName"', () => {
        expect(types(`role AdminRole { }`)).toEqual(['roleName']);
    });
});
```

**AC-2 — Role name extraction (fully-qualified)**

```typescript
describe('AC-2: fully-qualified role name extraction', () => {
    it('extracts a package-qualified role name as a single string', () => {
        const dsl = `role com.example.app::AdminRole { }`;
        expect(extractRoleNames(dsl)).toEqual([{ type: 'roleName', name: 'com.example.app::AdminRole' }]);
    });

    it('preserves the full qualified form including package path and :: separator', () => {
        expect(names(`role com.example.app::AdminRole { }`)).toContain('com.example.app::AdminRole');
    });
});
```

**AC-3 — Quoted role name normalisation**

```typescript
describe('AC-3: quoted role name normalisation', () => {
    it('strips double-quotes from a quoted role name', () => {
        const dsl = `role "AdminRole" { }`;
        expect(extractRoleNames(dsl)).toEqual([{ type: 'roleName', name: 'AdminRole' }]);
    });
});
```

**AC-4 — Granted role extraction (single)**

```typescript
describe('AC-4: single granted role extraction', () => {
    it('extracts the defined role and one granted role', () => {
        const dsl = `
            role com.example.app::AdminRole
                extends roles { com.example.app::BaseRole }
            { }
        `;
        expect(extractRoleNames(dsl)).toEqual([
            { type: 'roleName', name: 'com.example.app::AdminRole' },
            { type: 'grantedRoleName', name: 'com.example.app::BaseRole' }
        ]);
    });
});
```

**AC-5 — Granted role extraction (multiple)**

```typescript
describe('AC-5: multiple granted roles extraction', () => {
    it('extracts one roleName and two grantedRoleName subjects', () => {
        const dsl = `
            role com.example.app::AdminRole
                extends roles {
                    com.example.app::BaseRole,
                    com.example.app::AuditRole
                }
            { }
        `;
        const result = extractRoleNames(dsl);
        expect(result).toHaveLength(3);
        expect(result[0]).toEqual({ type: 'roleName', name: 'com.example.app::AdminRole' });
        expect(result[1]).toEqual({ type: 'grantedRoleName', name: 'com.example.app::BaseRole' });
        expect(result[2]).toEqual({ type: 'grantedRoleName', name: 'com.example.app::AuditRole' });
    });
});
```

**AC-6 — No `extends roles` block**

```typescript
describe('AC-6: no extends block yields no grantedRoleName subjects', () => {
    it('returns exactly one roleName subject when no extends block is present', () => {
        const dsl = `role AdminRole { catalog schema "MY_SCHEMA": SELECT; }`;
        const result = extractRoleNames(dsl);
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe('roleName');
    });
});
```

**AC-7 — Privilege clauses not extracted**

```typescript
describe('AC-7: privilege clause content is not extracted', () => {
    it('does not extract schema names from catalog schema clauses', () => {
        const dsl = `
            role com.example.app::AdminRole {
                catalog schema "MY_SCHEMA": SELECT, INSERT, UPDATE, DELETE;
                application privilege: com.example.app::EditData;
            }
        `;
        const result = names(dsl);
        expect(result).not.toContain('MY_SCHEMA');
        expect(result).not.toContain('EditData');
        expect(result).not.toContain('SELECT');
        expect(result).not.toContain('INSERT');
    });

    it('does not extract object names from catalog sql object clauses', () => {
        const dsl = `
            role AdminRole {
                catalog sql object "MY_SCHEMA"."MY_TABLE": SELECT;
            }
        `;
        expect(names(dsl)).not.toContain('MY_TABLE');
    });
});
```

**AC-8 — Block comment exclusion**

```typescript
describe('AC-8: block comment exclusion', () => {
    it('does not extract a granted role wrapped in /* … */', () => {
        const dsl = `
            role com.example.app::AdminRole
                extends roles {
                    com.example.app::BaseRole
                    /* , com.example.app::OldRole */
                }
            { }
        `;
        expect(names(dsl)).not.toContain('com.example.app::OldRole');
        expect(names(dsl)).toContain('com.example.app::BaseRole');
    });
});
```

**AC-9 — Line comment exclusion**

```typescript
describe('AC-9: line comment exclusion', () => {
    it('does not extract a granted role appearing only in a -- comment', () => {
        const dsl = `
            role com.example.app::AdminRole
                extends roles {
                    com.example.app::BaseRole
                    -- , com.example.app::OldRole
                }
            { }
        `;
        expect(names(dsl)).not.toContain('com.example.app::OldRole');
    });
});
```

**AC-10 — Fully-qualified granted role name preserved**

```typescript
describe('AC-10: fully-qualified granted role name preserved', () => {
    it('preserves the full package path and :: in grantedRoleName', () => {
        const dsl = `
            role AdminRole
                extends roles { com.sap.security::BaseRole }
            { }
        `;
        expect(extractRoleNames(dsl)).toContainEqual({
            type: 'grantedRoleName',
            name: 'com.sap.security::BaseRole'
        });
    });
});
```

**AC-11 — Graceful error on unparseable file**

```typescript
describe('AC-11: graceful error handling', () => {
    it('does not throw on completely invalid content', () => {
        expect(() => extractRoleNames('@@@ not valid hdbrole')).not.toThrow();
    });

    it('returns an empty array for empty input', () => {
        expect(extractRoleNames('')).toEqual([]);
    });

    it('returns a partial result when only the role name is parseable', () => {
        const dsl = `role com.example.app::AdminRole { @@@ BROKEN `;
        expect(() => extractRoleNames(dsl)).not.toThrow();
        // Role name may be recoverable even if the body is not
    });
});
```

**AC-12 / AC-13 — Integration with `lintFileContent` (smoke tests)**

```typescript
describe('AC-12/AC-13: all extracted subjects carry the correct type', () => {
    it('all subjects from a role-with-extends file have one of the two role types', () => {
        const dsl = `
            role com.example.app::AdminRole
                extends roles { com.example.app::BaseRole }
            { }
        `;
        const result = extractRoleNames(dsl);
        expect(result.every((s) => s.type === 'roleName' || s.type === 'grantedRoleName')).toBe(true);
    });
});
```

---

## 7. Security and Performance Considerations

### Security

- **ReDoS**: The `BlockComment` token pattern `/\/\*[\s\S]*?\*\//` uses a non-backtracking lazy quantifier. On typical `.hdbrole` files (short, well-formed DSL content), this is safe. The Chevrotain `Lexer` is not a backtracking regex engine at the lexer level; token patterns are applied with a single forward scan.
- **No external input used as code**: The parser consumes file content as data only. No `eval`, `Function`, or dynamic code execution is involved.
- **File content is read-only**: `extractRoleNames()` accepts a `string` parameter and never writes back to disk.
- **No new network surface**: The parser is a pure in-process transform.

### Performance

- **NFR-4 target: < 50 ms per file** — A typical `.hdbrole` file has fewer than 100 lines. Chevrotain's LL(k) parser completes in O(n) time relative to token count. The token catalogue is small (< 40 tokens), making lexer initialisation fast.
- **Singleton instances**: `HdbRoleLexer` and `hdbRoleParser` are constructed **once** at module load time. Subsequent `extractRoleNames()` calls re-use the same instances (resetting `hdbRoleParser.input` only). This is mandatory per Chevrotain best practices — re-instantiating the parser per file triggers expensive grammar analysis.
- **No line-by-line scanning**: The Chevrotain lexer processes the entire file content in a single `tokenize()` call, avoiding the per-line overhead of the prior regex approach.

---

## 8. Implementation Milestones

| #   | Deliverable                                            | Acceptance signal                                                                                    |
| --- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| 1   | `src/types/rules.ts` and `src/types/issues.ts` updated | `tsc --noEmit` passes with zero errors                                                               |
| 2   | `src/parsers/hdbrole/lexer.ts` implemented             | Lexer tokenises sample `.hdbrole` files correctly; no unexpected `Identifier` fallbacks for keywords |
| 3   | `src/parsers/hdbrole/parser.ts` implemented            | Parser processes all grammar rules; no `NotAllInputParsed` errors on valid input                     |
| 4   | `src/parsers/hdbrole/visitor.ts` implemented           | `HdbRoleNameVisitor` returns correct subjects for all name forms                                     |
| 5   | `src/parsers/hdbrole/index.ts` implemented             | `extractRoleNames()` returns correct `ExtractedSubject[]` for all AC inputs                          |
| 6   | `src/content-lint.ts` wired                            | `.hdbrole` branch added; import present                                                              |
| 7   | Unit tests passing                                     | All `extractRoleNames.test.ts` test cases pass via `vitest run`                                      |
| 8   | Full build clean                                       | `npm run build` exits zero; `vitest run` exits zero                                                  |

---

## 9. Risk Assessment

| Risk                                                                               | Likelihood | Impact | Mitigation                                                                                                                                            |
| ---------------------------------------------------------------------------------- | ---------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token ordering error causes `ROLES` to match as `RoleKw`                           | Medium     | Low    | Spec mandates `Roles` before `RoleKw` with chained `longer_alt`; unit test AC-1 catches this immediately                                              |
| `ColonColon` consumed as two separate `Colon` tokens                               | Low        | High   | `ColonColon` declared before `Colon` in `allTokens`; AC-2 and AC-4 catch this via qualified-name tests                                                |
| Privilege body `applicationPrivilege` name extracted as `roleName`                 | Medium     | Medium | No-op override on all `privilegeClause` visitor methods; AC-7 explicitly tests for absence of privilege content                                       |
| `MANY: (Dot Identifier)*` loop consumes tokens beyond the role name                | Low        | Medium | Follow-set computation in Chevrotain stops the loop at `Extends`, `LBrace`, `Comma`, `RBrace` — none of which are `Dot`                               |
| `reconstructRoleName` produces wrong output for mixed-quoting (`pkg::"LocalName"`) | Low        | Low    | Sort-by-startOffset approach is position-invariant; AC-3 and AC-10 cover normalisation                                                                |
| `grantedRoleName` CST nodes not accessible from `roleDefinition` context           | Low        | High   | Verify that Chevrotain's CST flattens `grantedRoleList` children into `roleDefinition` context correctly; integration test AC-4/AC-5 will expose this |
| TypeScript strict-mode errors in new type union references                         | Low        | Low    | Additive union changes are backward-compatible; `tsc --noEmit` check in milestone 1 catches any downstream breakage                                   |
