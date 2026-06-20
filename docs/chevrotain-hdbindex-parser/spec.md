# Technical Design Specification: Chevrotain Lexer/Parser for `.hdbindex`

**PRD**: [prd.md](./prd.md)  
**Feature**: Chevrotain `.hdbindex` Index Name Extractor  
**Status**: Ready for Implementation

---

## 1. System Architecture Overview

### Current state

`extractSubjects()` in `src/content-lint.ts` has no handler for `.hdbindex` files. When a file with that extension is processed, the function falls through to the `return []` catch-all, silently yielding no subjects and no lint output.

```
content-lint.ts
  └── extractSubjects()
        ├── '.hdbtable'           → extractTableColumns()
        ├── '.hdbview'            → extractViewColumns()
        ├── '.hdbprocedure'       → extractProcedureParameters()
        ├── '.hdbfunction'        → extractFunctionParameters()
        ├── '.hdbtabletype'       → extractTableTypeColumns()
        ├── '.hdbrole'            → extractRoleNames()
        ├── '.hdbcalculationview' → extractCalculationViewOutputs()
        ├── '.hdbsequence'        → extractSequenceName()
        ├── '.hdbschedulerjob'    → extractSchedulerJobAction()
        └── (default)             → []   ← .hdbindex silently falls here
```

In addition, the `ContentTarget` union type in `src/types/rules.ts` and the `subjectType` union in `LintIssue` in `src/types/issues.ts` do not include `'indexName'`, so even if a user configures a `contentRuleSet` for `.hdbindex` the target value would be unresolvable at the type level.

### Target state

A new `src/parsers/hdbindex/` sub-module mirrors the structure of all existing `.hdb*` parser modules. `extractSubjects()` gains a dedicated `.hdbindex` branch. The two type unions are extended additively with `'indexName'`.

```
content-lint.ts
  └── extractSubjects()
        ├── '.hdbtable'           → extractTableColumns()
        ├── '.hdbview'            → extractViewColumns()
        ├── '.hdbprocedure'       → extractProcedureParameters()
        ├── '.hdbfunction'        → extractFunctionParameters()
        ├── '.hdbtabletype'       → extractTableTypeColumns()
        ├── '.hdbrole'            → extractRoleNames()
        ├── '.hdbcalculationview' → extractCalculationViewOutputs()
        ├── '.hdbsequence'        → extractSequenceName()
        ├── '.hdbschedulerjob'    → extractSchedulerJobAction()
        └── '.hdbindex'           → extractIndexName()   ← NEW

src/parsers/hdbindex/
  ├── lexer.ts      Token definitions + singleton Lexer instance
  ├── parser.ts     CstParser subclass + grammar rules
  ├── visitor.ts    CST visitor that collects the index name
  └── index.ts      Public API: extractIndexName()
```

Everything above `extractSubjects()` — `lintFileContent()`, `runLint()`, and the public `src/index.ts` entry point — is unchanged. The type additions in `src/types/rules.ts` and `src/types/issues.ts` are purely additive.

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
    hdbindex/
      lexer.ts
      parser.ts
      visitor.ts
      index.ts
      __tests__/
        extractIndexName.test.ts
```

### 3.2 `src/parsers/hdbindex/lexer.ts`

#### Responsibility

Define every token the grammar needs and export a singleton `Lexer` instance.

#### Token ordering rules (Chevrotain-specific)

1. Skip tokens (`BlockComment`, `LineComment`, `WhiteSpace`) must be declared first so they are consumed before anything else.
2. `Identifier` must be declared **before** keyword tokens in the `allTokens` array so that keyword tokens can reference it via `longer_alt`. Every keyword token must declare `longer_alt: Identifier` to prevent identifiers whose names begin with a keyword prefix (e.g., `INDEX_NAME`, `ON_CHANGE`, `ASC_SORT`, `INVERTED_FLAG`, `VALUE_MAP`) from being incorrectly tokenised as the keyword.
3. `QuotedIdentifier` must appear **before** `Identifier` in the `allTokens` array.
4. Among the index-type keywords, `BtreeKw` and `CpbtreeKw` are independent; `InvertedKw`, `HashKw`, `ValueKw`, and `IndividualKw` are sibling tokens and have no prefix-conflict relationship with each other.

#### Prefix-conflict pairs requiring explicit ordering

The `.hdbindex` grammar has no multi-character operator tokens, so there are no single-vs-multi-character prefix conflicts. The only ordering constraint beyond the skip-first rule is the `Identifier` / keyword ordering described above.

#### Token catalogue

**Skip tokens** (declared first):

| Token name     | Pattern              | Mode                       |
| -------------- | -------------------- | -------------------------- |
| `BlockComment` | `/\/\*[\s\S]*?\*\//` | `{ group: Lexer.SKIPPED }` |
| `LineComment`  | `/--[^\r\n]*/`       | `{ group: Lexer.SKIPPED }` |
| `WhiteSpace`   | `/\s+/`              | `{ group: Lexer.SKIPPED }` |

