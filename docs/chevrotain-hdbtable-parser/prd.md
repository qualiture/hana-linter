# PRD: Chevrotain Parser Infrastructure & `.hdbtable` Lexer/Parser

## 1. Feature Name

**Chevrotain Parser Infrastructure + `.hdbtable` Column Extractor**

---

## 2. Goal

### Problem

The current content-linting pipeline in `src/content-lint.ts` extracts identifiers from HANA artifact files using ad-hoc, line-by-line regular expressions. For `.hdbtable` files specifically, `extractTableFields()` scans each line independently and matches column names with a small set of hard-coded skip keywords. This approach produces false positives and false negatives in realistic scenarios:

- **Block comments** (`/* ... */`) that span multiple lines cause the scanner to misidentify commented-out column definitions as real columns.
- **Multi-line column definitions** (a column name on one line, its type on the next) are silently skipped or misread.
- **Constraint, index, and partition clauses** share the same syntactic shape as column definitions; the skip-keyword set is manually maintained and will always be incomplete.
- **HANA-specific DDL constructs** (`GLOBAL TEMPORARY COLUMN TABLE`, `WITH PARAMETERS`, `WITH ASSOCIATIONS`, `PARTITION BY`) are not accounted for.
- **String literals** in DEFAULT or CHECK clauses can contain tokens that match the column-name heuristic.

These failure modes undermine trust in the linter: developers get spurious warnings on valid files, or miss real naming-convention violations on files with non-trivial formatting.

### Solution

