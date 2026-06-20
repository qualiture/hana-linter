# Technical Design Specification: Chevrotain Lexer/Parser for `.hdbtabletype`

**PRD**: [prd.md](./prd.md)  
**Feature**: Chevrotain `.hdbtabletype` Table Type Column Extractor  
**Status**: Ready for Implementation

---

## 1. System Architecture Overview

### Current state

`extractSubjects()` in `src/content-lint.ts` has no branch for `.hdbtabletype` files. When a file with that extension is processed, the function falls through to the `return []` catch-all, silently yielding no subjects and no lint output.

```
content-lint.ts
  └── extractSubjects()
        ├── '.hdbtable'       → extractTableColumns()
        ├── '.hdbview'        → extractViewColumns()
        ├── '.hdbprocedure'   → extractProcedureParameters()
        ├── '.hdbfunction'    → extractFunctionParameters()
        └── (anything else)   → []   ← .hdbtabletype silently falls here
```

### Target state

A new `src/parsers/hdbtabletype/` sub-module mirrors the structure of the existing parsers. `extractSubjects()` gains a dedicated `.hdbtabletype` branch. No existing branch is modified.

```
content-lint.ts
  └── extractSubjects()
        ├── '.hdbtable'       → extractTableColumns()
        ├── '.hdbview'        → extractViewColumns()
        ├── '.hdbprocedure'   → extractProcedureParameters()
        ├── '.hdbfunction'    → extractFunctionParameters()
        └── '.hdbtabletype'   → extractTableTypeColumns()   ← NEW

src/parsers/hdbtabletype/
  ├── lexer.ts      Token definitions + singleton Lexer instance
  ├── parser.ts     CstParser subclass + grammar rules
  ├── visitor.ts    CST visitor that collects column names
  └── index.ts      Public API: extractTableTypeColumns()
```

Everything above `extractSubjects()` — `lintFileContent()`, `runLint()`, `LintIssue`, and the public `src/index.ts` entry point — is unchanged.

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
    hdbtabletype/
      lexer.ts
      parser.ts
      visitor.ts
      index.ts
      __tests__/
        extractTableTypeColumns.test.ts
```

### 3.2 `src/parsers/hdbtabletype/lexer.ts`

#### Responsibility

Define every token the grammar needs and export a singleton `Lexer` instance.

#### Token ordering rules (Chevrotain-specific)

1. Skip tokens (`BlockComment`, `LineComment`, `WhiteSpace`) must be declared first so they are consumed before anything else.
2. Keyword tokens must appear **before** `QuotedIdentifier` and `Identifier` in the `allTokens` array.
3. All keyword tokens must declare `longer_alt: Identifier` so that identifiers that begin with a keyword prefix (e.g. `TABLE_NAME`, `TYPE_CODE`, `ASSET`, `TIMESTAMP_FIELD`) are not split at the keyword boundary.
4. Tokens with a shared prefix must be declared in **longest-first** order within the group (see prefix-conflict table below).
5. `QuotedIdentifier` must appear before `Identifier`.
6. `IntegerLiteral` must appear after `Identifier` (conventional; digits do not appear in identifier patterns).

#### Prefix-conflict pairs requiring explicit ordering

| Longer token | Shorter token | Constraint                              |
| ------------ | ------------- | --------------------------------------- |
| `TIMESTAMP`  | `TIME`        | Declare `Timestamp` before `Time`       |
| `NVARCHAR`   | (no `NVAR`)   | No conflict within the token catalogue  |
| `VARBINARY`  | `VARCHAR`     | Declare `Varbinary` before `VarChar`    |
| `BIGINT`     | (no `BIG`)    | No conflict                             |
| `SMALLINT`   | (no `SMALL`)  | No conflict                             |
| `TINYINT`    | (no `TINY`)   | No conflict                             |
| `SECONDDATE` | (no `SECOND`) | No conflict                             |
| `BOOLEAN`    | `BLOB`        | Diverge at 2nd character; no constraint |

#### Token catalogue

**Skip tokens** (declared first):

| Token name     | Pattern              | Mode                       |
| -------------- | -------------------- | -------------------------- |
| `BlockComment` | `/\/\*[\s\S]*?\*\//` | `{ group: Lexer.SKIPPED }` |
| `LineComment`  | `/--[^\r\n]*/`       | `{ group: Lexer.SKIPPED }` |
| `WhiteSpace`   | `/\s+/`              | `{ group: Lexer.SKIPPED }` |

