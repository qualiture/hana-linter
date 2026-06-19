# PRD: Chevrotain Lexer/Parser for `.hdbview` Column Alias Extraction

## 1. Feature Name

**Chevrotain `.hdbview` View Column Extractor**

---

## 2. Goal

### Problem

The current `extractSubjects()` function in `src/content-lint.ts` has no handler for `.hdbview` files. When a user configures `contentRuleSets` targeting `.hdbview` column aliases, the linter silently returns an empty result — no columns are extracted, no lint issues are raised, and the user receives no indication that content-level linting is unsupported for this artifact type.

The structure of an `.hdbview` file introduces parsing challenges that make a simple regex approach unreliable:

- **Explicit column list vs. SELECT-level aliases** — A view may declare its column names in an explicit column list immediately after the view name, _or_ it may rely on `AS <alias>` expressions inside the `SELECT` clause. Both shapes must be handled.
- **Block and line comments** — Developers frequently comment out individual column aliases or entire SELECT expressions; these must be excluded from extraction.
- **Subqueries and nested SELECT** — The `FROM` clause may include subqueries whose own `AS` aliases must not be mistaken for top-level view columns.
- **Multi-table joins and multi-line expressions** — Column expressions span multiple lines and may contain complex expressions (arithmetic, function calls, CASE/WHEN) before their `AS` alias.
- **`WITH READ ONLY` / `WITH CHECK OPTION`** — Trailing options after the SELECT body share the `WITH` keyword, which also appears in `WITH PARAMETERS`; naive scanning confuses the two.
- **Schema-qualified identifiers** — Both the view name and column references are frequently prefixed with a schema name (`"SCHEMA"."VIEW_NAME"`), and the dot operator must not be treated as an identifier boundary.

### Solution

Implement a Chevrotain-based lexer and parser for `.hdbview` files under `src/parsers/hdbview/`, following the same architectural patterns established by the `.hdbtable` parser. The parser produces a CST from which a visitor extracts only the column names exposed by the view (either from the explicit column list, or from top-level `AS` aliases in the outermost `SELECT` clause). Wire the new extractor into `extractSubjects()` in `src/content-lint.ts`.

### Impact

- Enables content-level naming-convention rules for `.hdbview` column aliases, a previously unsupported artifact type.
- Eliminates the silent no-op that currently affects teams who configure `contentRuleSets` for `.hdbview`.
- Reuses and validates the parser infrastructure introduced by the `.hdbtable` feature, reinforcing its conventions.

---

## 3. User Personas

**HANA Developer / CAP Developer**
A developer who creates `.hdbview` files to expose filtered or joined data sets. They configure `hana-linter` to enforce naming conventions on the column aliases the view exposes (e.g., all view columns must be uppercase snake case with a specific prefix). They expect lint results for views to be as reliable as those for tables.

**Tooling / Platform Engineer**
An engineer responsible for maintaining `hana-linter`. They need the `.hdbview` parser to follow the same structural patterns as the existing `.hdbtable` parser so that the codebase remains consistent and new parsers are straightforward to add.

---

## 4. User Stories

### Primary path

- **US-1**: As a HANA Developer, I want the linter to extract all column aliases exposed by an `.hdbview` file — from either the explicit column list or the top-level `SELECT` clause — so that naming-convention checks are applied to every visible column.

- **US-2**: As a HANA Developer, I want inline `/* block comments */` and `-- line comments` inside `.hdbview` files to be completely ignored during column extraction, so that commented-out aliases never trigger lint warnings.

- **US-3**: As a HANA Developer, I want column aliases from subqueries in the `FROM` clause (derived tables) to be excluded from the extracted column list, so that only the aliases the view itself exposes are validated.

- **US-4**: As a HANA Developer, I want `WITH READ ONLY` and `WITH CHECK OPTION` trailing clauses to be parsed without error and ignored during extraction, so that valid view files are never rejected.

### Edge cases

- **US-5**: As a HANA Developer, I want both quoted (`"MY_ALIAS"`) and unquoted (`MY_ALIAS`) column aliases to be extracted and normalised (double-quotes stripped), so that mixed-style views are linted without error.

