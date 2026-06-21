# PRD: Chevrotain Lexer/Parser for `.hdbindex` Index Name Extraction

## 1. Feature Name

**Chevrotain `.hdbindex` Index Name Extractor**

---

## 2. Goal

### Problem

The current `extractSubjects()` function in `src/content-lint.ts` has no handler for `.hdbindex` files. When a user configures `contentRuleSets` targeting `.hdbindex` index names, the linter silently returns an empty result — no index names are extracted, no lint issues are raised, and the user receives no indication that content-level linting is unsupported for this artifact type.

The structure of an `.hdbindex` file is syntactically concise but introduces parsing challenges that make a simple regex approach unreliable:

- **Multiple index type keywords** — SAP HANA supports several index types (`BTREE`, `CPBTREE`, `INVERTED HASH`, `INVERTED VALUE`, `INVERTED INDIVIDUAL`). Some of these are multi-word keyword sequences (`INVERTED HASH`, `INVERTED VALUE`, `INVERTED INDIVIDUAL`). A line-by-line regex scanning for the index name after the `INDEX` keyword will encounter these keyword tokens before it and risk misidentifying them as part of the identifier it is looking for.
- **Optional `UNIQUE` and `CREATE` prefixes** — The `CREATE` keyword and the `UNIQUE` flag are both optional. Files may begin with bare `INDEX <name>`, `CREATE INDEX <name>`, `CREATE UNIQUE INDEX <name>`, or `CREATE UNIQUE INVERTED HASH INDEX <name>`. A regex anchored to any particular prefix form will silently fail on files that use a different variant.
- **Quoted and unquoted names** — Both the index name and the target table name may appear in double-quoted (`"MY_INDEX"`) or unquoted (`MY_INDEX`) form. A pattern tuned for one form will silently miss the other.
- **Schema-qualified table and index names** — Index names and table names are often schema-qualified (e.g., `"MY_SCHEMA"."MY_INDEX"` or `"MY_SCHEMA"."MY_TABLE"`). The dot separator and surrounding quotes must not be treated as identifier boundaries by a naive scanner, and the schema qualifier must not be confused with the local index name.
- **Column list with sort order keywords** — The column list in `ON <tableName> (<column1> [ASC|DESC], <column2> [ASC|DESC], ...)` contains identifiers that a simple regex may mis-identify as additional index names.
- **Block and line comments** — Developers comment out entire index definitions or individual clauses during development (`/* ... */` or `-- ...`); these must be fully excluded from extraction.
- **Optional semicolon terminator** — Some authoring tools omit the trailing `;`; the parser must tolerate both forms without error.

These failure modes mean that teams enforcing naming conventions on HANA index names currently receive no feedback from the linter at all.

### Solution

Implement a Chevrotain-based lexer and parser for `.hdbindex` files under `src/parsers/hdbindex/`, following the same architectural patterns established by the existing `.hdbtable`, `.hdbview`, `.hdbprocedure`, `.hdbfunction`, `.hdbtabletype`, `.hdbrole`, `.hdbcalculationview`, `.hdbsequence`, and `.hdbschedulerjob` parsers. The parser tokenises the file, identifies the `[CREATE] [UNIQUE] [<indexType>] INDEX <name>` declaration, and produces a CST from which a visitor extracts the index name. Wire the new extractor into `extractSubjects()` in `src/content-lint.ts` and extend the `ContentTarget` union type in `src/types/rules.ts` with the new `'indexName'` value.

### Impact

- Enables content-level naming-convention rules for `.hdbindex` index names, a previously unsupported artifact type.
- Eliminates the silent no-op that currently affects teams who configure `contentRuleSets` for `.hdbindex`.
- Extends the `ContentTarget` type with the semantically precise value `indexName`, aligning with how teams express index naming policies.
- Reuses and validates the parser infrastructure across a tenth HANA artifact type, further reinforcing its conventions and reducing the cost of any subsequent artifact parsers.

---

## 3. User Personas

**HANA Developer / CAP Developer**
A developer working on an SAP CAP or native HANA project who defines `.hdbindex` files to create secondary indexes on database tables. They configure `hana-linter` to enforce naming conventions on index names (e.g., all index names must carry a project-specific prefix such as `IDX_`, use `SCREAMING_SNAKE_CASE`, or end with a table-name suffix). They run the linter locally and in CI. False positives block PRs unnecessarily; false negatives allow convention violations to ship.

**Tooling / Platform Engineer**
An engineer who maintains or extends `hana-linter` for their team or organisation. They need the `.hdbindex` parser to follow the same structural conventions as the existing parsers so that the codebase remains uniform and future artifact parsers are straightforward to add.