**Table-type keyword tokens** (all with `longer_alt: Identifier`; listed in declaration order):

| Token name | Pattern    | Notes                                                                                |
| ---------- | ---------- | ------------------------------------------------------------------------------------ |
| `TypeKw`   | `/TYPE/i`  | Top-level statement keyword                                                          |
| `As`       | `/AS/i`    |                                                                                      |
| `TableKw`  | `/TABLE/i` | Distinguishes `AS TABLE` from a column named `TABLE`; `longer_alt` handles `TABLE_X` |

**Data-type keyword tokens** (all with `longer_alt: Identifier`):

| Token name   | Pattern         | Notes             |
| ------------ | --------------- | ----------------- |
| `Timestamp`  | `/TIMESTAMP/i`  | Before `Time`     |
| `Seconddate` | `/SECONDDATE/i` |                   |
| `NVarchar`   | `/NVARCHAR/i`   |                   |
| `Varbinary`  | `/VARBINARY/i`  | Before `VarChar`  |
| `VarChar`    | `/VARCHAR/i`    |                   |
| `Alphanum`   | `/ALPHANUM/i`   |                   |
| `Shorttext`  | `/SHORTTEXT/i`  |                   |
| `Integer`    | `/INTEGER/i`    |                   |
| `Bigint`     | `/BIGINT/i`     |                   |
| `Smallint`   | `/SMALLINT/i`   |                   |
| `Tinyint`    | `/TINYINT/i`    |                   |
| `Decimal`    | `/DECIMAL/i`    |                   |
| `Double`     | `/DOUBLE/i`     |                   |
| `Float`      | `/FLOAT/i`      |                   |
| `Real`       | `/REAL/i`       |                   |
| `Boolean`    | `/BOOLEAN/i`    |                   |
| `Date`       | `/DATE/i`       |                   |
| `Time`       | `/TIME/i`       | After `Timestamp` |
| `Clob`       | `/CLOB/i`       |                   |
| `Nclob`      | `/NCLOB/i`      |                   |
| `Blob`       | `/BLOB/i`       |                   |
| `Binary`     | `/BINARY/i`     |                   |

**Identifier tokens** (declared after all keywords):

| Token name         | Pattern                    | Notes                                                        |
| ------------------ | -------------------------- | ------------------------------------------------------------ |
| `QuotedIdentifier` | `/\"[^\"]*\"/`             | Declared **before** `Identifier`                             |
| `Identifier`       | `/[A-Za-z_][A-Za-z0-9_]*/` | Catch-all; all keyword tokens use `longer_alt` pointing here |

**Numeric literal token:**

| Token name       | Pattern    |
| ---------------- | ---------- |
| `IntegerLiteral` | `/[0-9]+/` |

**Punctuation tokens:**

| Token name  | Pattern |
| ----------- | ------- |
| `LParen`    | `\(`    |
| `RParen`    | `\)`    |
| `Comma`     | `,`     |
| `Semicolon` | `;`     |
| `Dot`       | `\.`    |

#### `allTokens` array ordering (summary)

```
[
  // Skip
  BlockComment, LineComment, WhiteSpace,
  // Table-type keywords
  TypeKw, As, TableKw,
  // Data-type keywords — prefix-conflict groups in longest-first order
  Timestamp, Seconddate,       // TIME-prefix group: TIMESTAMP before TIME
  NVarchar,
  Varbinary, VarChar,          // VAR-prefix group: VARBINARY before VARCHAR
  Alphanum, Shorttext,
  Integer, Bigint, Smallint, Tinyint,
  Decimal, Double, Float, Real, Boolean,
  Date, Time,                  // TIME after TIMESTAMP
  Clob, Nclob, Blob, Binary,
  // Identifiers (catch-all — after all keywords)
  QuotedIdentifier, Identifier,
  // Numeric literal
  IntegerLiteral,
  // Punctuation
  LParen, RParen, Comma, Semicolon, Dot
]
```

#### Exported symbols

```typescript
export const allTokens: TokenType[];
export const HdbTableTypeLexer: Lexer; // singleton — instantiated at module load
```

---

### 3.3 `src/parsers/hdbtabletype/parser.ts`

#### Responsibility

Define the grammar as a `CstParser` subclass. Expose a singleton parser instance.

#### Grammar notation

