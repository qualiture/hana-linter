# PRD: Chevrotain Lexer/Parser for `.hdbfunction` Parameter Extraction

## 1. Feature Name

**Chevrotain `.hdbfunction` Function Parameter Extractor**

---

## 2. Goal

### Problem

The current `extractProcedureFunctionParameters()` function in `src/content-lint.ts` is shared between `.hdbprocedure` and `.hdbfunction` files. Now that `.hdbprocedure` has its own Chevrotain parser, the `.hdbfunction` extension remains on the legacy regex path. That regex has several failure modes that are, if anything, _more_ severe for function files than they were for procedure files:

- **RETURNS TABLE clause pollution** — A table function declares `RETURNS TABLE (COL1 INTEGER, COL2 NVARCHAR(100))` before the body. The regex scanner has no concept of the `RETURNS` clause and scans across it without restriction. If any column name inside the return table happens to follow a token that matches the `IN|OUT|INOUT` lookahead heuristic, a spurious parameter entry is produced.
- **Invalid mode extraction** — HANA scalar and table functions accept only `IN` parameters. `OUT` and `INOUT` are not valid parameter modes for functions. The shared regex nonetheless tries to match `OUT` and `INOUT`, and will extract false positives if either keyword appears in the function body SQL (e.g., `WHERE TYPE NOT IN (...)`, `OUT_VAR := 1`).
- **Function body pollution** — The body between `AS BEGIN` and `END` frequently contains `IN` as a SQL predicate. The regex cannot distinguish the parameter list from the body.
- **Block and line comments** — Commented-out parameter-like declarations inside the function header or body are indistinguishable from real declarations.
- **TABLE-type IN parameters** — A function parameter declared as `IN TV_INPUT TABLE (ID INTEGER, NAME NVARCHAR(100))` includes a nested column list. The regex may mistake inner column names for parameter names if the file is formatted across multiple lines in a way that satisfies the pattern.
- **Multi-line parameter definitions** — A parameter name on one line and its type on the next is silently skipped or misread.

These failure modes produce false positives and false negatives in content-lint results for `.hdbfunction` files, and the invalid `OUT`/`INOUT` extraction means the regex could in principle produce `outputParameter` subjects for a file type that, by definition, has none.

### Solution

Implement a Chevrotain-based lexer and parser for `.hdbfunction` files under `src/parsers/hdbfunction/`, following the same architectural patterns established by the `.hdbtable`, `.hdbview`, and `.hdbprocedure` parsers. The parser tokenises the file, recognises the parameter list that precedes the `RETURNS` clause and function body, and produces a CST from which a visitor extracts only `IN` parameter names. The `RETURNS` clause — whether scalar or `RETURNS TABLE (...)` — is parsed as a structural element but yields no extracted subjects. The function body (`AS BEGIN ... END`) is consumed as an opaque token block so that SQL inside the body never contaminates extraction.

Wire the new extractor into `extractSubjects()` in `src/content-lint.ts`, replacing the regex path for `.hdbfunction` files. Once this is done, `extractProcedureFunctionParameters()` can be removed entirely if it has no remaining callers.

### Impact

- Eliminates false positive and false negative parameter extraction for `.hdbfunction` files.
- Removes the incorrect `outputParameter` extraction path for a file type that has no `OUT` or `INOUT` parameters.
- Prevents function body SQL and `RETURNS TABLE` column definitions from ever polluting the extraction result.
- Completes the Chevrotain parser coverage across all four primary HANA artifact types (`.hdbtable`, `.hdbview`, `.hdbprocedure`, `.hdbfunction`).
- Allows the dead `extractProcedureFunctionParameters()` regex function to be deleted, reducing maintenance surface.

---

## 3. User Personas

**HANA Developer / CAP Developer**
A developer who writes SAP HANA SQLScript scalar or table functions and configures `hana-linter` to enforce naming conventions on function parameter names (e.g., all input parameters must be prefixed `IV_`, table-type input parameters `TV_`). They run the linter locally and in CI. False positives block PRs unnecessarily; false negatives allow convention violations to ship.

**Tooling / Platform Engineer**
An engineer who maintains or extends `hana-linter` for their team. They need the `.hdbfunction` parser to follow the same structural conventions as the existing `.hdbtable`, `.hdbview`, and `.hdbprocedure` parsers so that the codebase remains uniform and new artifact parsers are straightforward to add.