---

## 4. User Stories

### Primary path

- **US-1**: As a HANA Developer, I want the linter to extract the name of the index defined in an `.hdbindex` file as an `indexName` subject, so that naming-convention rules can be applied to the index's declared name.

- **US-2**: As a HANA Developer, I want inline `/* block comments */` and `-- line comments` inside `.hdbindex` files to be completely ignored during extraction, so that commented-out definitions never trigger lint warnings.

- **US-3**: As a HANA Developer, I want the column list following the `ON <tableName>` clause to be consumed without error and entirely ignored during name extraction, so that column identifiers inside the index definition do not produce false extractions.

### Edge cases

- **US-4**: As a HANA Developer, I want both quoted (`"MY_INDEX"`) and unquoted (`MY_INDEX`) index names to be extracted and normalised (double-quotes stripped), so that mixed-style `.hdbindex` files are linted without error.

- **US-5**: As a HANA Developer, I want schema-qualified index names (`"MY_SCHEMA"."MY_INDEX"`) to be parsed without error and the local name (after the dot) extracted as the `indexName` subject, so that cross-schema index definitions are fully supported.

- **US-6**: As a HANA Developer, I want all supported HANA index type variants (`BTREE`, `CPBTREE`, `INVERTED HASH`, `INVERTED VALUE`, `INVERTED INDIVIDUAL`) to be consumed without error so that any combination of valid `.hdbindex` syntax is handled gracefully.

- **US-7**: As a HANA Developer, I want the optional `UNIQUE` keyword and the optional `CREATE` keyword to be accepted or absent in any combination (`INDEX ...`, `CREATE INDEX ...`, `CREATE UNIQUE INDEX ...`, `CREATE UNIQUE INVERTED HASH INDEX ...`), so that all authoring styles are supported without parser errors.

- **US-8**: As a HANA Developer, I want a trailing semicolon to be accepted but not required, so that files produced by different tooling variants are supported without parser errors.

- **US-9**: As a HANA Developer, I want column sort-order keywords (`ASC`, `DESC`) inside the column list to be consumed without error and ignored during name extraction, so that index definitions with explicit sort orders are fully supported.

- **US-10**: As a Tooling Engineer, I want the Chevrotain parser to emit structured parse errors (not throw unhandled exceptions) when it encounters unrecognised syntax, so that the linter degrades gracefully and reports a clear diagnostic instead of crashing.

- **US-11**: As a Tooling Engineer, I want the parser layer to expose a stable TypeScript interface (`extractIndexName(fileContent: string): ExtractedSubject[]`) so that `content-lint.ts` is not coupled to Chevrotain internals and future parser upgrades are isolated.

---

## 5. Requirements

### Functional Requirements

- **FR-1** Create a dedicated parser sub-module at `src/parsers/hdbindex/` containing `lexer.ts`, `parser.ts`, `visitor.ts`, and `index.ts`, following the same file-structure conventions as the existing HANA artifact parser modules.

- **FR-2** Implement an `.hdbindex` lexer (`src/parsers/hdbindex/lexer.ts`) using Chevrotain's `createToken` and `Lexer` APIs. The lexer must define tokens for, at minimum:
    - Skip tokens: block comment (`/* ... */`), line comment (`-- ...\n`), whitespace — all in `Lexer.SKIPPED` group
    - Index DDL keywords: `CREATE`, `UNIQUE`, `INDEX`, `ON`, `ASC`, `DESC`
    - Index type keywords: `BTREE`, `CPBTREE`, `INVERTED`, `HASH`, `VALUE`, `INDIVIDUAL`
    - An `Identifier` token covering unquoted identifiers (`[A-Za-z_][A-Za-z0-9_]*`); all keyword tokens must declare `longer_alt: Identifier` so that identifiers whose names begin with a keyword prefix (e.g., `INDEX_NAME`, `INVERTED_FLAG`) are not incorrectly split
    - A `QuotedIdentifier` token covering double-quoted identifiers (`"[^"]*"`)
    - Parentheses, comma, semicolon, and dot punctuation tokens

