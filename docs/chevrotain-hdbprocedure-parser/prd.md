# PRD: Chevrotain Lexer/Parser for `.hdbprocedure` Parameter Extraction

## 1. Feature Name

**Chevrotain `.hdbprocedure` Procedure Parameter Extractor**

---

## 2. Goal

### Problem

The current `extractProcedureFunctionParameters()` function in `src/content-lint.ts` uses a single regular expression to scan raw `.hdbprocedure` file content for parameter declarations matching the `IN|OUT|INOUT <name> <type>` pattern. This approach is unreliable in realistic scenarios:

- **Procedure body pollution** — The SQL body between `BEGIN` and `END` frequently contains `IN`, `OUT`, and `INOUT` as SQL predicates (e.g., `WHERE STATUS IN ('A', 'B')`), subquery correlations, or output variable assignments. The regex has no concept of lexical scope and will extract spurious parameter names from the body.
- **Block comments** (`/* ... */`) spanning multiple lines cause the scanner to misidentify commented-out parameter definitions as real parameters.
- **TABLE-type parameters** — A parameter declared as `INOUT TV_RESULT TABLE (ID INTEGER, NAME NVARCHAR(100))` includes a nested column list; the regex cannot distinguish the outer parameter name from the inner column names if the column list spans multiple lines in a way that happens to match the pattern.
- **Multi-line parameter definitions** — A parameter name on one line and its data type on the next is silently skipped or misread.
- **Default values and constraints** — Parameters may carry default-value expressions or constraints that contain token sequences matching the extraction heuristic.

These failure modes produce false positives and false negatives in content-lint results for `.hdbprocedure` files, undermining trust in the linter when run in CI pipelines.

### Solution

Implement a Chevrotain-based lexer and parser for `.hdbprocedure` files under `src/parsers/hdbprocedure/`, following the same architectural patterns established by the `.hdbtable` and `.hdbview` parsers. The parser tokenises the file, recognises the parameter list that precedes the procedure body, and produces a CST from which a visitor extracts only top-level `IN`/`OUT`/`INOUT` parameter names. The procedure body (`AS BEGIN ... END`) is consumed as an opaque token block so that SQL inside the body never contaminates the extraction result.

Wire the new extractor into `extractSubjects()` in `src/content-lint.ts`, replacing the regex path for `.hdbprocedure` files only. The `.hdbfunction` extension remains on the existing regex path until a dedicated follow-on feature addresses it.

### Impact

- Eliminates false positive and false negative parameter extraction for `.hdbprocedure` files.
- Prevents procedure body SQL from ever being misidentified as parameter declarations.
- Extends the established Chevrotain parser infrastructure to a third HANA artifact type, reinforcing the pattern and reducing the cost of future parsers.
- Increases confidence in content-lint results, making the linter trustworthy enough to gate `.hdbprocedure` naming conventions in CI.

---

## 3. User Personas

**HANA Developer / CAP Developer**
A developer who writes SAP HANA SQLScript stored procedures and configures `hana-linter` to enforce naming conventions on procedure parameter names (e.g., all input parameters must be prefixed `IV_`, all output parameters `EV_`, all table parameters `TV_`). They run the linter locally and in CI. False positives block PRs unnecessarily; false negatives allow convention violations to ship.

**Tooling / Platform Engineer**
An engineer who maintains or extends `hana-linter` for their team. They need the `.hdbprocedure` parser to follow the same structural conventions as the existing `.hdbtable` and `.hdbview` parsers so that the codebase remains uniform and new artifact parsers are straightforward to add.

---

## 4. User Stories

### Primary path

- **US-1**: As a HANA Developer, I want the linter to correctly identify all `IN` and `INOUT` parameter names in an `.hdbprocedure` file as `inputParameter` subjects, so that input parameter naming-convention checks produce no false positives or false negatives.

