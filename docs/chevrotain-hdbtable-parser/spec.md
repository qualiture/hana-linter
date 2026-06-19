# Technical Design Specification: Chevrotain Parser Infrastructure & `.hdbtable` Lexer/Parser

**PRD**: [prd.md](./prd.md)  
**Feature**: Chevrotain Parser Infrastructure + `.hdbtable` Column Extractor  
**Status**: Ready for Implementation

---

## 1. System Architecture Overview

### Current state

`src/content-lint.ts` contains a self-contained function `extractTableFields()` that splits the file into lines and applies a pair of regex patterns to every line to guess whether it is a column definition. The result is a flat `ExtractedSubject[]` array fed back into the naming-rule evaluation pipeline.

```
content-lint.ts
  └── extractSubjects()
        └── extractTableFields()   ← line-by-line regex  (TO BE REPLACED)
```

### Target state

A new `src/parsers/` directory hosts one sub-module per HANA artifact type. The `.hdbtable` sub-module owns its lexer, parser, and CST visitor, and exposes a single public function. `content-lint.ts` calls that function instead of the old regex extractor.

```
content-lint.ts
  └── extractSubjects()
        └── extractTableColumns()  ← delegates to parser module  (NEW)

src/parsers/hdbtable/
  ├── lexer.ts      Token definitions + singleton Lexer instance
  ├── parser.ts     CstParser subclass + grammar rules
  ├── visitor.ts    CST visitor that collects column names
  └── index.ts      Public API: extractTableColumns()
```

Everything above `extractSubjects()` — `lintFileContent()`, `runLint()`, `LintIssue`, and the public `src/index.ts` entry point — is unchanged.

---

## 2. Technology Stack

| Concern          | Choice                               | Rationale                                                                                                                                                                              |
| ---------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parser framework | **Chevrotain** (latest stable v11.x) | TypeScript-native, zero native binaries, singleton-friendly, ships its own types, no grammar compilation step, built-in error recovery, used in production by VS Code CSS/JSON parsers |
| Language         | TypeScript (existing)                | Matches the project                                                                                                                                                                    |
| Build            | `tsc` (existing)                     | No additional build tooling needed                                                                                                                                                     |
| Runtime          | Node.js (existing)                   | No change                                                                                                                                                                              |

**Install command:**

```bash
npm install chevrotain
```

`chevrotain` must be added to `dependencies` (not `devDependencies`) in `package.json` because it is required at runtime by the CLI binary.

---

## 3. Component Design

### 3.1 File layout

```
src/
  parsers/
    hdbtable/
      lexer.ts
      parser.ts
      visitor.ts
      index.ts
```

No `src/parsers/index.ts` barrel is needed yet; `content-lint.ts` imports directly from `src/parsers/hdbtable/index.ts`.

### 3.2 `src/parsers/hdbtable/lexer.ts`

#### Responsibility

Define every token the grammar needs and export a singleton `Lexer` instance.

#### Token ordering rules (Chevrotain-specific)

Chevrotain matches tokens in declaration order. Two rules apply:

1. Longer/more-specific patterns must be declared **before** shorter ones (e.g. `NVARCHAR` before generic `Identifier`).
2. Every keyword token must declare `longer_alt: Identifier` so that an identifier that _starts_ with a keyword (e.g. `NULLABLE`) is not split.

#### Token catalogue

**Skip tokens** (declared first so they are consumed before anything else):

| Token name     | Pattern              | Mode                       |
| -------------- | -------------------- | -------------------------- |
| `BlockComment` | `/\/\*[\s\S]*?\*\//` | `{ group: Lexer.SKIPPED }` |
| `LineComment`  | `/--[^\r\n]*/`       | `{ group: Lexer.SKIPPED }` |
| `WhiteSpace`   | `/\s+/`              | `{ group: Lexer.SKIPPED }` |

**Literal tokens:**

| Token name       | Pattern      |
| ---------------- | ------------ | --------- |
| `StringLiteral`  | `/'(?:[^'\\] | \\.)\*'/` |
| `IntegerLiteral` | `/[0-9]+/`   |

**Punctuation tokens:**

| Token name  | Pattern |
| ----------- | ------- |
| `LParen`    | `(`     |
| `RParen`    | `)`     |
| `Comma`     | `,`     |
| `Semicolon` | `;`     |
| `Dot`       | `.`     |
| `Equals`    | `=`     |

**DDL keyword tokens** (all with `longer_alt: Identifier`):