- **FR-3** Implement an `.hdbindex` parser (`src/parsers/hdbindex/parser.ts`) using Chevrotain's `CstParser`. The grammar must cover:
    - `indexStatement` — top-level rule: `[CREATE] [UNIQUE] [<indexType>] INDEX <indexName> ON <tableName> <columnList> [;]`
    - `indexType` — any one of the supported index type keyword sequences:
        - `BTREE`
        - `CPBTREE`
        - `INVERTED HASH`
        - `INVERTED VALUE`
        - `INVERTED INDIVIDUAL`
    - `indexName` — a single identifier or a schema-qualified identifier (`<schema> . <name>`); both quoted and unquoted forms are supported; the schema qualifier (if present) is consumed but not included in the extracted name
    - `tableName` — a single identifier or a schema-qualified identifier (`<schema> . <name>`); both quoted and unquoted forms are supported; consumed entirely but not extracted
    - `columnList` — `( <columnRef> (, <columnRef>)* )` where each `columnRef` is an identifier (quoted or unquoted) optionally followed by `ASC` or `DESC`; consumed entirely but not extracted
    - Error recovery: use Chevrotain's built-in single-token deletion/insertion recovery so that a partially valid file still yields the index name if the name portion parsed successfully

- **FR-4** Implement a CST visitor (`src/parsers/hdbindex/visitor.ts`) that:
    - Walks the `indexName` node in the CST
    - Reads the identifier token representing the local index name (i.e., the part after the dot in a schema-qualified name, or the sole identifier when no schema qualifier is present)
    - Strips surrounding double-quotes from quoted names
    - Pushes `{ type: 'indexName', name }` onto the result

- **FR-5** Implement a public extractor function `extractIndexName(fileContent: string): ExtractedSubject[]` in `src/parsers/hdbindex/index.ts`. This function:
    - Tokenises the input using the `.hdbindex` lexer
    - Runs the parser
    - Visits the resulting CST via the visitor from `visitor.ts`
    - Returns an array containing at most one `ExtractedSubject` object with `type: 'indexName'`
    - If the lexer or parser reports errors, returns whatever could be extracted from the partial tree; does not throw