- **US-2**: As a HANA Developer, I want the linter to correctly identify all `OUT` and `INOUT` parameter names in an `.hdbprocedure` file as `outputParameter` subjects, so that output parameter naming-convention checks produce no false positives or false negatives.

- **US-3**: As a HANA Developer, I want the SQL inside the procedure body (`AS BEGIN ... END`) to be entirely excluded from parameter extraction, so that `IN`, `OUT`, and `INOUT` keywords appearing in body SQL never produce spurious parameter entries.

- **US-4**: As a HANA Developer, I want inline `/* block comments */` and `-- line comments` inside `.hdbprocedure` files to be completely ignored during parameter extraction, so that commented-out parameter declarations never trigger lint warnings.

### Edge cases

- **US-5**: As a HANA Developer, I want `TABLE`-type parameters (`IN TV_INPUT TABLE (COL1 INTEGER, COL2 NVARCHAR(10))`) to have only the outer parameter name extracted, so that inner column names in the nested column list are never misidentified as parameter names.

- **US-6**: As a HANA Developer, I want both quoted (`"IV_CUSTOMER_ID"`) and unquoted (`IV_CUSTOMER_ID`) parameter names to be extracted and normalised (double-quotes stripped), so that mixed-style procedures are linted without error.

- **US-7**: As a HANA Developer, I want schema-qualified procedure names (`"MY_SCHEMA"."MY_PROCEDURE"`) to be parsed without error, so that cross-schema procedure definitions are fully supported.

- **US-8**: As a HANA Developer, I want an `INOUT` parameter to appear as **both** an `inputParameter` and an `outputParameter` subject in the extraction result, so that separate input and output naming rules are each applied to it.

- **US-9**: As a HANA Developer, I want procedure option clauses (`LANGUAGE SQLSCRIPT`, `SQL SECURITY INVOKER`, `SQL SECURITY DEFINER`, `READS SQL DATA`, `MODIFIES SQL DATA`, `DEFAULT SCHEMA`) to be parsed without error and ignored during extraction.

- **US-10**: As a HANA Developer, I want a procedure with an empty parameter list (`PROCEDURE P ()`) to be parsed without error and return an empty extraction result.

- **US-11**: As a Tooling Engineer, I want the Chevrotain parser to emit structured parse errors (not throw unhandled exceptions) when it encounters unrecognised syntax, so that the linter degrades gracefully and reports a clear diagnostic instead of crashing.

- **US-12**: As a Tooling Engineer, I want the parser layer to expose a stable TypeScript interface (`extractProcedureParameters(fileContent: string): ExtractedSubject[]`) so that `content-lint.ts` is not coupled to Chevrotain internals and future parser upgrades are isolated.

---

## 5. Requirements

### Functional Requirements

- **FR-1** Create a dedicated parser sub-module at `src/parsers/hdbprocedure/` containing `lexer.ts`, `parser.ts`, `visitor.ts`, and `index.ts`, following the same file-structure conventions as `src/parsers/hdbtable/` and `src/parsers/hdbview/`.