> `?` = optional, `*` = zero-or-more, `+` = one-or-more, `|` = alternation, `()` = grouping.

#### Grammar rules

```
createTableTypeStatement
    TYPE typeName AS TABLE LParen columnList RParen Semicolon?
    -- Top-level rule.  The TYPE keyword is mandatory (unlike CREATE TABLE).
    -- No GLOBAL TEMPORARY, COLUMN, or ROW variants exist for table types.

typeName
    identifier (Dot identifier)?
    -- identifier = Identifier | QuotedIdentifier
    -- handles both unquoted MY_TYPE and quoted "MY_SCHEMA"."MY_TYPE"

columnList
    (columnDefinition (Comma columnDefinition)*)?
    -- zero or more columns; empty list is valid (AC-9)

columnDefinition
    identifier dataType
    -- identifier is the column name (extracted by the visitor)
    -- dataType is parsed but NOT extracted

dataType
    dataTypeKeyword (LParen IntegerLiteral (Comma IntegerLiteral)? RParen)?
    -- e.g. NVARCHAR(100), DECIMAL(15, 2), INTEGER (no parens)
    -- precision and scale arguments are consumed but never extracted

dataTypeKeyword
    -- any of the data-type keyword tokens listed in §3.2

identifier
    Identifier | QuotedIdentifier
```

#### Key design: grammar simplicity

Unlike `.hdbtable`, the `.hdbtabletype` grammar has **no constraint clauses**, **no index definitions**, **no partition clauses**, and **no table options**. The grammar is `TYPE <name> AS TABLE ( <columns> )` and nothing else. This means `columnList` needs no `columnOrConstraint` alternation — every element is always a `columnDefinition`. The parser is deliberately kept minimal to match the reduced surface area of the artifact type.

#### Key design: `TYPE` keyword disambiguation

The `TYPE` keyword token is declared with `longer_alt: Identifier`, which means `TYPE_CODE` or `TYPED_AT` are correctly recognised as plain identifiers rather than triggering the `TypeKw` token. Similarly, `TABLE` and `AS` both use `longer_alt: Identifier` so column names like `ASSET`, `TABLE_NAME`, or `ASSEMBLED_BY` are tokenised as `Identifier` rather than keyword fragments.

#### Key design: `columnList` zero-or-more

The `columnList` rule is optional (`?`) rather than requiring at least one column (`+`). This handles the edge-case of an empty table type `TYPE T AS TABLE ()` without an error recovery cycle. An empty column list is unusual in practice but syntactically valid, and the parser should not fail on it (AC-9).

#### Error recovery

Use Chevrotain's default single-token insertion/deletion recovery. Do **not** override recovery methods — the defaults ensure partial CSTs are returned rather than exceptions when encountering unexpected syntax.

#### Exported symbols

```typescript
export class HdbTableTypeParser extends CstParser { ... }
export const hdbTableTypeParser: HdbTableTypeParser; // singleton
```

---

### 3.4 `src/parsers/hdbtabletype/visitor.ts`

#### Responsibility

Walk the CST produced by `HdbTableTypeParser` and emit one `{ type: 'field', name }` entry per `columnDefinition` node. Does not extract the type name, data type keyword, or any precision/scale arguments.

#### Design

The visitor extends `BaseCstVisitorWithDefaults` (obtained via `hdbTableTypeParser.getBaseCstVisitorConstructorWithDefaults()`). This variant auto-visits all child nodes for any method not explicitly overridden. Only `columnDefinition` needs to be implemented; all other grammar rules can be left to the default traversal.

#### Extraction logic: `columnDefinition`

```typescript
columnDefinition(ctx: CstChildrenDictionary): void {
    // The first identifier child of columnDefinition is always the column name.
    // The second child is the dataType rule — it is NOT visited for extraction.
    const nameNodes = ctx['identifier'] as CstNode[] | undefined;
    if (!nameNodes?.length) return;

    const name = this.extractName(nameNodes[0]);
    if (!name) return;

    this.columns.push({ type: 'field', name });
}
```

#### Blocking `typeName` extraction

`BaseCstVisitorWithDefaults` will auto-visit `typeName`, which also contains an `identifier` rule. To prevent the schema name or type name from being emitted as `field` subjects, override `typeName` with a no-op:

```typescript
typeName(_ctx: CstChildrenDictionary): void {
    // Intentionally empty — the type name and optional schema prefix are NOT
    // extracted as column field subjects.
}
```