- **FR-6** Extend the `ContentTarget` union type in `src/types/rules.ts` with the new literal value:

    ```typescript
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

    Also extend the `subjectType` union in the `ExtractedSubject` type in `src/types/issues.ts` to include `'indexName'`, so that the new subject type flows correctly through the existing lint pipeline.

- **FR-7** Update `extractSubjects()` in `src/content-lint.ts`:
    - Import `extractIndexName` from `./parsers/hdbindex/index`
    - Add a dedicated `if (extension === '.hdbindex')` branch calling `extractIndexName(fileContent)` alongside the existing artifact branches

- **FR-8** The existing `ExtractedSubject` type and the rest of the `lintFileContent` pipeline must remain unchanged except for the additive `'indexName'` type value; no existing extraction paths are modified.

- **FR-9** The `extractIndexName` function must handle both CRLF and LF line endings.

### Non-Functional Requirements

- **NFR-1** No new production dependencies are required; the feature uses the `chevrotain` package already declared as a `dependencies` entry.

- **NFR-2** No native binaries or build-step code generation. The parser is defined in TypeScript source files that compile with `npm run build` (`tsc`).

- **NFR-3** The lexer and parser must be instantiated **once** at module load time (not per-file), per Chevrotain best practices, to avoid re-parsing the grammar on every lint invocation.

- **NFR-4** Parsing a single `.hdbindex` file must complete in under 100 ms on commodity hardware for files up to 500 lines.

- **NFR-5** The introduction of the `.hdbindex` parser must not alter the public API of `src/index.ts`, `src/lint.ts`, or the `LintIssue` type (beyond the additive `'indexName'` union member).

- **NFR-6** The parser module must be independently unit-testable: given a string of `.hdbindex` DDL, `extractIndexName()` returns the expected `ExtractedSubject[]` array.

---

## 6. Acceptance Criteria

### AC-1 — Standard index name extraction (bare `INDEX` syntax, unquoted)

**Given** an `.hdbindex` file containing:

```sql
INDEX MY_INDEX ON MY_TABLE (COL1, COL2);
```

**When** `extractIndexName()` is called,  
**Then** it returns exactly `[{ type: 'indexName', name: 'MY_INDEX' }]`.

---

### AC-2 — Standard index name extraction (full `CREATE INDEX` syntax, unquoted)

**Given** an `.hdbindex` file containing:

```sql
CREATE INDEX MY_INDEX ON MY_TABLE (COL1 ASC, COL2 DESC);
```

**When** `extractIndexName()` is called,  
**Then** it returns exactly `[{ type: 'indexName', name: 'MY_INDEX' }]`.

---

### AC-3 — `CREATE UNIQUE INDEX` syntax

**Given** an `.hdbindex` file containing:

```sql
CREATE UNIQUE INDEX MY_UNIQUE_INDEX ON MY_TABLE (COL1);
```

**When** `extractIndexName()` is called,  
**Then** it returns exactly `[{ type: 'indexName', name: 'MY_UNIQUE_INDEX' }]`.

---

### AC-4 — Index type keyword variants consumed without error

**Given** `.hdbindex` files using each supported index type:

```sql
CREATE BTREE INDEX MY_IDX ON MY_TABLE (COL1);
CREATE CPBTREE INDEX MY_IDX ON MY_TABLE (COL1);
CREATE INVERTED HASH INDEX MY_IDX ON MY_TABLE (COL1);
CREATE INVERTED VALUE INDEX MY_IDX ON MY_TABLE (COL1);
CREATE INVERTED INDIVIDUAL INDEX MY_IDX ON MY_TABLE (COL1);
```

**When** `extractIndexName()` is called on each,  
**Then** all five calls return exactly `[{ type: 'indexName', name: 'MY_IDX' }]`.

---

### AC-5 — Quoted identifier normalisation

**Given** an `.hdbindex` file containing:

```sql
CREATE INDEX "MY_INDEX" ON "MY_TABLE" ("COL1", "COL2");
```

**When** `extractIndexName()` is called,  
**Then** it returns exactly `[{ type: 'indexName', name: 'MY_INDEX' }]` (double-quotes stripped).

---

### AC-6 — Schema-qualified index name — local name extracted

**Given** an `.hdbindex` file containing:

```sql
CREATE INDEX "MY_SCHEMA"."MY_INDEX" ON "MY_SCHEMA"."MY_TABLE" ("COL1");
```

**When** `extractIndexName()` is called,  
**Then** it returns exactly `[{ type: 'indexName', name: 'MY_INDEX' }]` and `MY_SCHEMA` is **not** present in the result.

---

### AC-7 — Column identifiers not extracted

**Given** an `.hdbindex` file containing:

```sql
CREATE INDEX MY_INDEX ON MY_TABLE (FIRST_COLUMN ASC, SECOND_COLUMN DESC);
```

**When** `extractIndexName()` is called,  
**Then** the result contains exactly `[{ type: 'indexName', name: 'MY_INDEX' }]` and neither `FIRST_COLUMN` nor `SECOND_COLUMN` is present in the result.

---

### AC-8 — Block comment exclusion

**Given** an `.hdbindex` file where the original definition is commented out and a new definition follows:

```sql
/* CREATE INDEX OLD_INDEX ON MY_TABLE (COL1); */
CREATE INDEX MY_INDEX ON MY_TABLE (COL1);
```

**When** `extractIndexName()` is called,  
**Then** `OLD_INDEX` is **not** present in the result and only `MY_INDEX` is extracted.

---

### AC-9 — Line comment exclusion

**Given** an `.hdbindex` file containing:

```sql
-- CREATE INDEX OLD_INDEX ON MY_TABLE (COL1);
CREATE INDEX MY_INDEX ON MY_TABLE (COL1);
```

**When** `extractIndexName()` is called,  
**Then** `OLD_INDEX` is **not** present in the result and only `MY_INDEX` is extracted.

---

### AC-10 — Optional semicolon

**Given** an `.hdbindex` file that omits the trailing semicolon:

```sql
CREATE INDEX MY_INDEX ON MY_TABLE (COL1)
```

**When** `extractIndexName()` is called,  
**Then** it returns exactly `[{ type: 'indexName', name: 'MY_INDEX' }]` without error.

---

### AC-11 — Graceful error on unparseable file

**Given** an `.hdbindex` file with invalid or unsupported syntax,  
**When** `extractIndexName()` is called,  
**Then** it does **not** throw an exception; it returns any names that could be extracted from parseable portions and the function completes normally.

---

### AC-12 — Build integrity

**Given** the updated codebase,  
**When** `npm run build` is executed,  
**Then** it completes with zero TypeScript compilation errors.

---

## 7. Out of Scope

- Parsers for any other `.hdb*` artifact type not listed in this document — those are addressed in separate features.
- Extraction of the target table name or column names from the index definition — the linter validates naming conventions on the index name only.
- Validation of SQL _semantics_ (e.g., whether the referenced table and columns actually exist in the schema) — this linter validates naming conventions only.
- Support for composite or function-based index expressions beyond simple column references with optional `ASC`/`DESC` sort order.
- Auto-fix / code-rewriting capabilities.
- Support for the deprecated `hdbindex` format from XS Classic (pre-HDI); this PRD targets the HDI DDL-style `.hdbindex` format only.