`CREATE`, `TABLE`, `COLUMN`, `ROW`, `GLOBAL`, `TEMPORARY`, `CONSTRAINT`,
`PRIMARY`, `UNIQUE`, `FOREIGN`, `KEY`, `REFERENCES`, `CHECK`, `INDEX`,
`PARTITION`, `WITH`, `NOT`, `NULL`, `DEFAULT`, `AS`, `NO`, `ACTION`,
`CASCADE`, `RESTRICT`

**Data-type keyword tokens** (all with `longer_alt: Identifier`):

`NVARCHAR`, `VARCHAR`, `ALPHANUM`, `SHORTTEXT`, `TEXT`, `BINTEXT`,
`INTEGER`, `INT`, `BIGINT`, `SMALLINT`, `TINYINT`,
`DECIMAL`, `NUMERIC`, `FLOAT`, `DOUBLE`, `REAL`,
`BOOLEAN`, `DATE`, `TIME`, `TIMESTAMP`, `SECONDDATE`,
`CLOB`, `NCLOB`, `BLOB`, `VARBINARY`,
`ST_POINT`, `ST_GEOMETRY`

**Identifier tokens** (declared last, act as catch-all):

| Token name         | Pattern                    | Notes                                                        |
| ------------------ | -------------------------- | ------------------------------------------------------------ |
| `QuotedIdentifier` | `/\"[^\"]*\"/`             | Declared **before** `Identifier`                             |
| `Identifier`       | `/[A-Za-z_][A-Za-z0-9_]*/` | Catch-all; all keyword tokens use `longer_alt` pointing here |

#### Exported symbols

```typescript
export const allTokens: TokenType[]; // ordered array passed to Lexer constructor
export const HdbTableLexer: Lexer; // singleton — instantiated at module load
```

---

### 3.3 `src/parsers/hdbtable/parser.ts`

#### Responsibility

Define the grammar as a `CstParser` subclass. Expose a singleton parser instance.

#### Grammar rules

> Notation: `?` = optional, `*` = zero-or-more, `+` = one-or-more, `|` = alternation, `()` = grouping.

```
createTableStatement
    tableHeader tableName columnBody tableOptions? Semicolon?

tableHeader
    CREATE (GLOBAL TEMPORARY)? (COLUMN | ROW)? TABLE

tableName
    (tableIdentifier Dot)? tableIdentifier
    -- tableIdentifier = Identifier | QuotedIdentifier

columnBody
    LParen columnList RParen

columnList
    columnOrConstraint (Comma columnOrConstraint)*

columnOrConstraint
    columnDefinition | inlineConstraint

columnDefinition
    identifier dataType columnConstraint*

inlineConstraint
    CONSTRAINT identifier? constraintBody
    | constraintBody

constraintBody
    primaryKeyConstraint
    | uniqueConstraint
    | foreignKeyConstraint
    | checkConstraint

primaryKeyConstraint
    PRIMARY KEY LParen identifierList RParen indexOptions?

uniqueConstraint
    UNIQUE INDEX? identifier? LParen identifierList RParen indexOptions?

foreignKeyConstraint
    FOREIGN KEY LParen identifierList RParen
    REFERENCES tableName LParen identifierList RParen foreignKeyActions?

checkConstraint
    CHECK LParen checkExpression RParen

checkExpression
    -- Loosely: consume any tokens/parens until balanced RParen
    (anyToken | LParen checkExpression RParen)*

columnConstraint
    NOT NULL
    | NULL
    | DEFAULT columnDefault
    | PRIMARY KEY   -- inline single-column PK shorthand

columnDefault
    StringLiteral | IntegerLiteral | NULL | identifier

dataType
    dataTypeKeyword (LParen IntegerLiteral (Comma IntegerLiteral)? RParen)?

dataTypeKeyword
    -- any of the data type tokens listed in §3.2

identifier
    Identifier | QuotedIdentifier

identifierList
    identifier (Comma identifier)*

indexOptions
    -- optional trailing options (NOLOGGING, FILL FACTOR…); skip greedily

tableOptions
    -- WITH PARAMETERS (…) or any trailing clauses after the column body
    -- Loosely consumed: not extracted, must not throw
    WITH anyToken*
```

#### Error recovery

Use Chevrotain's default single-token insertion/deletion recovery. Do **not** override `canRecoverWithSingleTokenInsertion` — the defaults are adequate for DDL recovery.

#### Exported symbols

```typescript
export class HdbTableParser extends CstParser { ... }
export const hdbTableParser: HdbTableParser;  // singleton
```

---

### 3.4 `src/parsers/hdbtable/visitor.ts`

#### Responsibility

Walk the CST produced by the parser and collect the name of every `columnDefinition` node's first `identifier` child.

#### Design