Introduce [Chevrotain](https://chevrotain.io) as the parsing foundation. Chevrotain is a TypeScript-native, zero-native-binary parser-building toolkit that lets you write a lexer and parser directly in TypeScript — no separate grammar compilation step. Replace the `extractTableFields()` regex approach with a Chevrotain-based lexer and parser that produces a structured token stream and a concrete syntax tree (CST) from which column names are extracted reliably.

This first iteration scopes to `.hdbtable` files only and establishes the architectural patterns (shared lexer utilities, parser interface contract) that subsequent parsers (`.hdbprocedure`, `.hdbfunction`) will reuse.

### Impact

- Eliminates the class of false positive/negative extraction bugs for `.hdbtable` files.
- Establishes a maintainable, extensible parser infrastructure that each future HANA artifact type can plug into.
- Increases confidence in content-lint results, making the linter trustworthy enough to run in CI pipelines.

---

## 3. User Personas

**HANA Developer / CAP Developer**
A developer working on an SAP CAP project who uses `hana-linter` to enforce naming conventions across `.hdb*` artifacts. They run the linter locally and in CI. They trust lint output to be accurate; false positives block PRs unnecessarily, and false negatives allow convention violations to ship.

**Tooling / Platform Engineer**
An engineer who maintains or extends `hana-linter` for their team or organisation. They need the internals to be well-structured so they can add new artifact types or adjust parser behaviour without rewriting core logic.

---

## 4. User Stories

### Primary path

- **US-1**: As a HANA Developer, I want the linter to correctly identify all column names in an `.hdbtable` file — regardless of comment style, multi-line formatting, or HANA-specific clauses — so that naming-convention checks produce no false positives or false negatives.

- **US-2**: As a HANA Developer, I want inline `/* block comments */` and `-- line comments` inside `.hdbtable` files to be completely ignored during column extraction, so that commented-out code never triggers lint warnings.

- **US-3**: As a HANA Developer, I want constraint definitions (`CONSTRAINT`, `PRIMARY KEY`, `UNIQUE`, `FOREIGN KEY`, `CHECK`), index definitions, and partition clauses inside `.hdbtable` files to be excluded from column extraction, so that only actual column names are validated against naming rules.

### Edge cases

- **US-4**: As a HANA Developer, I want both quoted (`"MY_COLUMN"`) and unquoted (`MY_COLUMN`) column identifiers to be extracted correctly, so that mixed-style tables are linted without error.

- **US-5**: As a HANA Developer, I want column definitions that include HANA-specific data types (`NVARCHAR`, `DECIMAL`, `SECONDDATE`, `SHORTTEXT`, `HANA_IDENTIFIER`, etc.) to be parsed without failures, so that valid files are never rejected due to parser gaps.

- **US-6**: As a HANA Developer, I want `ROW TABLE`, `COLUMN TABLE`, and `GLOBAL TEMPORARY COLUMN TABLE` table-type variants to all be parsed correctly, so that all common `.hdbtable` patterns are covered.

- **US-7**: As a Tooling Engineer, I want the Chevrotain parser to emit structured parse errors (not throw unhandled exceptions) when it encounters unrecognised syntax, so that the linter degrades gracefully and reports a clear diagnostic instead of crashing.

- **US-8**: As a Tooling Engineer, I want the parser layer to expose a stable TypeScript interface (`extractTableColumns(fileContent: string): ExtractedSubject[]`) so that `content-lint.ts` is not coupled to Chevrotain internals and future parser upgrades are isolated.

---

## 5. Requirements

### Functional Requirements

- **FR-1** Add `chevrotain` as a production dependency in `package.json`.

- **FR-2** Create a dedicated parser directory under `src/parsers/` to house all Chevrotain-based parsers. Each HANA artifact type gets its own sub-module (e.g., `src/parsers/hdbtable/`).

- **FR-3** Implement an `.hdbtable` lexer (`src/parsers/hdbtable/lexer.ts`) using Chevrotain's `createToken` and `Lexer` APIs. The lexer must define tokens for, at minimum:
    - HANA SQL keywords relevant to `CREATE TABLE` DDL: `CREATE`, `COLUMN`, `ROW`, `TABLE`, `GLOBAL`, `TEMPORARY`, `CONSTRAINT`, `PRIMARY`, `UNIQUE`, `FOREIGN`, `KEY`, `CHECK`, `INDEX`, `PARTITION`, `WITH`, `NOT`, `NULL`, `DEFAULT`, `AS`
    - Data type keywords (NVARCHAR, INTEGER, BIGINT, DECIMAL, DOUBLE, BOOLEAN, DATE, TIME, TIMESTAMP, SECONDDATE, CLOB, BLOB, NCLOB, VARBINARY, SHORTTEXT, and others in common use)
    - `IDENTIFIER` token covering both unquoted (`[A-Za-z_][A-Za-z0-9_]*`) and quoted (`"[^"]*"`) identifiers
    - Integer and decimal number literals
    - Single-quoted string literals (for DEFAULT values)
    - Parentheses, comma, semicolon, and dot punctuation tokens
    - Single-line comment (`-- ... \n`) as `SKIP` mode
    - Block comment (`/* ... */`) as `SKIP` mode
    - Whitespace as `SKIP` mode

- **FR-4** Implement an `.hdbtable` parser (`src/parsers/hdbtable/parser.ts`) using Chevrotain's `CstParser`. The grammar must cover:
    - `createTableStatement` — top-level rule matching `CREATE [GLOBAL TEMPORARY] [COLUMN | ROW] TABLE <name> ( <columnList> ) [<tableOptions>]`
    - `columnList` — one or more `columnOrConstraint` rules separated by commas
    - `columnDefinition` — `<identifier> <dataType> [<columnConstraints>]`
    - `constraintDefinition` — any constraint clause starting with `CONSTRAINT`, `PRIMARY KEY`, `UNIQUE`, `FOREIGN KEY`, or `CHECK` (parsed but not extracted)
    - `dataType` — a data type keyword optionally followed by a precision/scale parenthesised list
    - Error recovery: use Chevrotain's built-in single-token deletion/insertion recovery so partial parses still return column names from the portions that did parse

- **FR-5** Implement a public extractor function `extractTableColumns(fileContent: string): ExtractedSubject[]` in `src/parsers/hdbtable/index.ts`. This function:
    - Tokenises the input using the `.hdbtable` lexer
    - Runs the parser
    - Visits the resulting CST to collect only `columnDefinition` nodes and strips surrounding double quotes from quoted identifiers
    - Returns an array of `ExtractedSubject` objects with `type: 'field'` and `name: <identifier>`
    - If the lexer or parser reports errors, returns whatever columns could be extracted plus emits those errors through a structured result type (does not throw)

- **FR-6** Replace the call to `extractTableFields()` inside `extractSubjects()` in `src/content-lint.ts` with a call to `extractTableColumns()`. Remove the now-redundant `extractTableFields()` function and the associated `skipKeywords` set.

- **FR-7** The existing `ExtractedSubject` type and the rest of the `lintFileContent` pipeline must remain unchanged; the parser is a drop-in replacement for the extraction step only.

- **FR-8** The `extractTableColumns` function must handle both CRLF and LF line endings.

### Non-Functional Requirements

- **NFR-1** `chevrotain` must be a `dependencies` entry (not `devDependencies`) as it is required at runtime by the CLI.

- **NFR-2** No native binaries or build-step code generation. Chevrotain operates as a pure JavaScript/TypeScript library; the parser is defined in TypeScript source files that compile with the existing `tsc` build (`npm run build`).

- **NFR-3** The lexer and parser must be instantiated **once** at module load time (not per-file), per Chevrotain best practices, to avoid re-parsing grammar on every lint invocation.

- **NFR-4** Parsing a single `.hdbtable` file must complete in under 100 ms on commodity hardware for files up to 10,000 lines.

- **NFR-5** The introduction of Chevrotain must not alter the public API of `src/index.ts`, `src/lint.ts`, or the `LintIssue` type.

- **NFR-6** The parser module must be independently unit-testable: given a string of `.hdbtable` DDL, `extractTableColumns()` returns the expected `ExtractedSubject[]` array.

---

## 6. Acceptance Criteria

### AC-1 — Correct column extraction (standard case)

**Given** a valid `.hdbtable` file defining columns `ID`, `NAME`, `CREATED_AT` and a `PRIMARY KEY` constraint,  
**When** `extractTableColumns()` is called,  
**Then** it returns exactly `['ID', 'NAME', 'CREATED_AT']` as `field` subjects and does not include the constraint name.

### AC-2 — Block comment exclusion

**Given** a `.hdbtable` file where a complete column definition is wrapped in `/* ... */`,  
**When** `extractTableColumns()` is called,  
**Then** the commented-out column name is **not** present in the result.

### AC-3 — Line comment exclusion

**Given** a `.hdbtable` file where a column definition line is preceded by `-- disabled: OLD_FIELD NVARCHAR(10)`,  
**When** `extractTableColumns()` is called,  
**Then** `OLD_FIELD` is **not** present in the result.

### AC-4 — Quoted identifier normalisation

**Given** a `.hdbtable` file containing `"MY_COLUMN" NVARCHAR(100)`,  
**When** `extractTableColumns()` is called,  
**Then** the result contains `{ type: 'field', name: 'MY_COLUMN' }` (double-quotes stripped).

### AC-5 — Multi-line column definition

**Given** a `.hdbtable` file where the column name is on one line and its data type on the next,  
**When** `extractTableColumns()` is called,  
**Then** the column name is correctly extracted without duplication or omission.

### AC-6 — HANA table-type variants

**Given** `.hdbtable` files using `COLUMN TABLE`, `ROW TABLE`, and `GLOBAL TEMPORARY COLUMN TABLE`,  
**When** `extractTableColumns()` is called on each,  
**Then** all column names are correctly extracted in all three cases.

### AC-7 — Graceful error on unparseable file

**Given** a `.hdbtable` file with invalid / unsupported syntax,  
**When** `extractTableColumns()` is called,  
**Then** it does **not** throw an exception; it returns any columns that could be extracted from parseable portions and the function completes normally.

### AC-8 — No regression in `lintFileContent` pipeline

**Given** any `.hdbtable` file that previously produced correct results with the regex extractor,  
**When** `lintFileContent()` is called after the Chevrotain replacement,  
**Then** the resulting `LintIssue[]` array is identical to what the regex extractor produced for that file.

### AC-9 — Build integrity

**Given** the updated codebase,  
**When** `npm run build` is executed,  
**Then** it completes with zero TypeScript compilation errors.

---

## 7. Out of Scope

- Parsers for `.hdbprocedure` and `.hdbfunction` — these will be addressed in follow-on features using the infrastructure established here.
- Validation of SQL _semantics_ (e.g., data type correctness, referential integrity of FOREIGN KEY targets) — this linter validates naming conventions only.
- Support for HANA HDI table-type files (`.hdbtabletype`) or calculation view XML — separate features.
- A full HANA SQL grammar covering `SELECT`, `INSERT`, `UPDATE`, `DELETE` statements — the parser covers DDL only, specifically the `CREATE TABLE` statement shape.
- Auto-fix / code-rewriting capabilities.
- Parser for the `.hdbcds` CDS (Core Data Services) format — structurally different from DDL files and out of scope.