---

## 4. User Stories

### Primary path

- **US-1**: As a HANA Developer, I want the linter to correctly identify all `IN` parameter names in an `.hdbfunction` file as `inputParameter` subjects, so that input parameter naming-convention checks produce no false positives or false negatives.

- **US-2**: As a HANA Developer, I want the `RETURNS` clause — whether a scalar data type (`RETURNS NVARCHAR(100)`) or a table type (`RETURNS TABLE (COL1 INTEGER, COL2 NVARCHAR(10))`) — to be completely excluded from parameter extraction, so that return type information never appears as a lint subject.

- **US-3**: As a HANA Developer, I want the SQL inside the function body (`AS BEGIN ... END`) to be entirely excluded from parameter extraction, so that `IN` keywords appearing in body SQL never produce spurious parameter entries.

- **US-4**: As a HANA Developer, I want inline `/* block comments */` and `-- line comments` inside `.hdbfunction` files to be completely ignored during parameter extraction, so that commented-out parameter declarations never trigger lint warnings.

### Edge cases

- **US-5**: As a HANA Developer, I want `TABLE`-type input parameters (`IN TV_INPUT TABLE (COL1 INTEGER, COL2 NVARCHAR(10))`) to have only the outer parameter name extracted, so that inner column names in the nested column list are never misidentified as parameter names.

- **US-6**: As a HANA Developer, I want both quoted (`"IV_CUSTOMER_ID"`) and unquoted (`IV_CUSTOMER_ID`) parameter names to be extracted and normalised (double-quotes stripped), so that mixed-style functions are linted without error.

- **US-7**: As a HANA Developer, I want schema-qualified function names (`"MY_SCHEMA"."MY_FUNCTION"`) to be parsed without error, so that cross-schema function definitions are fully supported.

- **US-8**: As a HANA Developer, I want function option clauses (`LANGUAGE SQLSCRIPT`, `SQL SECURITY INVOKER`, `SQL SECURITY DEFINER`, `DEFAULT SCHEMA <identifier>`, `WITH ENCRYPTION`) to be parsed without error and ignored during extraction, so that valid function files are never rejected.

- **US-9**: As a HANA Developer, I want a function with an empty parameter list (`FUNCTION F () RETURNS INTEGER AS BEGIN END`) to be parsed without error and return an empty extraction result.

- **US-10**: As a HANA Developer, I want `RETURNS TABLE (...)` column definitions to not be extracted as `inputParameter` subjects, so that return-column names are never confused with input parameter names.

- **US-11**: As a Tooling Engineer, I want the Chevrotain parser to emit structured parse errors (not throw unhandled exceptions) when it encounters unrecognised syntax, so that the linter degrades gracefully and reports a clear diagnostic instead of crashing.

- **US-12**: As a Tooling Engineer, I want the parser layer to expose a stable TypeScript interface (`extractFunctionParameters(fileContent: string): ExtractedSubject[]`) so that `content-lint.ts` is not coupled to Chevrotain internals and future parser upgrades are isolated.

- **US-13**: As a Tooling Engineer, I want `extractProcedureFunctionParameters()` to be deleted from `src/content-lint.ts` once it has no remaining callers, so that dead code does not accumulate in the codebase.

---

## 5. Requirements

### Functional Requirements

- **FR-1** Create a dedicated parser sub-module at `src/parsers/hdbfunction/` containing `lexer.ts`, `parser.ts`, `visitor.ts`, and `index.ts`, following the same file-structure conventions as `src/parsers/hdbtable/`, `src/parsers/hdbview/`, and `src/parsers/hdbprocedure/`.