Chevrotain CST visitors are generated via `hdbTableParser.getBaseCstVisitorConstructor()` (type-safe) or `getBaseCstVisitorConstructorWithDefaults()` (auto-visits children). Use the **with-defaults** variant so unhandled nodes are silently skipped.

```typescript
class HdbTableColumnVisitor extends BaseCstVisitorWithDefaults {
    columnDefinition(ctx: ColumnDefinitionCstChildren): void {
        // ctx.identifier is always the first child — the column name.
        const node = ctx.identifier?.[0];
        if (!node) return;

        const token = node.children.Identifier?.[0] ?? node.children.QuotedIdentifier?.[0];
        if (!token) return;

        const raw = token.image;
        const name = raw.startsWith('"') ? raw.slice(1, -1) : raw;
        this.columns.push({ type: 'field', name });
    }
}
```

The visitor accumulates results in a `columns: ExtractedSubject[]` field that the public API reads after the visit.

#### Exported symbols

```typescript
export class HdbTableColumnVisitor { ... }
```

---

### 3.5 `src/parsers/hdbtable/index.ts`

#### Responsibility

Public API boundary. Owns the end-to-end orchestration: tokenise → parse → visit.

#### Implementation

```typescript
import { ExtractedSubject } from '../../content-lint'; // re-uses existing type
import { HdbTableLexer } from './lexer';
import { hdbTableParser } from './parser';
import { HdbTableColumnVisitor } from './visitor';

export function extractTableColumns(fileContent: string): ExtractedSubject[] {
    const lexResult = HdbTableLexer.tokenize(fileContent);

    hdbTableParser.input = lexResult.tokens;

    const cst = hdbTableParser.createTableStatement();

    // Errors are intentionally ignored here — partial CST is still visited.
    // Callers (content-lint.ts) must not throw on bad input.

    const visitor = new HdbTableColumnVisitor();
    visitor.visit(cst);
    return visitor.columns;
}
```

> **Note on `ExtractedSubject` import**: The type is currently defined inline in `src/content-lint.ts`. Before or during this implementation it must be promoted to `src/types/issues.ts` (or a new `src/types/parser.ts`) and re-exported so both `content-lint.ts` and the parser module can import it. This is a required prerequisite step.

---

### 3.6 Changes to `src/content-lint.ts`

Two changes only:

1. **Add import** at the top:

    ```typescript
    import { extractTableColumns } from './parsers/hdbtable/index';
    ```

2. **Replace** the `extractTableFields()` dispatch inside `extractSubjects()`:

    ```typescript
    // BEFORE
    if (extension === '.hdbtable') {
        return extractTableFields(fileContent);
    }

    // AFTER
    if (extension === '.hdbtable') {
        return extractTableColumns(fileContent);
    }
    ```

3. **Delete** the `extractTableFields()` function and the `skipKeywords` constant entirely.

No other changes to `content-lint.ts`. The `lintFileContent()` signature, `evaluateAllRules()`, `evaluateAnyRules()`, and the `ExtractedSubject` type (once extracted to a shared location) remain identical.

---

## 4. Data Models

No new persistent data models. The only type that crosses the parser boundary is the existing `ExtractedSubject`:

```typescript
type ExtractedSubject = {
    readonly type: ContentTarget; // 'field' | 'inputParameter' | 'outputParameter'
    readonly name: string; // normalised identifier (quotes stripped)
};
```

### Type promotion (prerequisite)

`ExtractedSubject` is currently a module-private type in `content-lint.ts`. It must be moved to `src/types/issues.ts` (alongside `LintIssue`) and exported, so both `content-lint.ts` and `src/parsers/hdbtable/index.ts` can import it without a circular dependency.

```typescript
// src/types/issues.ts  — add alongside LintIssue
export type ExtractedSubject = {
    readonly type: ContentTarget;
    readonly name: string;
};
```

---

## 5. API Specifications

### Public function

```typescript
/**
 * Extract column names from the content of a `.hdbtable` DDL file.
 *
 * Uses a Chevrotain lexer and CstParser. Handles block/line comments,
 * multi-line definitions, quoted and unquoted identifiers, and HANA-
 * specific table variants (COLUMN TABLE, ROW TABLE, GLOBAL TEMPORARY
 * COLUMN TABLE). Gracefully returns partial results on invalid input.
 *
 * @param fileContent - Raw UTF-8 file content (LF or CRLF).
 * @returns Array of ExtractedSubject with type 'field' for each column.
 */
export function extractTableColumns(fileContent: string): ExtractedSubject[];
```

### Internal module exports (not part of public API)

