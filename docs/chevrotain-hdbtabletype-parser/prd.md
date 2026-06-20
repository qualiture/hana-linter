# PRD: Chevrotain Lexer/Parser for `.hdbtabletype` Column Extraction

## 1. Feature Name

**Chevrotain `.hdbtabletype` Table Type Column Extractor**

---

## 2. Goal

### Problem

The current `extractSubjects()` function in `src/content-lint.ts` has no handler for `.hdbtabletype` files. When a user configures `contentRuleSets` targeting `.hdbtabletype` column names, the linter silently returns an empty result — no columns are extracted, no lint issues are raised, and the user receives no indication that content-level linting is unsupported for this artifact type.

The structure of an `.hdbtabletype` file, while syntactically simpler than `.hdbtable`, still introduces challenges that make a simple regex approach unreliable:

- **`TYPE` keyword vs `CREATE TABLE`** — The top-level statement opens with `TYPE <name> AS TABLE (...)` rather than `CREATE TABLE`. A regex tuned for `.hdbtable` cannot be reused as-is, and retrofitting it risks introducing regressions in the existing table parser.
- **Block and line comments** — Column definitions may be commented out during development (`/* ... */` or `-- ...`). A line-by-line regex cannot reliably distinguish commented-out column declarations from live ones.
- **Multi-line column definitions** — A column name on one line and its data type on the next is silently skipped or double-counted by a scanner that processes lines independently.
- **Quoted and unquoted identifiers** — Column names may appear as `"MY_COLUMN"` (double-quoted) or `MY_COLUMN` (unquoted); a naïve pattern that expects one form or the other will miss names in the other form.
- **HANA-specific data types** — The column list may include types such as `SECONDDATE`, `SHORTTEXT`, `ALPHANUM`, `VARBINARY`, `NCLOB`, and others that are not part of standard SQL. A hard-coded keyword skip-list must be manually maintained and will always be incomplete.
- **Schema-qualified type names** — The type name is frequently schema-qualified (`"MY_SCHEMA"."MY_TYPE"`), and the dot operator must not be misread as an identifier boundary.

These failure modes mean that teams enforcing naming conventions on `.hdbtabletype` column fields currently receive no feedback from the linter at all — which is worse than the false positive / false negative problems observed in other artifact types.

### Solution

Implement a Chevrotain-based lexer and parser for `.hdbtabletype` files under `src/parsers/hdbtabletype/`, following the same architectural patterns established by the `.hdbtable`, `.hdbview`, `.hdbprocedure`, and `.hdbfunction` parsers. The parser tokenises the file, recognises the column list inside the `TYPE ... AS TABLE (...)` body, and produces a CST from which a visitor extracts only the column (field) names. Wire the new extractor into `extractSubjects()` in `src/content-lint.ts`.

### Impact

- Enables content-level naming-convention rules for `.hdbtabletype` column fields, a previously unsupported artifact type.
- Eliminates the silent no-op that currently affects teams who configure `contentRuleSets` for `.hdbtabletype`.
- Reuses and validates the parser infrastructure across a fifth HANA artifact type, further reinforcing its conventions and reducing the cost of any subsequent artifact parsers.
- Increases confidence in content-lint results for `.hdbtabletype`-heavy projects (e.g., projects that define shared table types for procedure TABLE parameters).

---

## 3. User Personas

**HANA Developer / CAP Developer**
A developer working on an SAP CAP or native HANA project who defines `.hdbtabletype` files to declare reusable table structures used as `TABLE`-type parameters in stored procedures and functions. They configure `hana-linter` to enforce naming conventions on the column names inside those table types (e.g., all columns must follow `SCREAMING_SNAKE_CASE`, or must carry a specific prefix). They run the linter locally and in CI. False positives block PRs unnecessarily; false negatives allow convention violations to ship.

**Tooling / Platform Engineer**
An engineer who maintains or extends `hana-linter` for their team or organisation. They need the `.hdbtabletype` parser to follow the same structural conventions as the existing parsers so that the codebase remains uniform and future artifact parsers are straightforward to add.

---

## 4. User Stories

### Primary path