#### Identifier normalisation

A private helper strips surrounding double-quotes from `QuotedIdentifier` image strings:

```typescript
private extractName(node: CstNode): string | undefined {
    if (!node.children) return undefined;
    const token =
        (node.children['Identifier']?.[0] as IToken | undefined) ??
        (node.children['QuotedIdentifier']?.[0] as IToken | undefined);
    if (!token) return undefined;
    const raw = token.image;
    return raw.startsWith('"') ? raw.slice(1, -1) : raw;
}
```

#### Exported symbols

```typescript
export class HdbTableTypeColumnVisitor { ... }
// columns: ExtractedSubject[]  — public field read by index.ts after visit
```

---

### 3.5 `src/parsers/hdbtabletype/index.ts`

#### Responsibility

Public API boundary. Orchestrates tokenise → parse → visit.

#### Implementation

```typescript
import type { ExtractedSubject } from '../../types/issues';
import { HdbTableTypeLexer } from './lexer';
import { hdbTableTypeParser } from './parser';
import { HdbTableTypeColumnVisitor } from './visitor';

export function extractTableTypeColumns(fileContent: string): ExtractedSubject[] {
    const lexResult = HdbTableTypeLexer.tokenize(fileContent);

    hdbTableTypeParser.input = lexResult.tokens;

    const cst = hdbTableTypeParser.createTableTypeStatement();

    if (!cst) {
        return [];
    }

    const visitor = new HdbTableTypeColumnVisitor();
    visitor.visit(cst);
    return visitor.columns;
}
```

Lex and parse errors are intentionally not re-thrown. The CST visitor extracts whatever columns were recoverable from the partial tree. Callers in `content-lint.ts` must not throw on bad input.

---

### 3.6 Changes to `src/content-lint.ts`

Two changes only:

1. **Add import** of the new extractor:

    ```typescript
    import { extractTableTypeColumns } from './parsers/hdbtabletype/index';
    ```

2. **Add branch** in `extractSubjects()`:

    ```typescript
    // BEFORE
    function extractSubjects(extension: string, fileContent: string): ExtractedSubject[] {
        if (extension === '.hdbtable') return extractTableColumns(fileContent);
        if (extension === '.hdbview') return extractViewColumns(fileContent);
        if (extension === '.hdbprocedure') return extractProcedureParameters(fileContent);
        if (extension === '.hdbfunction') return extractFunctionParameters(fileContent);
        return [];
    }

    // AFTER
    function extractSubjects(extension: string, fileContent: string): ExtractedSubject[] {
        if (extension === '.hdbtable') return extractTableColumns(fileContent);
        if (extension === '.hdbview') return extractViewColumns(fileContent);
        if (extension === '.hdbprocedure') return extractProcedureParameters(fileContent);
        if (extension === '.hdbfunction') return extractFunctionParameters(fileContent);
        if (extension === '.hdbtabletype') return extractTableTypeColumns(fileContent);
        return [];
    }
    ```

No other changes to `content-lint.ts`. `lintFileContent()`, `evaluateAllRules()`, `evaluateAnyRules()`, and `LintIssue` are untouched. No existing extractor functions are removed.

---

## 4. Data Models

No new persistent data models. The only types crossing the parser boundary are the existing `ExtractedSubject` and `ContentTarget`:

```typescript
// src/types/issues.ts — already exported; no changes needed
type ExtractedSubject = {
    readonly type: ContentTarget; // always 'field' for .hdbtabletype
    readonly name: string; // normalised identifier (double-quotes stripped)
};

// src/types/rules.ts — already exported; no changes needed
type ContentTarget = 'field' | 'inputParameter' | 'outputParameter';
```

The `.hdbtabletype` extractor exclusively emits `'field'` subjects, consistent with `.hdbtable`. A `contentRuleSet` targeting `inputParameter` or `outputParameter` against `.hdbtabletype` will simply match zero subjects — it is not an error condition.

---

## 5. API Specifications

### Public function

```typescript
/**
 * Extract column names from the content of a `.hdbtabletype` DDL file.
 *
 * Uses a Chevrotain lexer and CstParser. The parser recognises the
 * `TYPE <name> AS TABLE ( <columnList> )` statement and produces a CST
 * from which a visitor extracts each column name as a `field` subject.
 *
 * Handles block/line comments, quoted and unquoted column identifiers,
 * schema-qualified type names, and all HANA data types with optional
 * precision/scale. The type name itself is consumed structurally but
 * never emitted as a field subject. Gracefully returns partial results
 * on invalid input — does not throw.
 *
 * @param fileContent - Raw UTF-8 file content (LF or CRLF).
 * @returns Array of ExtractedSubject with type 'field' only.
 */
export function extractTableTypeColumns(fileContent: string): ExtractedSubject[];
```