**Identifier tokens** (declared before keywords so `longer_alt` can reference them):

| Token name         | Pattern                    | Notes                                          |
| ------------------ | -------------------------- | ---------------------------------------------- |
| `Identifier`       | `/[A-Za-z_][A-Za-z0-9_]*/` | Catch-all; all keyword tokens use `longer_alt` |
| `QuotedIdentifier` | `/"[^"]*"/`                | Declared before `Identifier` in `allTokens`    |

**DDL keyword tokens** (all declare `longer_alt: Identifier`):

| Token name | Pattern     | Notes                                                                          |
| ---------- | ----------- | ------------------------------------------------------------------------------ |
| `CreateKw` | `/CREATE/i` | Optional leading keyword; `longer_alt: Identifier`                             |
| `UniqueKw` | `/UNIQUE/i` | Optional uniqueness modifier; `longer_alt: Identifier`                         |
| `IndexKw`  | `/INDEX/i`  | Mandatory index keyword; `longer_alt: Identifier`; `INDEX_NAME` → `Identifier` |
| `OnKw`     | `/ON/i`     | Separates index name from table name; `longer_alt: Identifier`                 |
| `AscKw`    | `/ASC/i`    | Optional column sort order; `longer_alt: Identifier`                           |
| `DescKw`   | `/DESC/i`   | Optional column sort order; `longer_alt: Identifier`                           |

**Index-type keyword tokens** (all declare `longer_alt: Identifier`):

| Token name     | Pattern         | Notes                                                                                      |
| -------------- | --------------- | ------------------------------------------------------------------------------------------ |
| `BtreeKw`      | `/BTREE/i`      | Stand-alone index type; `longer_alt: Identifier`                                           |
| `CpbtreeKw`    | `/CPBTREE/i`    | Stand-alone index type; `longer_alt: Identifier`                                           |
| `InvertedKw`   | `/INVERTED/i`   | First token of multi-word types `INVERTED HASH/VALUE/INDIVIDUAL`; `longer_alt: Identifier` |
| `HashKw`       | `/HASH/i`       | Second token of `INVERTED HASH`; `longer_alt: Identifier`                                  |
| `ValueKw`      | `/VALUE/i`      | Second token of `INVERTED VALUE`; `longer_alt: Identifier`                                 |
| `IndividualKw` | `/INDIVIDUAL/i` | Second token of `INVERTED INDIVIDUAL`; `longer_alt: Identifier`                            |

**Punctuation tokens**:

| Token name  | Pattern | Notes                         |
| ----------- | ------- | ----------------------------- |
| `LParen`    | `\(`    | Opens column list             |
| `RParen`    | `\)`    | Closes column list            |
| `Comma`     | `,`     | Separates column references   |
| `Semicolon` | `;`     | Optional statement terminator |
| `Dot`       | `\.`    | Schema qualifier separator    |

#### `allTokens` array ordering (summary)

```
[
  // Skip
  BlockComment, LineComment, WhiteSpace,
  // Identifiers (declared before keywords for longer_alt references)
  Identifier, QuotedIdentifier,
  // DDL keywords
  CreateKw, UniqueKw, IndexKw, OnKw, AscKw, DescKw,
  // Index-type keywords
  BtreeKw, CpbtreeKw, InvertedKw, HashKw, ValueKw, IndividualKw,
  // Punctuation
  LParen, RParen, Comma, Semicolon, Dot
]
```

#### Exported symbols

```typescript
export const allTokens: TokenType[];
export const HdbIndexLexer: Lexer; // singleton — instantiated at module load
```

---

### 3.3 `src/parsers/hdbindex/parser.ts`

#### Responsibility

Define the grammar as a `CstParser` subclass and expose a singleton parser instance.

#### Grammar notation

> `?` = optional, `*` = zero-or-more, `+` = one-or-more, `|` = alternation, `()` = grouping.

#### Grammar rules