| Symbol                             | Module       | Visibility       |
| ---------------------------------- | ------------ | ---------------- |
| `allTokens`, `HdbTableLexer`       | `lexer.ts`   | Package-internal |
| `HdbTableParser`, `hdbTableParser` | `parser.ts`  | Package-internal |
| `HdbTableColumnVisitor`            | `visitor.ts` | Package-internal |

---

## 6. Security Considerations

- **ReDoS**: The `BlockComment` pattern `/\/\*[\s\S]*?\*\//` uses lazy quantifier. This is safe for file content; no user-controlled input reaches the CLI without first being read from disk.
- **Input size**: Chevrotain tokenises in linear time. A 10,000-line `.hdbtable` file is well within the 100 ms NFR.
- **No eval / dynamic code execution**: Chevrotain defines grammars as plain TypeScript objects; no runtime code generation occurs.
- **Dependency supply chain**: `chevrotain` is published by SAP (original maintainer) and has no transitive production dependencies. Verify the package checksum via `npm ci` and lock-file during CI.

---

## 7. Performance Considerations

- **Singleton instantiation** (NFR-3): Both `HdbTableLexer` and `hdbTableParser` are created once when the module is first `require()`-d. Grammar serialisation / validation cost (incurred at construction) is paid once per process lifetime, not per file.
- **Visitor allocation per file**: A new `HdbTableColumnVisitor` instance is created for each `extractTableColumns()` call. This is negligible; visitor construction is O(1).
- **Input normalisation**: Do **not** pre-normalise CRLF→LF before tokenising. The `WhiteSpace` SKIP token (`/\s+/`) handles both transparently. Normalising would allocate a second copy of potentially large strings.

---

## 8. Implementation Approach and Milestones

### Milestone 1 — Type promotion (prerequisite, ~30 min)

1. Move `ExtractedSubject` from its inline definition in `content-lint.ts` to `src/types/issues.ts`.
2. Update the import in `content-lint.ts`.
3. Run `npm run build` — zero errors expected.

### Milestone 2 — Lexer (`src/parsers/hdbtable/lexer.ts`, ~1 h)

1. Install `chevrotain`.
2. Define all tokens per §3.2.
3. Assemble `allTokens` array in the required order.
4. Instantiate `HdbTableLexer`.
5. Smoke-test with a simple `HdbTableLexer.tokenize(...)` call.

### Milestone 3 — Parser (`src/parsers/hdbtable/parser.ts`, ~2 h)

1. Implement `HdbTableParser extends CstParser` with grammar rules per §3.3.
2. Call `this.performSelfAnalysis()` at end of constructor.
3. Instantiate singleton `hdbTableParser`.
4. Build and confirm zero type errors.

### Milestone 4 — Visitor (`src/parsers/hdbtable/visitor.ts`, ~45 min)

1. Retrieve base visitor constructor from `hdbTableParser`.
2. Implement `HdbTableColumnVisitor` per §3.4.
3. Confirm it collects names from a hard-coded CST fixture.

### Milestone 5 — Public API & integration (`src/parsers/hdbtable/index.ts` + `content-lint.ts`, ~30 min)

1. Implement `extractTableColumns()` per §3.5.
2. Update `content-lint.ts` per §3.6.
3. Run `npm run build` — zero errors expected.

### Milestone 6 — Verification (~1 h)

1. Run the linter against real `.hdbtable` files and compare output to the previous regex extractor.
2. Manually verify AC-1 through AC-9 from the PRD.

---

## 9. Risk Assessment

| Risk                                                                                                                        | Probability | Impact | Mitigation                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chevrotain v11 API differs from older docs found online                                                                     | Medium      | Medium | Use the [official v11 docs](https://chevrotain.io/docs/) exclusively; the `chevrotain` npm package ships complete TS types — use IDE autocomplete as the authoritative reference |
| Grammar is incomplete for exotic HANA DDL constructs                                                                        | Medium      | Low    | Error recovery + graceful partial return means lint still runs; the `checkExpression` and `tableOptions` rules are defined loosely to absorb unknown tokens                      |
| `ExtractedSubject` type promotion causes merge conflicts with in-flight PRs                                                 | Low         | Low    | The move is a single-file change and the type shape is unchanged                                                                                                                 |
| Chevrotain singleton `hdbTableParser.input` is not thread-safe                                                              | N/A         | N/A    | Node.js is single-threaded; no concern                                                                                                                                           |
| False regressions from grammar: columns the regex extractor extracted incorrectly (i.e. false positives) will now disappear | Low         | Low    | These disappearances are correct behaviour; no real regression — but may surface as test noise if tests were written against the buggy regex output                              |