- **US-1**: As a HANA Developer, I want the linter to correctly identify all column names defined in an `.hdbtabletype` file as `field` subjects — regardless of comment style, multi-line formatting, or HANA-specific data types — so that naming-convention checks produce no false positives or false negatives.

- **US-2**: As a HANA Developer, I want inline `/* block comments */` and `-- line comments` inside `.hdbtabletype` files to be completely ignored during column extraction, so that commented-out column definitions never trigger lint warnings.

- **US-3**: As a HANA Developer, I want HANA-specific data types (`NVARCHAR`, `DECIMAL`, `SECONDDATE`, `SHORTTEXT`, `ALPHANUM`, `VARBINARY`, `NCLOB`, and others) used in column definitions to be handled without parser failures, so that valid `.hdbtabletype` files are never rejected due to gaps in the token set.

### Edge cases

- **US-4**: As a HANA Developer, I want both quoted (`"MY_COLUMN"`) and unquoted (`MY_COLUMN`) column identifiers to be extracted and normalised (double-quotes stripped), so that mixed-style table types are linted without error.

- **US-5**: As a HANA Developer, I want schema-qualified type names (`"MY_SCHEMA"."MY_TYPE"`) to be parsed without error, so that cross-schema table type definitions are fully supported.

- **US-6**: As a HANA Developer, I want column definitions that carry precision or scale arguments (e.g., `NVARCHAR(100)`, `DECIMAL(15,2)`) to be parsed correctly so that the column name is always extracted without including the data type or its arguments.

- **US-7**: As a HANA Developer, I want an `.hdbtabletype` file with an empty column list to be parsed without error and return an empty extraction result, so that the linter does not crash on edge-case files.

- **US-8**: As a Tooling Engineer, I want the Chevrotain parser to emit structured parse errors (not throw unhandled exceptions) when it encounters unrecognised syntax, so that the linter degrades gracefully and reports a clear diagnostic instead of crashing.

- **US-9**: As a Tooling Engineer, I want the parser layer to expose a stable TypeScript interface (`extractTableTypeColumns(fileContent: string): ExtractedSubject[]`) so that `content-lint.ts` is not coupled to Chevrotain internals and future parser upgrades are isolated.

---

## 5. Requirements

### Functional Requirements

- **FR-1** Create a dedicated parser sub-module at `src/parsers/hdbtabletype/` containing `lexer.ts`, `parser.ts`, `visitor.ts`, and `index.ts`, following the same file-structure conventions as `src/parsers/hdbtable/`, `src/parsers/hdbview/`, `src/parsers/hdbprocedure/`, and `src/parsers/hdbfunction/`.

- **FR-2** Implement an `.hdbtabletype` lexer (`src/parsers/hdbtabletype/lexer.ts`) using Chevrotain's `createToken` and `Lexer` APIs. The lexer must define tokens for, at minimum:
    - Skip tokens: block comment (`/* ... */`), line comment (`-- ...\n`), whitespace — all in `Lexer.SKIPPED` group
    - Table-type keywords: `TYPE`, `AS`, `TABLE`
    - An `Identifier` token covering unquoted identifiers (`[A-Za-z_][A-Za-z0-9_]*`); all keyword tokens must declare `longer_alt: Identifier` so that identifiers that begin with a keyword prefix (e.g. `TABLE_NAME`, `TYPE_CODE`, `ASSET`) are not incorrectly split
    - A `QuotedIdentifier` token covering double-quoted identifiers (`"[^"]*"`)
    - Data type keywords in common use for table type columns: `NVARCHAR`, `VARCHAR`, `ALPHANUM`, `SHORTTEXT`, `INTEGER`, `BIGINT`, `SMALLINT`, `TINYINT`, `DECIMAL`, `DOUBLE`, `FLOAT`, `REAL`, `BOOLEAN`, `DATE`, `TIME`, `TIMESTAMP`, `SECONDDATE`, `CLOB`, `BLOB`, `NCLOB`, `VARBINARY`, `BINARY`, `VARBINARY`
    - Numeric literals (integer and decimal, for precision/scale values)
    - Parentheses, comma, semicolon, and dot punctuation tokens