- **US-6**: As a HANA Developer, I want views with an explicit column list (`VIEW V_FOO ("ID", "NAME") AS SELECT ...`) to have those listed column names extracted, and the `AS` aliases from the SELECT body ignored, so there is no duplication.

- **US-7**: As a HANA Developer, I want views with no explicit column list (`VIEW V_FOO AS SELECT T."ID" AS "MY_ID", ...`) to have the top-level `AS` aliases from the SELECT clause extracted as the column names.

- **US-8**: As a HANA Developer, I want a SELECT column that has no `AS` alias (e.g., `T."RAW_FIELD"`) and where no explicit column list is present to be silently skipped — no extraction, no error — so the linter does not produce a spurious result for an ambiguous name.

- **US-9**: As a HANA Developer, I want schema-qualified view names (`"MY_SCHEMA"."V_MY_VIEW"`) to be parsed without error, so that cross-schema view definitions are fully supported.

- **US-10**: As a Tooling Engineer, I want the Chevrotain parser to emit structured parse errors (not throw unhandled exceptions) when it encounters unrecognised syntax, so that the linter degrades gracefully and reports a clear diagnostic instead of crashing.

- **US-11**: As a Tooling Engineer, I want the parser layer to expose a stable TypeScript interface (`extractViewColumns(fileContent: string): ExtractedSubject[]`) so that `content-lint.ts` is not coupled to Chevrotain internals and future parser upgrades are isolated.

---

## 5. Requirements

### Functional Requirements

- **FR-1** Create a dedicated parser sub-module at `src/parsers/hdbview/` containing `lexer.ts`, `parser.ts`, `visitor.ts`, and `index.ts`, following the same file-structure conventions as `src/parsers/hdbtable/`.

- **FR-2** Implement an `.hdbview` lexer (`src/parsers/hdbview/lexer.ts`) using Chevrotain's `createToken` and `Lexer` APIs. The lexer must define tokens for, at minimum:
    - Skip tokens: block comment (`/* ... */`), line comment (`-- ...\n`), whitespace — all in `Lexer.SKIPPED` group
    - DDL/DML keywords: `VIEW`, `CREATE`, `AS`, `SELECT`, `FROM`, `WHERE`, `JOIN`, `INNER`, `LEFT`, `RIGHT`, `FULL`, `OUTER`, `CROSS`, `ON`, `WITH`, `READ`, `ONLY`, `CHECK`, `OPTION`, `UNION`, `INTERSECT`, `EXCEPT`, `ALL`, `DISTINCT`, `ORDER`, `BY`, `GROUP`, `HAVING`, `LIMIT`, `TOP`, `CASE`, `WHEN`, `THEN`, `ELSE`, `END`, `NOT`, `AND`, `OR`, `IN`, `IS`, `NULL`, `BETWEEN`, `LIKE`, `EXISTS`
    - `IDENTIFIER` token covering unquoted identifiers (`[A-Za-z_][A-Za-z0-9_]*`); all keyword tokens must declare `longer_alt: Identifier`
    - `QuotedIdentifier` token covering double-quoted identifiers (`"[^"]*"`)
    - Numeric literals (integer and decimal)
    - Single-quoted string literals
    - Operators and punctuation: `(`, `)`, `,`, `;`, `.`, `*`, `+`, `-`, `/`, `=`, `<`, `>`, `<>`, `<=`, `>=`