- **FR-2** Implement an `.hdbprocedure` lexer (`src/parsers/hdbprocedure/lexer.ts`) using Chevrotain's `createToken` and `Lexer` APIs. The lexer must define tokens for, at minimum:
    - Skip tokens: block comment (`/* ... */`), line comment (`-- ...\n`), whitespace — all in `Lexer.SKIPPED` group
    - Procedure-level keywords: `CREATE` (optional), `PROCEDURE`, `IN`, `OUT`, `INOUT`, `TABLE`, `LANGUAGE`, `SQL`, `SECURITY`, `INVOKER`, `DEFINER`, `READS`, `MODIFIES`, `DATA`, `DEFAULT`, `SCHEMA`, `AS`, `BEGIN`, `END`, `WITH`, `ENCRYPTION`
    - An `Identifier` token covering unquoted identifiers (`[A-Za-z_][A-Za-z0-9_]*`); all keyword tokens must declare `longer_alt: Identifier` so that identifiers that start with a keyword (e.g. `INVOICE`, `OUTER_KEY`) are not incorrectly split
    - A `QuotedIdentifier` token covering double-quoted identifiers (`"[^"]*"`)
    - Data type keywords in common use for procedure parameters: `NVARCHAR`, `VARCHAR`, `ALPHANUM`, `SHORTTEXT`, `INTEGER`, `BIGINT`, `SMALLINT`, `TINYINT`, `DECIMAL`, `DOUBLE`, `FLOAT`, `REAL`, `BOOLEAN`, `DATE`, `TIME`, `TIMESTAMP`, `SECONDDATE`, `CLOB`, `BLOB`, `NCLOB`, `VARBINARY`
    - A `ProcedureBody` token defined as a pattern that matches the entire `BEGIN ... END` block (including nested `BEGIN/END` pairs) as a single opaque token, so that all SQL inside the body is consumed without being tokenised as individual keywords
    - Numeric literals (integer and decimal)
    - Single-quoted string literals (for default values)
    - Parentheses, comma, semicolon, and dot punctuation tokens

- **FR-3** Implement an `.hdbprocedure` parser (`src/parsers/hdbprocedure/parser.ts`) using Chevrotain's `CstParser`. The grammar must cover:
    - `createProcedureStatement` — top-level rule: `[CREATE] PROCEDURE <procedureName> ( <parameterList> ) [<procedureOptions>] AS <procedureBody>`; the `CREATE` keyword is optional for compatibility with `.hdbprocedure` files that omit it
    - `procedureName` — a single identifier or a schema-qualified identifier (`<schema>.<name>`)
    - `parameterList` — zero or more `parameterDeclaration` entries separated by commas, or empty
    - `parameterDeclaration` — `<parameterMode> <parameterName> <parameterType>` where `<parameterMode>` is `IN`, `OUT`, or `INOUT`
    - `parameterType` — a scalar data type keyword (optionally followed by a precision/scale parenthesised list), or `TABLE ( <tableColumnList> )` for table-type parameters
    - `tableColumnList` — one or more `tableColumnDefinition` entries separated by commas; these are parsed but **not** extracted as named subjects
    - `tableColumnDefinition` — `<identifier> <dataType>` (the column name is not extracted)
    - `procedureOptions` — zero or more option clauses that may appear between the closing `)` of the parameter list and `AS`: `LANGUAGE SQLSCRIPT`, `SQL SECURITY INVOKER`, `SQL SECURITY DEFINER`, `READS SQL DATA`, `MODIFIES SQL DATA`, `DEFAULT SCHEMA <identifier>`, `WITH ENCRYPTION`; each is parsed but not extracted
    - `procedureBody` — the `ProcedureBody` token consumed as a leaf; its content is not further parsed
    - Error recovery: use Chevrotain's built-in single-token deletion/insertion recovery so partial parses still return parameter names from the portions that did parse

- **FR-4** Implement a CST visitor (`src/parsers/hdbprocedure/visitor.ts`) that:
    - Walks each `parameterDeclaration` node in the CST
    - For each `parameterDeclaration`, reads the `parameterMode` child token (`IN`, `OUT`, or `INOUT`) and the `parameterName` child token
    - Strips surrounding double-quotes from quoted parameter names
    - If mode is `IN` or `INOUT`, pushes `{ type: 'inputParameter', name }` onto the result
    - If mode is `OUT` or `INOUT`, pushes `{ type: 'outputParameter', name }` onto the result (so an `INOUT` parameter yields two entries)
    - Does **not** descend into `tableColumnList` nodes for name extraction

- **FR-5** Implement a public extractor function `extractProcedureParameters(fileContent: string): ExtractedSubject[]` in `src/parsers/hdbprocedure/index.ts`. This function:
    - Tokenises the input using the `.hdbprocedure` lexer
    - Runs the parser
    - Visits the resulting CST via the `HdbProcedureParameterVisitor`
    - Returns an array of `ExtractedSubject` objects typed as `'inputParameter'` or `'outputParameter'`
    - If the lexer or parser reports errors, returns whatever parameters could be extracted from the partial tree; does not throw