```
indexStatement
    CreateKw? UniqueKw? indexType? IndexKw indexName OnKw tableName columnList Semicolon?
    -- Top-level rule.
    -- CREATE, UNIQUE, and the index type are all optional.
    -- IndexKw is the mandatory anchor token; the parser uses it as the
    --   recovery anchor when CREATE or UNIQUE are absent.
    -- indexName follows immediately after IndexKw.
    -- tableName follows the mandatory OnKw.
    -- columnList follows immediately after tableName.
    -- Trailing semicolon is optional.

indexType
    BtreeKw
    | CpbtreeKw
    | InvertedKw (HashKw | ValueKw | IndividualKw)
    -- BTREE and CPBTREE are single-token alternatives.
    -- INVERTED is the shared first token for the three multi-word variants;
    --   a nested OR selects the second token (HASH | VALUE | INDIVIDUAL).
    -- Chevrotain resolves the outer OR on LA(1); the inner OR resolves on LA(1)
    --   of the token following InvertedKw. No BACKTRACK is required.

indexName
    identifier (Dot identifier)?
    -- identifier = Identifier | QuotedIdentifier
    -- Handles plain MY_INDEX and schema-qualified "MY_SCHEMA"."MY_INDEX".
    -- The schema qualifier (before Dot), if present, is consumed structurally
    --   but NOT included in the extracted subject name.

tableName
    identifier (Dot identifier)?
    -- Same structure as indexName; entirely consumed without extraction.

columnList
    LParen columnRef (Comma columnRef)* RParen
    -- One or more column references enclosed in parentheses.
    -- At least one column is required; HANA does not permit empty index definitions.

columnRef
    identifier (AscKw | DescKw)?
    -- A single column name with an optional sort-order keyword.
    -- The identifier and keyword are consumed without extraction.

identifier
    QuotedIdentifier | Identifier
    -- Shared leaf rule used by indexName, tableName, and columnRef.
```

#### Key design: `indexType` inner OR for `INVERTED` variants

The three `INVERTED *` subtypes share the same first token (`InvertedKw`). An outer `OR` cannot distinguish them by LA(1) alone. The grammar uses a single INVERTED alternative that captures the shared prefix and then delegates to an inner `OR2` for the second token:

```typescript
this.RULE('indexType', () => {
    this.OR([
        { ALT: () => this.CONSUME(BtreeKw) },
        { ALT: () => this.CONSUME(CpbtreeKw) },
        {
            ALT: () => {
                this.CONSUME(InvertedKw);
                this.OR2([{ ALT: () => this.CONSUME(HashKw) }, { ALT: () => this.CONSUME(ValueKw) }, { ALT: () => this.CONSUME(IndividualKw) }]);
            }
        }
    ]);
});
```

The outer OR can resolve on LA(1): `BtreeKw`, `CpbtreeKw`, or `InvertedKw`. The inner `OR2` then resolves on the next LA(1): `HashKw`, `ValueKw`, or `IndividualKw`. No `BACKTRACK` or `MAX_LOOKAHEAD` override is required.

#### Key design: optional `CREATE` and `UNIQUE` prefix

Both `CREATE` and `UNIQUE` are optional. Chevrotain's `OPTION` construct handles each independently, so any combination is valid:

```typescript
this.RULE('indexStatement', () => {
    this.OPTION(() => this.CONSUME(CreateKw));
    this.OPTION2(() => this.CONSUME(UniqueKw));
    this.OPTION3(() => this.SUBRULE(this.indexType));
    this.CONSUME(IndexKw);
    this.SUBRULE(this.indexName);
    this.CONSUME(OnKw);
    this.SUBRULE(this.tableName);
    this.SUBRULE(this.columnList);
    this.OPTION4(() => this.CONSUME(Semicolon));
});
```

`IndexKw` is not optional; it is the mandatory anchor that tells the parser where the statement begins when prefix keywords are absent. This matches the minimum valid `.hdbindex` form: `INDEX <name> ON <table> (<columns>)`.

#### Key design: schema-qualified names in `indexName`

`indexName` uses an `OPTION` for the `Dot identifier` suffix to handle both qualified and unqualified forms. The visitor always extracts the **last** `identifier` child (the local name), regardless of whether a schema qualifier is present.

```typescript
this.RULE('indexName', () => {
    this.SUBRULE(this.identifier);
    this.OPTION(() => {
        this.CONSUME(Dot);
        this.SUBRULE2(this.identifier);
    });
});
```

The same pattern is used for `tableName` (consumed but not extracted).

#### Key design: `columnList` uses `MANY_SEP`

```typescript
this.RULE('columnList', () => {
    this.CONSUME(LParen);
    this.AT_LEAST_ONE_SEP({
        SEP: Comma,
        DEF: () => this.SUBRULE(this.columnRef)
    });
    this.CONSUME(RParen);
});
```

`AT_LEAST_ONE_SEP` is used instead of `MANY_SEP` because a valid HANA index must reference at least one column. This aligns with HANA DDL semantics and gives Chevrotain more precise error recovery information if a column list is empty.

#### Key design: `indexStatement` as top-level entry point

The top-level grammar rule is `indexStatement`, following the convention used by all other parsers in the project. The singleton parser's entry-point call in `index.ts` uses:

```typescript
const cst = hdbIndexParser.indexStatement();
```

#### Error recovery

Use Chevrotain's default single-token insertion/deletion recovery. Do **not** override recovery methods. The defaults ensure a partial CST is produced rather than an exception when encountering unexpected syntax. If the `indexName` rule parsed successfully before any error occurs, the visitor will still extract the index name.