- **FR-2** Implement an `.hdbfunction` lexer (`src/parsers/hdbfunction/lexer.ts`) using Chevrotain's `createToken` and `Lexer` APIs. The lexer must define tokens for, at minimum:
    - Skip tokens: block comment (`/* ... */`), line comment (`-- ...\n`), whitespace — all in `Lexer.SKIPPED` group
    - Function-level keywords: `CREATE` (optional), `FUNCTION`, `RETURNS`, `IN`, `TABLE`, `LANGUAGE`, `SQL`, `SECURITY`, `INVOKER`, `DEFINER`, `DEFAULT`, `SCHEMA`, `AS`, `BEGIN`, `END`, `WITH`, `ENCRYPTION`, `SQLSCRIPT`
    - An `Identifier` token covering unquoted identifiers (`[A-Za-z_][A-Za-z0-9_]*`); all keyword tokens must declare `longer_alt: Identifier` so that identifiers that begin with a keyword prefix (e.g. `INVOICE`, `INNER_KEY`, `RETURNS_DATA`) are not incorrectly split
    - A `QuotedIdentifier` token covering double-quoted identifiers (`"[^"]*"`)
    - Data type keywords in common use for function parameters and return types: `NVARCHAR`, `VARCHAR`, `ALPHANUM`, `SHORTTEXT`, `INTEGER`, `BIGINT`, `SMALLINT`, `TINYINT`, `DECIMAL`, `DOUBLE`, `FLOAT`, `REAL`, `BOOLEAN`, `DATE`, `TIME`, `TIMESTAMP`, `SECONDDATE`, `CLOB`, `BLOB`, `NCLOB`, `VARBINARY`
    - A `FunctionBody` token defined as a pattern that matches the entire `BEGIN ... END` block (including nested `BEGIN/END` pairs) as a single opaque token, so that all SQL inside the body is consumed without being tokenised as individual keywords
    - Numeric literals (integer and decimal)
    - Single-quoted string literals (for default values)
    - Parentheses, comma, semicolon, and dot punctuation tokens

- **FR-3** Implement an `.hdbfunction` parser (`src/parsers/hdbfunction/parser.ts`) using Chevrotain's `CstParser`. The grammar must cover:
    - `createFunctionStatement` — top-level rule: `[CREATE] FUNCTION <functionName> ( <parameterList> ) RETURNS <returnsClause> [<functionOptions>] AS <functionBody>`; the `CREATE` keyword is optional for compatibility with `.hdbfunction` files that omit it
    - `functionName` — a single identifier or a schema-qualified identifier (`<schema>.<name>`)
    - `parameterList` — zero or more `parameterDeclaration` entries separated by commas, or empty
    - `parameterDeclaration` — `IN <parameterName> <parameterType>`; only the `IN` mode is valid; no `OUT` or `INOUT` tokens are recognised in this position
    - `parameterType` — a scalar data type keyword (optionally followed by a precision/scale parenthesised list), or `TABLE ( <tableColumnList> )` for table-type input parameters
    - `tableColumnList` — one or more `tableColumnDefinition` entries separated by commas; these are parsed but **not** extracted as named subjects
    - `tableColumnDefinition` — `<identifier> <dataType>` (the column name is not extracted)
    - `returnsClause` — `<dataType>` for scalar functions, or `TABLE ( <returnColumnList> )` for table functions; the entire clause is consumed structurally but no names inside it are extracted
    - `returnColumnList` — one or more `returnColumnDefinition` entries separated by commas; parsed but **not** extracted
    - `returnColumnDefinition` — `<identifier> <dataType>` (the column name is not extracted)
    - `functionOptions` — zero or more option clauses that may appear between the `RETURNS` clause and `AS`: `LANGUAGE SQLSCRIPT`, `SQL SECURITY INVOKER`, `SQL SECURITY DEFINER`, `DEFAULT SCHEMA <identifier>`, `WITH ENCRYPTION`; each is parsed but not extracted
    - `functionBody` — the `FunctionBody` token consumed as a leaf; its content is not further parsed
    - Error recovery: use Chevrotain's built-in single-token deletion/insertion recovery so partial parses still return parameter names from the portions that did parse

- **FR-4** Implement a CST visitor (`src/parsers/hdbfunction/visitor.ts`) that:
    - Walks each `parameterDeclaration` node in the CST
    - For each `parameterDeclaration`, reads the `parameterName` child token
    - Strips surrounding double-quotes from quoted parameter names
    - Pushes `{ type: 'inputParameter', name }` onto the result for every parameter (all function parameters are implicitly `IN`)
    - Does **not** descend into `tableColumnList`, `returnColumnList`, or `functionBody` nodes for name extraction