- **FR-6** Update `extractSubjects()` in `src/content-lint.ts`:
    - Import `extractProcedureParameters` from `./parsers/hdbprocedure/index`
    - Replace the `.hdbprocedure` branch within the existing `if (extension === '.hdbprocedure' || extension === '.hdbfunction')` guard with a dedicated `if (extension === '.hdbprocedure')` branch calling `extractProcedureParameters`
    - Retain the existing `.hdbfunction` branch calling the regex-based `extractProcedureFunctionParameters` unchanged

- **FR-7** The existing `ExtractedSubject` type and the rest of the `lintFileContent` pipeline must remain unchanged; the new parser is a drop-in replacement for the extraction step for `.hdbprocedure` files only.

- **FR-8** The `extractProcedureParameters` function must handle both CRLF and LF line endings.

### Non-Functional Requirements

- **NFR-1** No new production dependencies are required; the feature uses the `chevrotain` package already declared as a `dependencies` entry.

- **NFR-2** No native binaries or build-step code generation. The parser is defined in TypeScript source files that compile with `npm run build` (`tsc`).

- **NFR-3** The lexer and parser must be instantiated **once** at module load time (not per-file), per Chevrotain best practices, to avoid re-parsing the grammar on every lint invocation.

- **NFR-4** Parsing a single `.hdbprocedure` file must complete in under 100 ms on commodity hardware for files up to 5,000 lines.

- **NFR-5** The introduction of the `.hdbprocedure` parser must not alter the public API of `src/index.ts`, `src/lint.ts`, or the `LintIssue` type.

- **NFR-6** The parser module must be independently unit-testable: given a string of `.hdbprocedure` DDL, `extractProcedureParameters()` returns the expected `ExtractedSubject[]` array.

---

## 6. Acceptance Criteria

### AC-1 — IN parameter extraction

**Given** an `.hdbprocedure` file declaring `IN IV_CUSTOMER_ID NVARCHAR(10), IN IV_DATE DATE`,  
**When** `extractProcedureParameters()` is called,  
**Then** it returns `[{ type: 'inputParameter', name: 'IV_CUSTOMER_ID' }, { type: 'inputParameter', name: 'IV_DATE' }]`.

### AC-2 — OUT parameter extraction

**Given** an `.hdbprocedure` file declaring `OUT EV_COUNT INTEGER, OUT EV_STATUS NVARCHAR(1)`,  
**When** `extractProcedureParameters()` is called,  
**Then** it returns `[{ type: 'outputParameter', name: 'EV_COUNT' }, { type: 'outputParameter', name: 'EV_STATUS' }]`.

### AC-3 — INOUT parameter yields both subject types

**Given** an `.hdbprocedure` file declaring a single `INOUT TV_RESULT TABLE (ID INTEGER)`,  
**When** `extractProcedureParameters()` is called,  
**Then** the result contains **both** `{ type: 'inputParameter', name: 'TV_RESULT' }` and `{ type: 'outputParameter', name: 'TV_RESULT' }`.

### AC-4 — TABLE-type parameter: inner columns not extracted

**Given** an `.hdbprocedure` file with `IN TV_INPUT TABLE (COL1 INTEGER, COL2 NVARCHAR(100))`,  
**When** `extractProcedureParameters()` is called,  
**Then** the result contains `{ type: 'inputParameter', name: 'TV_INPUT' }` and does **not** contain entries for `COL1` or `COL2`.

### AC-5 — Procedure body SQL does not pollute extraction

**Given** an `.hdbprocedure` file whose body contains `WHERE STATUS IN ('A', 'B')` and `OUT_VAR = 1`,  
**When** `extractProcedureParameters()` is called,  
**Then** `STATUS`, `OUT_VAR`, `A`, and `B` are **not** present in the result.