### Internal module exports (not part of public API)

| Symbol                                     | Module       | Visibility       |
| ------------------------------------------ | ------------ | ---------------- |
| `allTokens`, `HdbTableTypeLexer`           | `lexer.ts`   | Package-internal |
| `HdbTableTypeParser`, `hdbTableTypeParser` | `parser.ts`  | Package-internal |
| `HdbTableTypeColumnVisitor`                | `visitor.ts` | Package-internal |

---

## 6. Unit Test Design

Test file: `src/parsers/hdbtabletype/__tests__/extractTableTypeColumns.test.ts`

The test file follows the same structure as `extractTableColumns.test.ts`: one `describe` block per acceptance criterion, with typed helper functions for readability.

```typescript
import { describe, it, expect } from 'vitest';
import { extractTableTypeColumns } from '../index';

function fields(ddl: string): string[] {
    return extractTableTypeColumns(ddl)
        .filter((s) => s.type === 'field')
        .map((s) => s.name);
}
```

### Test cases by acceptance criterion

**AC-1 — Standard column extraction**

```typescript
describe('AC-1: standard column extraction', () => {
    it('extracts all column names as field subjects in declaration order', () => {
        const ddl = `
            TYPE "MY_TYPE" AS TABLE (
                ID       INTEGER,
                NAME     NVARCHAR(100),
                CREATED_AT TIMESTAMP
            );
        `;
        expect(extractTableTypeColumns(ddl)).toEqual([
            { type: 'field', name: 'ID' },
            { type: 'field', name: 'NAME' },
            { type: 'field', name: 'CREATED_AT' }
        ]);
    });

    it('handles a single-column table type', () => {
        const ddl = `TYPE "T" AS TABLE (STATUS NVARCHAR(1));`;
        expect(fields(ddl)).toEqual(['STATUS']);
    });
});
```

**AC-2 — Block comment exclusion**

```typescript
describe('AC-2: block comment exclusion', () => {
    it('does not extract a column wrapped in /* … */', () => {
        const ddl = `
            TYPE "T" AS TABLE (
                ID INTEGER,
                /* OLD_FIELD NVARCHAR(10), */
                NAME NVARCHAR(100)
            );
        `;
        expect(fields(ddl)).not.toContain('OLD_FIELD');
        expect(fields(ddl)).toContain('ID');
        expect(fields(ddl)).toContain('NAME');
    });

    it('does not extract a multi-line block-commented column', () => {
        const ddl = `
            TYPE "T" AS TABLE (
                /*
                  ARCHIVED_FLAG BOOLEAN,
                */
                ACTIVE_FLAG BOOLEAN
            );
        `;
        expect(fields(ddl)).not.toContain('ARCHIVED_FLAG');
        expect(fields(ddl)).toContain('ACTIVE_FLAG');
    });
});
```

**AC-3 — Line comment exclusion**

```typescript
describe('AC-3: line comment exclusion', () => {
    it('does not extract a column on a -- comment line', () => {
        const ddl = `
            TYPE "T" AS TABLE (
                ID INTEGER
                -- , OLD_FIELD NVARCHAR(10)
            );
        `;
        expect(fields(ddl)).not.toContain('OLD_FIELD');
        expect(fields(ddl)).toContain('ID');
    });
});
```

**AC-4 — Quoted identifier normalisation**

```typescript
describe('AC-4: quoted identifier normalisation', () => {
    it('strips double-quotes from a quoted column name', () => {
        const ddl = `TYPE "T" AS TABLE ("MY_COLUMN" NVARCHAR(100));`;
        expect(extractTableTypeColumns(ddl)).toContainEqual({ type: 'field', name: 'MY_COLUMN' });
    });

    it('handles a fully quoted table with quoted type name and quoted columns', () => {
        const ddl = `
            TYPE "MY_SCHEMA"."MY_TYPE" AS TABLE (
                "ID" INTEGER,
                "AMOUNT" DECIMAL(15, 2)
            );
        `;
        expect(fields(ddl)).toEqual(['ID', 'AMOUNT']);
    });
});
```