#### Exported symbols

```typescript
export class HdbIndexParser extends CstParser { ... }
export const hdbIndexParser: HdbIndexParser; // singleton
```

---

### 3.4 `src/parsers/hdbindex/visitor.ts`

#### Responsibility

Walk the CST produced by `HdbIndexParser` and emit exactly one `{ type: 'indexName', name }` entry from the `indexName` node. The visitor performs no extraction from `tableName`, `columnList`, or any other grammar rule.

#### Design

The visitor extends `BaseCstVisitorWithDefaults` (obtained via `hdbIndexParser.getBaseCstVisitorConstructorWithDefaults()`). This variant auto-visits all child nodes for any method not explicitly overridden. Only one method needs to be implemented explicitly:

1. `indexName` — extracts the local index name from the CST node.

All other grammar rule methods (`indexStatement`, `indexType`, `tableName`, `columnList`, `columnRef`, `identifier`) are left to default auto-traversal. This is safe because:

- `tableName` and `columnRef` both delegate to `identifier`, but neither is a child of `indexName` in the CST. The visitor only overrides `indexName`, so it never processes the `identifier` children of `tableName` or `columnRef`.
- The `identifier` leaf rule itself is not overridden; it is only visited when reached through `indexName`.

#### Extraction logic: `indexName`

```typescript
indexName(ctx: CstChildrenDictionary): void {
    // ctx['identifier'] contains 1 or 2 identifier sub-rule result nodes:
    //   [0] = schema qualifier (when schema-qualified form is used)
    //   [1] = local index name  (only element when unqualified)
    //
    // Always take the LAST identifier node — this is the local name
    // regardless of whether a schema qualifier is present.
    const identifierNodes = ctx['identifier'] as CstNode[] | undefined;
    if (!identifierNodes?.length) return;

    const localNameNode = identifierNodes[identifierNodes.length - 1];
    const name = this.extractIdentifierName(localNameNode);
    if (!name) return;

    this.subjects.push({ type: 'indexName', name });
}
```

> **Note**: The visitor must **not** call `this.visit()` on `tableName` or `columnRef` child nodes from within `indexName`. Because `indexName` is overridden, default auto-traversal stops at this node. The method reads `ctx` directly without recursing further.

#### Identifier normalisation

A private helper strips surrounding double-quotes from `QuotedIdentifier` image strings and returns the raw image for plain `Identifier` tokens:

```typescript
private extractIdentifierName(node: CstNode): string | undefined {
    if (!node.children) return undefined;
    const token =
        (node.children['QuotedIdentifier']?.[0] as IToken | undefined) ??
        (node.children['Identifier']?.[0] as IToken | undefined);
    if (!token) return undefined;
    const raw = token.image;
    return raw.startsWith('"') ? raw.slice(1, -1) : raw;
}
```

#### Index name uniqueness