- **FR-3** Implement an `.hdbtabletype` parser (`src/parsers/hdbtabletype/parser.ts`) using Chevrotain's `CstParser`. The grammar must cover:
    - `createTableTypeStatement` — top-level rule: `TYPE <typeName> AS TABLE ( <columnList> ) [;]`
    - `typeName` — a single identifier or a schema-qualified identifier (`<schema> . <name>`); both quoted and unquoted forms are supported
    - `columnList` — zero or more `columnDefinition` entries separated by commas
    - `columnDefinition` — `<identifier> <dataType>` where the identifier is the column name and the data type is a keyword optionally followed by a precision/scale parenthesised list (e.g., `NVARCHAR(100)`, `DECIMAL(15, 2)`)
    - `dataType` — a data type keyword optionally followed by `( <numericLiteral> [, <numericLiteral>] )`
    - Error recovery: use Chevrotain's built-in single-token deletion/insertion recovery so partial parses still return column names from the portions that did parse

- **FR-4** Implement a CST visitor (`src/parsers/hdbtabletype/visitor.ts`) that:
    - Walks each `columnDefinition` node in the CST
    - For each `columnDefinition`, reads the first child token (the column name identifier)
    - Strips surrounding double-quotes from quoted column names
    - Pushes `{ type: 'field', name }` onto the result for every column definition

- **FR-5** Implement a public extractor function `extractTableTypeColumns(fileContent: string): ExtractedSubject[]` in `src/parsers/hdbtabletype/index.ts`. This function:
    - Tokenises the input using the `.hdbtabletype` lexer
    - Runs the parser
    - Visits the resulting CST via the visitor from `visitor.ts`
    - Returns an array of `ExtractedSubject` objects with `type: 'field'`
    - If the lexer or parser reports errors, returns whatever columns could be extracted from the partial tree; does not throw

- **FR-6** Update `extractSubjects()` in `src/content-lint.ts`:
    - Import `extractTableTypeColumns` from `./parsers/hdbtabletype/index`
    - Add a dedicated `if (extension === '.hdbtabletype')` branch calling `extractTableTypeColumns(fileContent)` alongside the existing `.hdbtable`, `.hdbview`, `.hdbprocedure`, and `.hdbfunction` branches

- **FR-7** The existing `ExtractedSubject` type and the rest of the `lintFileContent` pipeline must remain unchanged; the new parser is a drop-in addition for the extraction step for `.hdbtabletype` files only. No existing extraction paths are modified.

- **FR-8** The `extractTableTypeColumns` function must handle both CRLF and LF line endings.

### Non-Functional Requirements

- **NFR-1** No new production dependencies are required; the feature uses the `chevrotain` package already declared as a `dependencies` entry.

- **NFR-2** No native binaries or build-step code generation. The parser is defined in TypeScript source files that compile with `npm run build` (`tsc`).

- **NFR-3** The lexer and parser must be instantiated **once** at module load time (not per-file), per Chevrotain best practices, to avoid re-parsing the grammar on every lint invocation.

- **NFR-4** Parsing a single `.hdbtabletype` file must complete in under 100 ms on commodity hardware for files up to 2,000 lines.

- **NFR-5** The introduction of the `.hdbtabletype` parser must not alter the public API of `src/index.ts`, `src/lint.ts`, or the `LintIssue` type.

- **NFR-6** The parser module must be independently unit-testable: given a string of `.hdbtabletype` DDL, `extractTableTypeColumns()` returns the expected `ExtractedSubject[]` array.

---

## 6. Acceptance Criteria

### AC-1 — Standard column extraction

**Given** a valid `.hdbtabletype` file defining columns `ID`, `NAME`, and `CREATED_AT`,  
**When** `extractTableTypeColumns()` is called,  
**Then** it returns exactly `[{ type: 'field', name: 'ID' }, { type: 'field', name: 'NAME' }, { type: 'field', name: 'CREATED_AT' }]` in declaration order.

### AC-2 — Block comment exclusion

**Given** a `.hdbtabletype` file where a complete column definition is wrapped in `/* ... */`,  
**When** `extractTableTypeColumns()` is called,  
**Then** the commented-out column name is **not** present in the result.