- **FR-5** Implement a public extractor function `extractFunctionParameters(fileContent: string): ExtractedSubject[]` in `src/parsers/hdbfunction/index.ts`. This function:
    - Tokenises the input using the `.hdbfunction` lexer
    - Runs the parser
    - Visits the resulting CST via the `HdbFunctionParameterVisitor`
    - Returns an array of `ExtractedSubject` objects typed as `'inputParameter'`
    - If the lexer or parser reports errors, returns whatever parameters could be extracted from the partial tree; does not throw

- **FR-6** Update `extractSubjects()` in `src/content-lint.ts`:
    - Import `extractFunctionParameters` from `./parsers/hdbfunction/index`
    - Replace the existing `.hdbfunction` branch that calls `extractProcedureFunctionParameters` with a dedicated branch calling `extractFunctionParameters`
    - Delete the `extractProcedureFunctionParameters()` helper function if it has no remaining callers after this change

- **FR-7** The existing `ExtractedSubject` type and the rest of the `lintFileContent` pipeline must remain unchanged; the new parser is a drop-in replacement for the extraction step for `.hdbfunction` files only.

- **FR-8** The `extractFunctionParameters` function must handle both CRLF and LF line endings.

### Non-Functional Requirements

- **NFR-1** No new production dependencies are required; the feature uses the `chevrotain` package already declared as a `dependencies` entry.

- **NFR-2** No native binaries or build-step code generation. The parser is defined in TypeScript source files that compile with `npm run build` (`tsc`).

- **NFR-3** The lexer and parser must be instantiated **once** at module load time (not per-file), per Chevrotain best practices, to avoid re-parsing the grammar on every lint invocation.

- **NFR-4** Parsing a single `.hdbfunction` file must complete in under 100 ms on commodity hardware for files up to 5,000 lines.

- **NFR-5** The introduction of the `.hdbfunction` parser must not alter the public API of `src/index.ts`, `src/lint.ts`, or the `LintIssue` type.

- **NFR-6** The parser module must be independently unit-testable: given a string of `.hdbfunction` DDL, `extractFunctionParameters()` returns the expected `ExtractedSubject[]` array.

---

## 6. Acceptance Criteria

### AC-1 — IN parameter extraction (scalar function)

**Given** an `.hdbfunction` file declaring `IN IV_CUSTOMER_ID NVARCHAR(10), IN IV_DATE DATE` with `RETURNS NVARCHAR(100)`,  
**When** `extractFunctionParameters()` is called,  
**Then** it returns `[{ type: 'inputParameter', name: 'IV_CUSTOMER_ID' }, { type: 'inputParameter', name: 'IV_DATE' }]`.

### AC-2 — IN parameter extraction (table function)

**Given** an `.hdbfunction` file declaring `IN IV_STATUS NVARCHAR(1)` with `RETURNS TABLE (ID INTEGER, NAME NVARCHAR(100))`,  
**When** `extractFunctionParameters()` is called,  
**Then** it returns `[{ type: 'inputParameter', name: 'IV_STATUS' }]` and the result does **not** contain entries for `ID` or `NAME`.

### AC-3 — RETURNS TABLE columns are not extracted

**Given** an `.hdbfunction` file with `RETURNS TABLE (OUT_COL INTEGER, IN_COL NVARCHAR(10))`,  
**When** `extractFunctionParameters()` is called,  
**Then** the result does **not** contain `{ type: 'inputParameter', name: 'OUT_COL' }` or `{ type: 'inputParameter', name: 'IN_COL' }`.

### AC-4 — No outputParameter subjects produced

**Given** any valid `.hdbfunction` file with any number of `IN` parameters,  
**When** `extractFunctionParameters()` is called,  
**Then** the result contains **no** entries with `type: 'outputParameter'`.

### AC-5 — TABLE-type input parameter: inner columns not extracted

**Given** an `.hdbfunction` file with `IN TV_INPUT TABLE (COL1 INTEGER, COL2 NVARCHAR(100))`,  
**When** `extractFunctionParameters()` is called,  
**Then** the result contains `{ type: 'inputParameter', name: 'TV_INPUT' }` and does **not** contain entries for `COL1` or `COL2`.

### AC-6 — Function body SQL does not pollute extraction