**AC-5 — Unquoted identifier extraction**

```typescript
describe('AC-5: unquoted identifier extraction', () => {
    it('extracts an unquoted column name without modification', () => {
        const ddl = `TYPE MY_TYPE AS TABLE (MY_COLUMN NVARCHAR(100));`;
        expect(extractTableTypeColumns(ddl)).toContainEqual({ type: 'field', name: 'MY_COLUMN' });
    });
});
```

**AC-6 — Schema-qualified type name does not affect extraction**

```typescript
describe('AC-6: schema-qualified type name not extracted as field', () => {
    it('does not emit the schema or type name as a field subject', () => {
        const ddl = `
            TYPE "MY_SCHEMA"."MY_TYPE" AS TABLE (
                COL_A INTEGER,
                COL_B NVARCHAR(50)
            );
        `;
        const names = fields(ddl);
        expect(names).not.toContain('MY_SCHEMA');
        expect(names).not.toContain('MY_TYPE');
        expect(names).toEqual(['COL_A', 'COL_B']);
    });
});
```

**AC-7 — Data type precision arguments not extracted as columns**

```typescript
describe('AC-7: data type precision arguments not extracted', () => {
    it('does not emit numeric precision/scale arguments as field subjects', () => {
        const ddl = `
            TYPE "T" AS TABLE (
                AMOUNT DECIMAL(15, 2),
                LABEL  NVARCHAR(200)
            );
        `;
        const result = extractTableTypeColumns(ddl);
        const names = result.map((s) => s.name);
        expect(names).not.toContain('DECIMAL');
        expect(names).not.toContain('15');
        expect(names).not.toContain('2');
        expect(names).toContain('AMOUNT');
        expect(names).toContain('LABEL');
    });

    it('handles all HANA-specific data types without failures', () => {
        const ddl = `
            TYPE "T" AS TABLE (
                A SECONDDATE,
                B SHORTTEXT(255),
                C ALPHANUM(20),
                D VARBINARY(512),
                E NCLOB,
                F BIGINT,
                G BOOLEAN,
                H BLOB
            );
        `;
        expect(fields(ddl)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    });
});
```

**AC-8 — Multi-line column definitions**

```typescript
describe('AC-8: multi-line column definitions', () => {
    it('correctly extracts a column name when the data type is on the next line', () => {
        const ddl = `
            TYPE "T" AS TABLE (
                LONG_COLUMN_NAME
                    NVARCHAR(500),
                OTHER_COL INTEGER
            );
        `;
        expect(fields(ddl)).toEqual(['LONG_COLUMN_NAME', 'OTHER_COL']);
    });
});
```

**AC-9 — Empty column list**

```typescript
describe('AC-9: empty column list', () => {
    it('returns an empty array and does not throw for TYPE T AS TABLE ()', () => {
        const ddl = `TYPE "MY_TYPE" AS TABLE ();`;
        expect(() => extractTableTypeColumns(ddl)).not.toThrow();
        expect(extractTableTypeColumns(ddl)).toEqual([]);
    });
});
```

**AC-10 — Graceful error on unparseable file**