### AC-6 — Block comment exclusion

**Given** an `.hdbprocedure` file where a complete parameter declaration is wrapped in `/* ... */`,  
**When** `extractProcedureParameters()` is called,  
**Then** the commented-out parameter name is **not** present in the result.

### AC-7 — Line comment exclusion

**Given** an `.hdbprocedure` file where a parameter line is prefixed with `-- IN IV_OLD NVARCHAR(10),`,  
**When** `extractProcedureParameters()` is called,  
**Then** `IV_OLD` is **not** present in the result.

### AC-8 — Quoted identifier normalisation

**Given** an `.hdbprocedure` file containing `IN "IV_CUSTOMER_ID" NVARCHAR(10)`,  
**When** `extractProcedureParameters()` is called,  
**Then** the result contains `{ type: 'inputParameter', name: 'IV_CUSTOMER_ID' }` (double-quotes stripped).

### AC-9 — Schema-qualified procedure name

**Given** an `.hdbprocedure` file with the procedure name `"MY_SCHEMA"."MY_PROCEDURE"`,  
**When** `extractProcedureParameters()` is called,  
**Then** no error is thrown and parameters are extracted normally.

### AC-10 — Procedure options are ignored

**Given** an `.hdbprocedure` file containing `LANGUAGE SQLSCRIPT SQL SECURITY INVOKER READS SQL DATA` between the parameter list closing `)` and the `AS` keyword,  
**When** `extractProcedureParameters()` is called,  
**Then** no error is thrown, no spurious subjects are produced from the option keywords, and declared parameters are extracted correctly.

### AC-11 — Empty parameter list

**Given** an `.hdbprocedure` file with an empty parameter list `PROCEDURE P () AS BEGIN END`,  
**When** `extractProcedureParameters()` is called,  
**Then** it returns an empty array without error.

### AC-12 — CREATE keyword optional

**Given** an `.hdbprocedure` file that begins with `PROCEDURE MY_PROC (...)` (no `CREATE` keyword),  
**When** `extractProcedureParameters()` is called,  
**Then** parameters are extracted correctly, identical to the same file with `CREATE PROCEDURE MY_PROC (...)`.

### AC-13 — Graceful error on unparseable file

**Given** an `.hdbprocedure` file with invalid or unsupported syntax,  
**When** `extractProcedureParameters()` is called,  
**Then** it does **not** throw an exception; it returns any parameters that could be extracted from parseable portions and the function completes normally.

### AC-14 — No regression in `.hdbfunction` extraction

**Given** any `.hdbfunction` file that previously produced correct results with the regex extractor,  
**When** `lintFileContent()` is called after the `.hdbprocedure` refactor,  
**Then** the resulting `LintIssue[]` array is identical to what the regex extractor produced for that file (the `.hdbfunction` path is unmodified).

### AC-15 — Build integrity

**Given** the updated codebase,  
**When** `npm run build` is executed,  
**Then** it completes with zero TypeScript compilation errors.

---

## 7. Out of Scope

- Parser for `.hdbfunction` — scalar and table functions have a different DDL shape (including a `RETURNS` clause) and will be addressed in a dedicated follow-on feature.
- Validation of SQL _semantics_ inside the procedure body (e.g., correctness of SQL statements, variable scoping) — this linter validates naming conventions only.
- Extraction of local variable declarations (`DECLARE <name> <type>`) from the procedure body — only formal parameters in the parameter list are extracted.
- Support for cursor declarations, condition handlers, or other SQLScript-specific body constructs.
- Auto-fix / code-rewriting capabilities.
- Support for `.hdbcds`, `.hdbtabletype`, or any other artifact type not explicitly mentioned.
- A full SQLScript grammar — the parser recognises only the procedure header (up to and including `AS`) and treats the body as an opaque block.