- **FR-3** Implement an `.hdbview` parser (`src/parsers/hdbview/parser.ts`) using Chevrotain's `CstParser`. The grammar must cover:
    - `createViewStatement` — top-level rule: `[CREATE] VIEW <viewName> [<explicitColumnList>] AS <selectStatement> [<viewOptions>]`; the `CREATE` keyword is optional for compatibility with `.hdbview` files that omit it
    - `viewName` — a single identifier or a schema-qualified identifier (`<schema>.<name>`)
    - `explicitColumnList` — `( <identifier> {, <identifier>} )` immediately following the view name, before `AS`; this is the definitive source of column names when present
    - `selectStatement` — `SELECT [DISTINCT | TOP <n> | ALL] <selectList> <fromClause> [<whereClause>] [<groupByClause>] [<havingClause>] [<orderByClause>] [<unionClause>]`
    - `selectList` — one or more `selectItem` rules separated by commas, or `*`
    - `selectItem` — an expression followed by an optional `AS <alias>` or a bare identifier acting as alias; the alias is extracted as a column name when no explicit column list is present
    - `fromClause` — `FROM <tableRef> {<join>}` where `tableRef` may be a table/view name, a schema-qualified name, or a parenthesised subquery (the latter's internal `selectItem` aliases are NOT extracted as view column names)
    - `whereClause`, `groupByClause`, `havingClause`, `orderByClause` — parsed to consume their tokens; no extraction performed
    - `viewOptions` — `WITH READ ONLY` or `WITH CHECK OPTION` — consumed but not extracted
    - Error recovery: use Chevrotain's built-in single-token deletion/insertion recovery so partial parses still return column names from the portions that did parse

- **FR-4** Implement a CST visitor (`src/parsers/hdbview/visitor.ts`) that:
    - If an `explicitColumnList` node exists in the CST: collects identifiers from that list only, strips surrounding double-quotes, populates `columns` with `{ type: 'field', name }` entries
    - Otherwise: collects `AS <alias>` pairs from top-level (non-subquery) `selectItem` nodes only, strips surrounding double-quotes, populates `columns`
    - Ignores `selectItem` nodes that are nested inside a subquery `tableRef`

- **FR-5** Implement a public extractor function `extractViewColumns(fileContent: string): ExtractedSubject[]` in `src/parsers/hdbview/index.ts`. This function:
    - Tokenises the input using the `.hdbview` lexer
    - Runs the parser
    - Visits the resulting CST via the `HdbViewColumnVisitor`
    - Returns an array of `ExtractedSubject` objects with `type: 'field'`
    - If the lexer or parser reports errors, returns whatever columns could be extracted from the partial tree; does not throw

- **FR-6** Extend `extractSubjects()` in `src/content-lint.ts` to handle `.hdbview` files: add a branch `if (extension === '.hdbview') return extractViewColumns(fileContent)`.

- **FR-7** The existing `ExtractedSubject` type and the rest of the `lintFileContent` pipeline must remain unchanged; the new parser is additive only.

- **FR-8** The `extractViewColumns` function must handle both CRLF and LF line endings.

### Non-Functional Requirements

- **NFR-1** No new production dependencies are required; the feature uses the `chevrotain` package already declared as a `dependencies` entry by the `.hdbtable` feature.

- **NFR-2** No native binaries or build-step code generation. The parser is defined in TypeScript source files that compile with `npm run build` (`tsc`).

- **NFR-3** The lexer and parser must be instantiated **once** at module load time (not per-file), per Chevrotain best practices, to avoid re-parsing the grammar on every lint invocation.

- **NFR-4** Parsing a single `.hdbview` file must complete in under 100 ms on commodity hardware for files up to 5,000 lines.

- **NFR-5** The introduction of the `.hdbview` parser must not alter the public API of `src/index.ts`, `src/lint.ts`, or the `LintIssue` type.

- **NFR-6** The parser module must be independently unit-testable: given a string of `.hdbview` DDL, `extractViewColumns()` returns the expected `ExtractedSubject[]` array.

---

## 6. Acceptance Criteria

### AC-1 — Explicit column list extraction

**Given** an `.hdbview` file that declares an explicit column list `VIEW V_FOO ("ID", "NAME") AS SELECT T."CUST_ID", T."CUST_NAME" FROM T`,  
**When** `extractViewColumns()` is called,  
**Then** it returns exactly `[{ type: 'field', name: 'ID' }, { type: 'field', name: 'NAME' }]` and the SELECT source columns (`CUST_ID`, `CUST_NAME`) are **not** included.

### AC-2 — SELECT alias extraction (no explicit column list)

**Given** an `.hdbview` file with no explicit column list: `VIEW V_BAR AS SELECT T."CUST_ID" AS "ID", T."CUST_NAME" AS "NAME" FROM T`,  
**When** `extractViewColumns()` is called,  
**Then** it returns exactly `[{ type: 'field', name: 'ID' }, { type: 'field', name: 'NAME' }]`.

### AC-3 — Subquery alias exclusion

**Given** an `.hdbview` file where the `FROM` clause contains a subquery with its own aliases: `VIEW V_BAZ AS SELECT S."X" AS "MY_COL" FROM (SELECT "A" AS "X" FROM "T") S`,  
**When** `extractViewColumns()` is called,  
**Then** the result contains only `[{ type: 'field', name: 'MY_COL' }]` and `X`, `A` are **not** present.

### AC-4 — Block comment exclusion

**Given** an `.hdbview` file where a column alias is wrapped in `/* ... */`,  
**When** `extractViewColumns()` is called,  
**Then** the commented-out alias is **not** present in the result.

### AC-5 — Line comment exclusion

**Given** an `.hdbview` file where a SELECT item line is prefixed with `-- OLD: T."FIELD" AS "OLD_COL"`,  
**When** `extractViewColumns()` is called,  
**Then** `OLD_COL` is **not** present in the result.

### AC-6 — Quoted identifier normalisation

**Given** an `.hdbview` file containing `"MY_ALIAS"` as a column alias,  
**When** `extractViewColumns()` is called,  
**Then** the result contains `{ type: 'field', name: 'MY_ALIAS' }` (double-quotes stripped).

### AC-7 — Schema-qualified view name

**Given** an `.hdbview` file with the view name `"MY_SCHEMA"."V_MY_VIEW"`,  
**When** `extractViewColumns()` is called,  
**Then** no error is thrown and column aliases are extracted normally.

### AC-8 — `WITH READ ONLY` trailing clause

**Given** an `.hdbview` file ending with `... FROM T WITH READ ONLY`,  
**When** `extractViewColumns()` is called,  
**Then** no error is thrown and the phrase does not affect the extracted column list.

### AC-9 — Unaliased SELECT item skipped (no explicit column list)

**Given** an `.hdbview` file with no explicit column list and a SELECT item that has no `AS` alias (e.g., `T."RAW_FIELD"`),  
**When** `extractViewColumns()` is called,  
**Then** no entry for `RAW_FIELD` is included in the result (the item is silently skipped — no error).

### AC-10 — CREATE keyword optional

**Given** an `.hdbview` file that begins with `VIEW V_FOO AS SELECT ...` (no `CREATE` keyword),  
**When** `extractViewColumns()` is called,  
**Then** column aliases are extracted correctly, identical to the same file with `CREATE VIEW V_FOO AS SELECT ...`.

### AC-11 — Graceful error on unparseable file

**Given** an `.hdbview` file with invalid or unsupported syntax,  
**When** `extractViewColumns()` is called,  
**Then** it does **not** throw an exception; it returns any columns extractable from parseable portions and completes normally.

### AC-12 — Integration with `lintFileContent`

**Given** an `.hdbview` file whose column aliases violate a configured `contentRuleSet` rule,  
**When** `lintFileContent()` is called,  
**Then** one `LintIssue` per violating alias is returned, with `subjectType: 'field'` and the correct `subjectName`.

### AC-13 — Build integrity

**Given** the updated codebase,  
**When** `npm run build` is executed,  
**Then** it completes with zero TypeScript compilation errors.

---

## 7. Out of Scope

- Parsers for `.hdbprocedure`, `.hdbfunction`, or `.hdbcalculationview` — separate features.
- Full SQL semantic validation (e.g., referential integrity of joined tables, data-type consistency) — the linter validates naming conventions only.
- Extraction of column names from `JOIN ... ON` predicates — these are source references, not view-exposed aliases.
- Parsing `UNION`, `INTERSECT`, or `EXCEPT` compound SELECT statements beyond token consumption for error recovery — the first `SELECT` branch's aliases are the view's columns; compound queries are parsed to avoid errors but their secondary branches are not extracted.
- Auto-fix / code-rewriting capabilities.
- Support for the `.hdbcds` CDS (Core Data Services) format — structurally different from DDL/DML files.
- Extraction of table/view names referenced in the `FROM` clause — the linter validates column alias names only.
- A HANA SQL grammar covering `INSERT`, `UPDATE`, `DELETE` statements — the parser covers the `CREATE VIEW ... AS SELECT` DDL shape only.