```typescript
describe('AC-10: graceful error on unparseable file', () => {
    it('does not throw on completely invalid input', () => {
        expect(() => extractTableTypeColumns('THIS IS NOT VALID DDL @@##')).not.toThrow();
    });

    it('does not throw on empty string', () => {
        expect(() => extractTableTypeColumns('')).not.toThrow();
        expect(extractTableTypeColumns('')).toEqual([]);
    });

    it('returns partial results for a file that is cut off mid-definition', () => {
        const ddl = `
            TYPE "T" AS TABLE (
                ID INTEGER,
                NAME NVARCHAR(
        `;
        // At minimum, ID should be extracted; the function must not throw.
        expect(() => extractTableTypeColumns(ddl)).not.toThrow();
        expect(fields(ddl)).toContain('ID');
    });
});
```

**AC-11 — Integration with `lintFileContent` pipeline**

```typescript
describe('AC-11: integration with lintFileContent pipeline', () => {
    it('produces LintIssue entries for columns violating a field naming rule', async () => {
        // This test exercises the wiring in content-lint.ts.
        // Import lintFileContent and provide a mock file + matching contentRuleSet.
        // The assertion verifies that .hdbtabletype fields reach the evaluation pipeline.
        // NOTE: Full integration test implementation uses vitest mocking of fs.readFile;
        // see the existing hdbtable integration tests for the pattern.
        // The key assertion is that a column named 'bad_name' triggers a LintIssue
        // when a 'field' rule requires SCREAMING_SNAKE_CASE.
    });
});
```

**AC-12 — Build integrity**

> Verified by running `npm run build` after implementation. Not a runtime unit test.

---

## 7. Security and Performance Considerations

### Security

- **No shell execution / no file system access** in the parser module. `extractTableTypeColumns` accepts a pre-read string; it never reads files itself.
- **ReDoS risk**: the `BlockComment` pattern `/\/\*[\s\S]*?\*\//` uses a lazy quantifier. Chevrotain applies lexer patterns to input slices, not the full string, which limits backtracking exposure. The pattern is identical to those used in the existing four parsers and has been deemed acceptable.
- **No dynamic token construction**: all `createToken` calls use hard-coded string or regex literals. No user-supplied content is ever evaluated as a pattern.

### Performance

- **Singleton instantiation**: `HdbTableTypeLexer` and `hdbTableTypeParser` are created once at module load time. Subsequent calls to `extractTableTypeColumns` re-use the same instances and only set `hdbTableTypeParser.input` before each parse run, consistent with Chevrotain best practices.
- **Grammar size**: the `.hdbtabletype` grammar is the smallest in the parser suite (three non-terminal rules). Parse time is dominated by lexer throughput. Files up to 2,000 lines are expected to parse in well under 10 ms on commodity hardware, comfortably within the 100 ms NFR.
- **No CST node accumulation outside `columnDefinition`**: the visitor visits `typeName` as a no-op and `columnList` implicitly via the default traversal. No intermediate arrays are allocated beyond the `columns` result array.

---

## 8. Implementation Milestones

| #   | Deliverable                           | Acceptance signal                                                                      |
| --- | ------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | `src/parsers/hdbtabletype/lexer.ts`   | All tokens declared; singleton exports verified; no Chevrotain `WARNING` logs on load  |
| 2   | `src/parsers/hdbtabletype/parser.ts`  | Grammar compiles; singleton instantiated; `hdbTableTypeParser.input = []` runs cleanly |
| 3   | `src/parsers/hdbtabletype/visitor.ts` | `HdbTableTypeColumnVisitor` constructed against parser; no type errors                 |
| 4   | `src/parsers/hdbtabletype/index.ts`   | `extractTableTypeColumns('')` returns `[]` without throwing                            |
| 5   | Unit tests (AC-1 through AC-10)       | All tests pass (`npm test`)                                                            |
| 6   | `src/content-lint.ts` wired           | AC-11 integration test passes; existing `.hdbtable` / `.hdbfunction` tests unaffected  |
| 7   | `npm run build` clean                 | Zero TypeScript errors                                                                 |

---

## 9. Risk Assessment

| Risk                                                                         | Likelihood | Impact | Mitigation                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chevrotain `longer_alt` misconfiguration causes identifier keywords to split | Low        | Medium | All keyword tokens declare `longer_alt: Identifier`; mirrored from working `.hdbtable` implementation. Covered by AC-5 unquoted identifier test.                                                             |
| `TYPE` keyword collides with column named `TYPE`                             | Low        | Low    | `longer_alt: Identifier` ensures `TYPE_CODE` parses as identifier. A column literally named `TYPE` (unquoted, no quotes) would be tokenised as `TypeKw` — acceptable as HANA discourages bare keyword names. |
| Token prefix ordering error (e.g. `VARCHAR` before `VARBINARY`)              | Low        | Medium | Token order is explicit and documented; `Varbinary` is listed before `VarChar` in both the catalogue and `allTokens` array. Covered by AC-7 HANA data type test.                                             |
| Empty column list triggers parser error rather than empty result             | Very low   | Low    | Grammar uses `(columnDefinition (Comma columnDefinition)*)?` — the outer `?` makes the entire list optional. Covered by AC-9.                                                                                |
| `typeName` identifier leaks into `field` subjects                            | Low        | Medium | `typeName` is overridden as a no-op in the visitor. Covered by AC-6.                                                                                                                                         |
| Regression in existing parsers from shared `content-lint.ts` edit            | Very low   | Medium | The only change to `content-lint.ts` is one `import` line and one `if` branch added at the end of `extractSubjects()`. Existing branches are untouched.                                                      |