**Given** an `.hdbfunction` file whose body contains `WHERE STATUS IN ('A', 'B')` and `RESULT_VAR = 1`,  
**When** `extractFunctionParameters()` is called,  
**Then** `STATUS`, `RESULT_VAR`, `A`, and `B` are **not** present in the result.

### AC-7 — Block comment exclusion

**Given** an `.hdbfunction` file where a complete parameter declaration is wrapped in `/* ... */`,  
**When** `extractFunctionParameters()` is called,  
**Then** the commented-out parameter name is **not** present in the result.

### AC-8 — Line comment exclusion

**Given** an `.hdbfunction` file where a parameter line is prefixed with `-- IN IV_OLD NVARCHAR(10),`,  
**When** `extractFunctionParameters()` is called,  
**Then** `IV_OLD` is **not** present in the result.

### AC-9 — Quoted identifier normalisation

**Given** an `.hdbfunction` file containing `IN "IV_CUSTOMER_ID" NVARCHAR(10)`,  
**When** `extractFunctionParameters()` is called,  
**Then** the result contains `{ type: 'inputParameter', name: 'IV_CUSTOMER_ID' }` (double-quotes stripped).

### AC-10 — Schema-qualified function name

**Given** an `.hdbfunction` file with the function name `"MY_SCHEMA"."MY_FUNCTION"`,  
**When** `extractFunctionParameters()` is called,  
**Then** no error is thrown and parameters are extracted normally.

### AC-11 — Function options are ignored

**Given** an `.hdbfunction` file containing `LANGUAGE SQLSCRIPT SQL SECURITY INVOKER` between the `RETURNS` clause and the `AS` keyword,  
**When** `extractFunctionParameters()` is called,  
**Then** no error is thrown, no spurious subjects are produced from the option keywords, and declared parameters are extracted correctly.

### AC-12 — Empty parameter list

**Given** an `.hdbfunction` file with an empty parameter list `FUNCTION F () RETURNS INTEGER AS BEGIN END`,  
**When** `extractFunctionParameters()` is called,  
**Then** it returns an empty array without error.

### AC-13 — CREATE keyword optional

**Given** an `.hdbfunction` file that begins with `FUNCTION MY_FUNC (...)` (no `CREATE` keyword),  
**When** `extractFunctionParameters()` is called,  
**Then** parameters are extracted correctly, identical to the same file with `CREATE FUNCTION MY_FUNC (...)`.

### AC-14 — Graceful error on unparseable file

**Given** an `.hdbfunction` file with invalid or unsupported syntax,  
**When** `extractFunctionParameters()` is called,  
**Then** it does **not** throw an exception; it returns any parameters that could be extracted from parseable portions and the function completes normally.

### AC-15 — No regression in `.hdbprocedure` extraction

**Given** any `.hdbprocedure` file that previously produced correct results,  
**When** `lintFileContent()` is called after the `.hdbfunction` refactor,  
**Then** the resulting `LintIssue[]` array is identical to what the `.hdbprocedure` Chevrotain parser produced before this change.

### AC-16 — Build integrity

**Given** the updated codebase,  
**When** `npm run build` is executed,  
**Then** it completes with zero TypeScript compilation errors.

### AC-17 — Dead code removal

**Given** the updated `src/content-lint.ts`,  
**When** the file is inspected,  
**Then** `extractProcedureFunctionParameters()` is no longer present (it has been deleted).

---

## 7. Out of Scope

- Validation of SQL _semantics_ inside the function body (e.g., correctness of SQL statements, variable scoping, return-type compatibility) — this linter validates naming conventions only.
- Extraction of the `RETURNS` clause data type or return-table column names as lint subjects — return-column names are structural metadata, not parameter names.
- Extraction of local variable declarations (`DECLARE <name> <type>`) from the function body — only formal parameters in the parameter list are extracted.
- Support for cursor declarations, condition handlers, or other SQLScript-specific body constructs.
- Support for `OUT` or `INOUT` parameter modes — these are not valid in HANA function definitions.
- Auto-fix / code-rewriting capabilities.
- Support for `.hdbcds`, `.hdbtabletype`, `.hdbscalarfunction` (if stored separately), or any other artifact type not explicitly mentioned.
- A full SQLScript grammar — the parser recognises only the function header (signature, `RETURNS` clause, and options) and treats the body as an opaque block.