### AC-3 — Line comment exclusion

**Given** a `.hdbtabletype` file where a column definition line is prefixed with `-- OLD_FIELD NVARCHAR(10),`,  
**When** `extractTableTypeColumns()` is called,  
**Then** `OLD_FIELD` is **not** present in the result.

### AC-4 — Quoted identifier normalisation

**Given** a `.hdbtabletype` file containing `"MY_COLUMN" NVARCHAR(100)` as a column definition,  
**When** `extractTableTypeColumns()` is called,  
**Then** the result contains `{ type: 'field', name: 'MY_COLUMN' }` (double-quotes stripped).

### AC-5 — Unquoted identifier extraction

**Given** a `.hdbtabletype` file containing `MY_COLUMN NVARCHAR(100)` as a column definition (no quotes),  
**When** `extractTableTypeColumns()` is called,  
**Then** the result contains `{ type: 'field', name: 'MY_COLUMN' }`.

### AC-6 — Schema-qualified type name does not affect extraction

**Given** a `.hdbtabletype` file with a schema-qualified type name `"MY_SCHEMA"."MY_TYPE"`,  
**When** `extractTableTypeColumns()` is called,  
**Then** neither `MY_SCHEMA` nor `MY_TYPE` appears as a `field` subject in the result, and all declared columns are still extracted correctly.

### AC-7 — Data type precision arguments are not extracted as columns

**Given** a `.hdbtabletype` file containing `AMOUNT DECIMAL(15, 2)` as a column definition,  
**When** `extractTableTypeColumns()` is called,  
**Then** the result contains `{ type: 'field', name: 'AMOUNT' }` and does **not** contain entries for `15`, `2`, or `DECIMAL`.

### AC-8 — Multi-line column definitions

**Given** a `.hdbtabletype` file where the column name appears on one line and its data type on the next,  
**When** `extractTableTypeColumns()` is called,  
**Then** the column name is correctly extracted without duplication or omission.

### AC-9 — Empty column list

**Given** a `.hdbtabletype` file with `TYPE "MY_TYPE" AS TABLE ( )`,  
**When** `extractTableTypeColumns()` is called,  
**Then** it returns an empty array and does not throw an exception.

### AC-10 — Graceful error on unparseable file

**Given** a `.hdbtabletype` file with invalid or unsupported syntax,  
**When** `extractTableTypeColumns()` is called,  
**Then** it does **not** throw an exception; it returns any columns that could be extracted from parseable portions and the function completes normally.

### AC-11 — Integration with `lintFileContent` pipeline

**Given** an `.hdbtabletype` file containing columns `ID`, `NAME`, and `CREATED_AT`, and a `contentRuleSets` configuration with a `field` rule requiring all columns to match a specific pattern,  
**When** `lintFileContent()` is called,  
**Then** the resulting `LintIssue[]` array reflects the naming-convention evaluation for all three column names, consistent with how `.hdbtable` files are processed.

### AC-12 — Build integrity

**Given** the updated codebase,  
**When** `npm run build` is executed,  
**Then** it completes with zero TypeScript compilation errors.

---

## 7. Out of Scope

- Parsers for any other `.hdb*` artifact types not yet covered — these are separate features.
- Validation of SQL _semantics_ (e.g., data type correctness, cross-reference checks between `.hdbtabletype` definitions and their usage in `.hdbprocedure` or `.hdbfunction` files) — this linter validates naming conventions only.
- Support for `ROW TABLE` type variants in the table type body — HANA table types are always column-oriented in practice; the parser targets the canonical `AS TABLE (...)` syntax only.
- Extraction of the type name itself as a lint subject — only the column names inside the type body are subject to content rules. Artifact-level name linting (the type file name) is handled by the existing filename linting pipeline.
- Auto-fix / code-rewriting capabilities.
- Parser for `.hdbcds` CDS (Core Data Services) format — structurally different from DDL files and out of scope.
- A full HANA SQL grammar covering `SELECT`, `INSERT`, `UPDATE`, `DELETE` statements — the parser covers DDL only, specifically the `TYPE ... AS TABLE` statement shape.