A well-formed `.hdbindex` file contains exactly one index definition. The visitor emits at most one `ExtractedSubject`. If the CST contains multiple `indexName` nodes due to Chevrotain error recovery producing extra nodes, only the first successfully-extracted name is included (the `SUBRULE` numbering in the parser's `indexStatement` guarantees there is only one `indexName` production per file).

#### Exported symbols

```typescript
export class HdbIndexVisitor {
    readonly subjects: ExtractedSubject[] = [];
    visit(cst: CstNode): void { ... }
}
```

---

### 3.5 `src/parsers/hdbindex/index.ts`

#### Responsibility

Public API boundary. Orchestrates tokenise → parse → visit. The single exported function is what `content-lint.ts` calls.

#### Implementation

```typescript
import type { ExtractedSubject } from '../../types/issues';
import { HdbIndexLexer } from './lexer';
import { hdbIndexParser } from './parser';
import { HdbIndexVisitor } from './visitor';

export function extractIndexName(fileContent: string): ExtractedSubject[] {
    const lexResult = HdbIndexLexer.tokenize(fileContent);

    hdbIndexParser.input = lexResult.tokens;

    const cst = hdbIndexParser.indexStatement();

    if (!cst) {
        return [];
    }

    const visitor = new HdbIndexVisitor();
    visitor.visit(cst);
    return visitor.subjects;
}
```

Lex and parse errors are intentionally not re-thrown. The CST visitor returns whatever could be extracted from the partial tree. Callers in `content-lint.ts` must not crash on bad input.

---

### 3.6 Changes to `src/types/rules.ts`

Add `'indexName'` to the `ContentTarget` union:

```typescript
// Before
export type ContentTarget = 'field' | 'inputParameter' | 'outputParameter' | 'roleName' | 'grantedRoleName' | 'sequenceName' | 'jobAction';

// After
export type ContentTarget =
    | 'field'
    | 'inputParameter'
    | 'outputParameter'
    | 'roleName'
    | 'grantedRoleName'
    | 'sequenceName'
    | 'jobAction'
    | 'indexName';
```

This is a purely additive change. No existing usages of `ContentTarget` are affected.

---

### 3.7 Changes to `src/types/issues.ts`

Add `'indexName'` to the `subjectType` union in `LintIssue`:

```typescript
// Before
readonly subjectType?: 'artifact' | 'field' | 'inputParameter' | 'outputParameter' | 'roleName' | 'grantedRoleName' | 'sequenceName' | 'jobAction';

// After
readonly subjectType?: 'artifact' | 'field' | 'inputParameter' | 'outputParameter' | 'roleName' | 'grantedRoleName' | 'sequenceName' | 'jobAction' | 'indexName';
```

`ExtractedSubject.type` is typed as `ContentTarget`, so it picks up `'indexName'` automatically once `ContentTarget` is extended. No further change to `ExtractedSubject` itself is required.

---

### 3.8 Changes to `src/content-lint.ts`

Two changes only:

1. **Add import** at the top of the file alongside the existing parser imports:

    ```typescript
    import { extractIndexName } from './parsers/hdbindex/index';
    ```

2. **Add branch** in `extractSubjects()` before the `return []` catch-all:

    ```typescript
    // Before (abbreviated)
    function extractSubjects(extension: string, fileContent: string): ExtractedSubject[] {
        if (extension === '.hdbtable') return extractTableColumns(fileContent);
        if (extension === '.hdbview') return extractViewColumns(fileContent);
        if (extension === '.hdbprocedure') return extractProcedureParameters(fileContent);
        if (extension === '.hdbfunction') return extractFunctionParameters(fileContent);
        if (extension === '.hdbtabletype') return extractTableTypeColumns(fileContent);
        if (extension === '.hdbrole') return extractRoleNames(fileContent);
        if (extension === '.hdbcalculationview') return extractCalculationViewOutputs(fileContent);
        if (extension === '.hdbsequence') return extractSequenceName(fileContent);
        if (extension === '.hdbschedulerjob') return extractSchedulerJobAction(fileContent);
        return [];
    }

    // After
    function extractSubjects(extension: string, fileContent: string): ExtractedSubject[] {
        if (extension === '.hdbtable') return extractTableColumns(fileContent);
        if (extension === '.hdbview') return extractViewColumns(fileContent);
        if (extension === '.hdbprocedure') return extractProcedureParameters(fileContent);
        if (extension === '.hdbfunction') return extractFunctionParameters(fileContent);
        if (extension === '.hdbtabletype') return extractTableTypeColumns(fileContent);
        if (extension === '.hdbrole') return extractRoleNames(fileContent);
        if (extension === '.hdbcalculationview') return extractCalculationViewOutputs(fileContent);
        if (extension === '.hdbsequence') return extractSequenceName(fileContent);
        if (extension === '.hdbschedulerjob') return extractSchedulerJobAction(fileContent);
        if (extension === '.hdbindex') return extractIndexName(fileContent);
        return [];
    }
    ```

No other changes to `content-lint.ts`. `lintFileContent()`, `evaluateAllRules()`, `evaluateAnyRules()`, and `LintIssue` are untouched beyond the `'indexName'` addition to `subjectType`.

---

## 4. Data Models

No new persistent data models. The only types crossing the parser boundary are the existing `ExtractedSubject` and `ContentTarget`, extended additively:

```typescript
// src/types/issues.ts — ExtractedSubject uses ContentTarget directly
type ExtractedSubject = {
    readonly type: ContentTarget; // 'indexName' for .hdbindex
    readonly name: string; // normalised identifier (double-quotes stripped)
    readonly lineNumber?: number; // not populated by this parser
};

// src/types/rules.ts — extended with 'indexName'
type ContentTarget = 'field' | 'inputParameter' | 'outputParameter' | 'roleName' | 'grantedRoleName' | 'sequenceName' | 'jobAction' | 'indexName'; // NEW
```

The `.hdbindex` extractor returns at most **one** entry per file (a single index definition per file). A `contentRuleSet` targeting any other `ContentTarget` value against `.hdbindex` will match zero subjects — this is not an error.

---

## 5. API Specifications

### Public function

```typescript
/**
 * Extract the index name from the content of an `.hdbindex` DDL file.
 *
 * Uses a Chevrotain lexer and CstParser to correctly handle all SAP HANA
 * index DDL variants:
 *   - bare `INDEX <name> ON <table> (<columns>)`
 *   - `CREATE INDEX <name> ON <table> (<columns>)`
 *   - `CREATE UNIQUE INDEX <name> ON <table> (<columns>)`
 *   - `CREATE [UNIQUE] BTREE|CPBTREE|INVERTED HASH|INVERTED VALUE|INVERTED INDIVIDUAL INDEX ...`
 *
 * The parser handles block/line comments, quoted and unquoted index names,
 * schema-qualified index names (schema prefix excluded from result),
 * and optional trailing semicolons.
 *
 * Column names and sort-order keywords (ASC/DESC) inside the column list
 * are consumed structurally and never extracted.
 *
 * Gracefully returns a partial or empty result on invalid input — does
 * not throw.
 *
 * @param fileContent - Raw UTF-8 file content (LF or CRLF).
 * @returns Array containing at most one ExtractedSubject with type 'indexName'.
 */
export function extractIndexName(fileContent: string): ExtractedSubject[];
```

### Internal module exports (not part of public API)

| Symbol                             | Module       | Visibility       |
| ---------------------------------- | ------------ | ---------------- |
| `allTokens`, `HdbIndexLexer`       | `lexer.ts`   | Package-internal |
| `HdbIndexParser`, `hdbIndexParser` | `parser.ts`  | Package-internal |
| `HdbIndexVisitor`                  | `visitor.ts` | Package-internal |

---

## 6. Unit Test Design

Test file: `src/parsers/hdbindex/__tests__/extractIndexName.test.ts`

The test file follows the same structure as the existing `.hdb*` parser tests: one `describe` block per acceptance criterion, typed helper functions for brevity.

```typescript
import { describe, it, expect } from 'vitest';
import { extractIndexName } from '../index';

function names(ddl: string): string[] {
    return extractIndexName(ddl)
        .filter((s) => s.type === 'indexName')
        .map((s) => s.name);
}
```

### Test cases by acceptance criterion

**AC-1 — Bare `INDEX` syntax (unquoted)**

```typescript
describe('AC-1: bare INDEX syntax, unquoted name', () => {
    it('extracts the index name as an indexName subject', () => {
        const ddl = `INDEX MY_INDEX ON MY_TABLE (COL1, COL2);`;
        expect(extractIndexName(ddl)).toEqual([{ type: 'indexName', name: 'MY_INDEX' }]);
    });

    it('handles a file without a trailing semicolon', () => {
        const ddl = `INDEX MY_INDEX ON MY_TABLE (COL1)`;
        expect(names(ddl)).toEqual(['MY_INDEX']);
    });
});
```

**AC-2 — Full `CREATE INDEX` syntax (unquoted)**

```typescript
describe('AC-2: CREATE INDEX syntax, unquoted name', () => {
    it('extracts the index name from a full CREATE INDEX statement', () => {
        const ddl = `CREATE INDEX MY_INDEX ON MY_TABLE (COL1 ASC, COL2 DESC);`;
        expect(extractIndexName(ddl)).toEqual([{ type: 'indexName', name: 'MY_INDEX' }]);
    });
});
```

**AC-3 — `CREATE UNIQUE INDEX` syntax**

```typescript
describe('AC-3: CREATE UNIQUE INDEX syntax', () => {
    it('extracts the index name from a CREATE UNIQUE INDEX statement', () => {
        const ddl = `CREATE UNIQUE INDEX MY_UNIQUE_INDEX ON MY_TABLE (COL1);`;
        expect(extractIndexName(ddl)).toEqual([{ type: 'indexName', name: 'MY_UNIQUE_INDEX' }]);
    });
});
```

**AC-4 — Index type keyword variants consumed without error**

```typescript
describe('AC-4: index type keyword variants', () => {
    const cases: [string, string][] = [
        ['BTREE', `CREATE BTREE INDEX MY_IDX ON MY_TABLE (COL1);`],
        ['CPBTREE', `CREATE CPBTREE INDEX MY_IDX ON MY_TABLE (COL1);`],
        ['INVERTED HASH', `CREATE INVERTED HASH INDEX MY_IDX ON MY_TABLE (COL1);`],
        ['INVERTED VALUE', `CREATE INVERTED VALUE INDEX MY_IDX ON MY_TABLE (COL1);`],
        ['INVERTED INDIVIDUAL', `CREATE INVERTED INDIVIDUAL INDEX MY_IDX ON MY_TABLE (COL1);`]
    ];

    for (const [label, ddl] of cases) {
        it(`extracts the index name when type is ${label}`, () => {
            expect(extractIndexName(ddl)).toEqual([{ type: 'indexName', name: 'MY_IDX' }]);
        });
    }

    it('accepts UNIQUE combined with INVERTED HASH', () => {
        const ddl = `CREATE UNIQUE INVERTED HASH INDEX MY_IDX ON MY_TABLE (COL1);`;
        expect(names(ddl)).toEqual(['MY_IDX']);
    });
});
```

**AC-5 — Quoted identifier normalisation**

```typescript
describe('AC-5: quoted identifier normalisation', () => {
    it('strips double-quotes from the index name', () => {
        const ddl = `CREATE INDEX "MY_INDEX" ON "MY_TABLE" ("COL1", "COL2");`;
        expect(extractIndexName(ddl)).toEqual([{ type: 'indexName', name: 'MY_INDEX' }]);
    });

    it('handles a mixed-quote file (quoted index name, unquoted table)', () => {
        const ddl = `CREATE INDEX "MY_INDEX" ON MY_TABLE (COL1);`;
        expect(names(ddl)).toEqual(['MY_INDEX']);
    });
});
```

**AC-6 — Schema-qualified index name — local name extracted**

```typescript
describe('AC-6: schema-qualified index name', () => {
    it('extracts only the local name (after the dot)', () => {
        const ddl = `CREATE INDEX "MY_SCHEMA"."MY_INDEX" ON "MY_SCHEMA"."MY_TABLE" ("COL1");`;
        expect(extractIndexName(ddl)).toEqual([{ type: 'indexName', name: 'MY_INDEX' }]);
    });

    it('does not include the schema prefix as a subject', () => {
        const ddl = `CREATE INDEX "MY_SCHEMA"."MY_INDEX" ON "MY_TABLE" (COL1);`;
        expect(names(ddl)).not.toContain('MY_SCHEMA');
    });
});
```

**AC-7 — Column identifiers not extracted**

```typescript
describe('AC-7: column identifiers not extracted', () => {
    it('does not include column names in the result', () => {
        const ddl = `CREATE INDEX MY_INDEX ON MY_TABLE (FIRST_COLUMN ASC, SECOND_COLUMN DESC);`;
        const result = extractIndexName(ddl);
        expect(result).toEqual([{ type: 'indexName', name: 'MY_INDEX' }]);
        expect(names(ddl)).not.toContain('FIRST_COLUMN');
        expect(names(ddl)).not.toContain('SECOND_COLUMN');
    });

    it('does not include the table name in the result', () => {
        const ddl = `CREATE INDEX MY_INDEX ON MY_TABLE (COL1);`;
        expect(names(ddl)).not.toContain('MY_TABLE');
    });
});
```

**AC-8 — Block comment exclusion**

```typescript
describe('AC-8: block comment exclusion', () => {
    it('does not extract an index name wrapped in a block comment', () => {
        const ddl = `
            /* CREATE INDEX OLD_INDEX ON MY_TABLE (COL1); */
            CREATE INDEX MY_INDEX ON MY_TABLE (COL1);
        `;
        expect(names(ddl)).not.toContain('OLD_INDEX');
        expect(names(ddl)).toContain('MY_INDEX');
    });

    it('handles a multi-line block comment spanning several tokens', () => {
        const ddl = `
            CREATE INDEX /*MY_COMMENT_INDEX ON MY_TABLE (COL1);
            CREATE INDEX*/ MY_INDEX ON MY_TABLE (COL1);
        `;
        expect(names(ddl)).not.toContain('MY_COMMENT_INDEX');
    });
});
```

**AC-9 — Line comment exclusion**

```typescript
describe('AC-9: line comment exclusion', () => {
    it('does not extract an index name on a -- comment line', () => {
        const ddl = `
            -- CREATE INDEX OLD_INDEX ON MY_TABLE (COL1);
            CREATE INDEX MY_INDEX ON MY_TABLE (COL1);
        `;
        expect(names(ddl)).not.toContain('OLD_INDEX');
        expect(names(ddl)).toContain('MY_INDEX');
    });
});
```

**AC-10 — Optional semicolon**

```typescript
describe('AC-10: optional semicolon', () => {
    it('produces the same result with and without a trailing semicolon', () => {
        const withSemicolon = `CREATE INDEX MY_INDEX ON MY_TABLE (COL1);`;
        const withoutSemicolon = `CREATE INDEX MY_INDEX ON MY_TABLE (COL1)`;
        expect(names(withSemicolon)).toEqual(names(withoutSemicolon));
    });
});
```

**AC-11 — Graceful error on unparseable file**

```typescript
describe('AC-11: graceful error handling', () => {
    it('does not throw on completely invalid input', () => {
        expect(() => extractIndexName('THIS IS NOT VALID DDL !!!')).not.toThrow();
    });

    it('does not throw on an empty string', () => {
        expect(() => extractIndexName('')).not.toThrow();
        expect(extractIndexName('')).toEqual([]);
    });

    it('does not throw when INDEX keyword is missing', () => {
        expect(() => extractIndexName('CREATE MY_INDEX ON MY_TABLE (COL1)')).not.toThrow();
    });
});
```

**AC-12 — Build integrity** is verified by running `npm run build` in CI; no unit-test case is required.

---

## 7. Security and Performance Considerations

### Security

- **ReDoS** — The `BlockComment` pattern (`/\/\*[\s\S]*?\*\//`) uses a non-greedy quantifier and has no nested quantifiers; it is safe from catastrophic backtracking. All other patterns are simple character-class or literal-match patterns. The token set is identical in structure to those used by every other parser in the project.
- **Input size** — `.hdbindex` files are extremely small by nature (typically 1–5 lines); the 100 ms performance budget (NFR-4) is not at risk even for pathological inputs up to 500 lines.
- **No code execution** — The parser only produces `ExtractedSubject` values containing string names from the token stream. It does not evaluate, execute, or persist anything from the file content. No injection vectors exist.
- **No network access** — The parser operates entirely on the string passed in. No external resources are fetched.

### Performance

- **Singleton pattern**: Both `HdbIndexLexer` and `hdbIndexParser` are instantiated **once** at module load time. Repeated calls to `extractIndexName()` reuse the same lexer and parser instances, satisfying NFR-3.
- **Parser input reset**: Before each parse, `hdbIndexParser.input = lexResult.tokens` resets the token stream. This is the standard Chevrotain pattern for reusing a singleton parser across multiple files.
- **Expected throughput**: A typical `.hdbindex` file is 1–3 lines. Chevrotain's lexing and parsing overhead for such small inputs is negligible — well under 1 ms on commodity hardware, comfortably satisfying NFR-4 (under 100 ms for files up to 500 lines).

---

## 8. Implementation Milestones

| #   | Deliverable                                    | Files changed                                             |
| --- | ---------------------------------------------- | --------------------------------------------------------- |
| 1   | Extend `ContentTarget` and `LintIssue` types   | `src/types/rules.ts`, `src/types/issues.ts`               |
| 2   | Implement `lexer.ts`                           | `src/parsers/hdbindex/lexer.ts`                           |
| 3   | Implement `parser.ts`                          | `src/parsers/hdbindex/parser.ts`                          |
| 4   | Implement `visitor.ts`                         | `src/parsers/hdbindex/visitor.ts`                         |
| 5   | Implement `index.ts`                           | `src/parsers/hdbindex/index.ts`                           |
| 6   | Wire into `content-lint.ts`                    | `src/content-lint.ts`                                     |
| 7   | Write unit tests                               | `src/parsers/hdbindex/__tests__/extractIndexName.test.ts` |
| 8   | Run `npm run build` and confirm zero TS errors | —                                                         |
| 9   | Run `npm test` and confirm all tests pass      | —                                                         |

Milestones 1–6 may be done in parallel; milestone 7 may be developed alongside milestones 2–5 (TDD style). Milestones 8 and 9 are verification steps after all prior milestones are complete.

---

## 9. Risk Assessment

| Risk                                                                                     | Likelihood | Impact | Mitigation                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `INVERTED` keyword mis-tokenised as an identifier prefix                                 | Low        | Medium | `InvertedKw` declares `longer_alt: Identifier`, so `INVERTED_FLAG` or similar identifiers are tokenised as `Identifier`, not as `InvertedKw`. The inner `OR2` for `HASH\|VALUE\|INDIVIDUAL` is only reached when `InvertedKw` is matched.  |
| `ON` keyword conflicts with table or index names containing `ON` as a prefix             | Low        | Low    | `OnKw` declares `longer_alt: Identifier`; identifiers like `ON_CHANGE`, `ONLINE` tokenise correctly as `Identifier`.                                                                                                                       |
| Schema-qualified `indexName` visitor returns the schema prefix instead of the local name | Low        | Medium | Visitor always takes the **last** `identifier` child of `indexName`. `SUBRULE` and `SUBRULE2` produce distinct children in the CST `ctx` array; the last entry is always the local name. Test AC-6 covers this.                            |
| Column identifier in `columnRef` extracted as an index name                              | Very low   | High   | `columnRef` is a child of `columnList`, which is a child of `indexStatement` — not of `indexName`. The visitor only overrides `indexName`. Auto-traversal for all other rules never surfaces column tokens under the `indexName` CST node. |
| Future HANA index syntax (e.g., partition-aware indexes) not covered                     | Low        | Low    | Chevrotain error recovery allows the parser to consume unknown tokens gracefully without crashing. The `indexName` portion of the CST is produced before any trailing unknown clauses are encountered.                                     |
| Chevrotain version upgrade changes `BaseCstVisitorWithDefaults` API                      | Very low   | Low    | Chevrotain's visitor API has been stable since v6. The project pins a specific major version (`v11.x`).                                                                                                                                    |
| Parser singleton state pollution between test runs                                       | Low        | Medium | Resetting `hdbIndexParser.input` before each `indexStatement()` call fully resets internal state. This is the standard Chevrotain pattern and is confirmed by the reference implementations of every existing parser.                      |
