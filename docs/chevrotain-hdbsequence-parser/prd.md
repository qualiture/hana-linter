# PRD: Chevrotain Lexer/Parser for `.hdbsequence` Sequence Name Extraction

## 1. Feature Name

**Chevrotain `.hdbsequence` Sequence Name Extractor**

---

## 2. Goal

### Problem

The current `extractSubjects()` function in `src/content-lint.ts` has no handler for `.hdbsequence` files. When a user configures `contentRuleSets` targeting `.hdbsequence` sequence names, the linter silently returns an empty result — no names are extracted, no lint issues are raised, and the user receives no indication that content-level linting is unsupported for this artifact type.

The structure of an `.hdbsequence` file, while syntactically straightforward at the top level, introduces parsing challenges that make a simple regex approach unreliable:

- **`RESET BY` clause** — A sequence may include an optional `RESET BY SELECT ...` clause containing arbitrary SQL. A line-by-line regex will encounter identifiers, keywords, and quoted strings from that SELECT body and may incorrectly interpret them as the sequence name or produce other false extractions.
- **Quoted and unquoted names** — The sequence name may appear as `"MY_SEQUENCE"` (double-quoted) or `MY_SEQUENCE` (unquoted). A pattern tuned for one form will silently miss the other.
- **Schema-qualified names** — The sequence name is frequently schema-qualified (`"MY_SCHEMA"."MY_SEQUENCE"`); the dot operator and double-quote delimiters must not be treated as identifier boundaries by a naive scanner.
- **Block and line comments** — Developers comment out entire sequence definitions or individual clauses during development (`/* ... */` or `-- ...`); these must be excluded from extraction.
- **Optional semicolon terminator** — Some authoring tools omit the trailing `;`; the parser must tolerate both forms without error.

These failure modes mean that teams enforcing naming conventions on sequence names currently receive no feedback from the linter at all.

### Solution

Implement a Chevrotain-based lexer and parser for `.hdbsequence` files under `src/parsers/hdbsequence/`, following the same architectural patterns established by the existing `.hdbtable`, `.hdbview`, `.hdbprocedure`, `.hdbfunction`, `.hdbtabletype`, `.hdbrole`, and `.hdbcalculationview` parsers. The parser tokenises the file, identifies the `SEQUENCE <name>` declaration, and produces a CST from which a visitor extracts the sequence name. Wire the new extractor into `extractSubjects()` in `src/content-lint.ts` and extend the `ContentTarget` union type in `src/types/rules.ts` with the new `'sequenceName'` value.

### Impact

- Enables content-level naming-convention rules for `.hdbsequence` sequence names, a previously unsupported artifact type.
- Eliminates the silent no-op that currently affects teams who configure `contentRuleSets` for `.hdbsequence`.
- Extends the `ContentTarget` type with the semantically precise value `sequenceName`, aligning with how teams express sequence naming policies.
- Reuses and validates the parser infrastructure across an eighth HANA artifact type, further reinforcing its conventions and reducing the cost of any subsequent artifact parsers.

---

## 3. User Personas

**HANA Developer / CAP Developer**
A developer working on an SAP CAP or native HANA project who defines `.hdbsequence` files to generate surrogate keys or ordered identifiers for tables. They configure `hana-linter` to enforce naming conventions on sequence names (e.g., all sequence names must use `SCREAMING_SNAKE_CASE` and end with `_SEQ`, or must carry a project-specific prefix). They run the linter locally and in CI. False positives block PRs unnecessarily; false negatives allow convention violations to ship.

**Tooling / Platform Engineer**
An engineer who maintains or extends `hana-linter` for their team or organisation. They need the `.hdbsequence` parser to follow the same structural conventions as the existing parsers so that the codebase remains uniform and future artifact parsers are straightforward to add.

---

## 4. User Stories

### Primary path

- **US-1**: As a HANA Developer, I want the linter to extract the name of the sequence defined in an `.hdbsequence` file as a `sequenceName` subject, so that naming-convention rules can be applied to the sequence's declared name.

- **US-2**: As a HANA Developer, I want inline `/* block comments */` and `-- line comments` inside `.hdbsequence` files to be completely ignored during extraction, so that commented-out definitions never trigger lint warnings.

- **US-3**: As a HANA Developer, I want the `RESET BY SELECT` clause to be consumed without error and entirely ignored during name extraction, so that identifiers in the embedded SQL do not produce false extractions.

### Edge cases

- **US-4**: As a HANA Developer, I want both quoted (`"MY_SEQUENCE"`) and unquoted (`MY_SEQUENCE`) sequence names to be extracted and normalised (double-quotes stripped), so that mixed-style `.hdbsequence` files are linted without error.

- **US-5**: As a HANA Developer, I want schema-qualified sequence names (`"MY_SCHEMA"."MY_SEQUENCE"`) to be parsed without error and the local name (after the dot) extracted as the `sequenceName` subject, so that cross-schema sequence definitions are fully supported.

- **US-6**: As a HANA Developer, I want the optional sequence clauses (`INCREMENT BY`, `START WITH`, `MINVALUE`, `MAXVALUE`, `NO MINVALUE`, `NO MAXVALUE`, `CYCLE`, `NO CYCLE`, `DEPENDS ON`) to be consumed without error and ignored during name extraction, so that any combination of valid sequence options is handled gracefully.

- **US-7**: As a HANA Developer, I want a trailing semicolon to be accepted but not required, so that files produced by different tooling variants are supported without parser errors.

- **US-8**: As a Tooling Engineer, I want the Chevrotain parser to emit structured parse errors (not throw unhandled exceptions) when it encounters unrecognised syntax, so that the linter degrades gracefully and reports a clear diagnostic instead of crashing.

- **US-9**: As a Tooling Engineer, I want the parser layer to expose a stable TypeScript interface (`extractSequenceName(fileContent: string): ExtractedSubject[]`) so that `content-lint.ts` is not coupled to Chevrotain internals and future parser upgrades are isolated.

---

## 5. Requirements

### Functional Requirements

- **FR-1** Create a dedicated parser sub-module at `src/parsers/hdbsequence/` containing `lexer.ts`, `parser.ts`, `visitor.ts`, and `index.ts`, following the same file-structure conventions as the existing HANA artifact parser modules.

- **FR-2** Implement an `.hdbsequence` lexer (`src/parsers/hdbsequence/lexer.ts`) using Chevrotain's `createToken` and `Lexer` APIs. The lexer must define tokens for, at minimum:
    - Skip tokens: block comment (`/* ... */`), line comment (`-- ...\n`), whitespace — all in `Lexer.SKIPPED` group
    - Sequence DDL keywords: `SEQUENCE`, `INCREMENT`, `BY`, `START`, `WITH`, `MINVALUE`, `MAXVALUE`, `NO`, `CYCLE`, `RESET`, `DEPENDS`, `ON`, `SELECT`
    - Column-constraint-style keywords used inside `RESET BY SELECT`: `FROM`, `WHERE`, `IFNULL`, `MAX`, `MIN` (and any other SQL function/clause keywords that appear in common `RESET BY` expressions)
    - An `Identifier` token covering unquoted identifiers (`[A-Za-z_][A-Za-z0-9_]*`); all keyword tokens must declare `longer_alt: Identifier` so that identifiers whose names begin with a keyword prefix (e.g., `SEQUENCE_ID`, `NO_WAIT`) are not incorrectly split
    - A `QuotedIdentifier` token covering double-quoted identifiers (`"[^"]*"`)
    - Numeric literals (integer and decimal, for `START WITH`, `INCREMENT BY`, `MINVALUE`, `MAXVALUE` values)
    - Single-quoted string literals (for any string expressions that may appear inside `RESET BY SELECT`)
    - Parentheses, comma, semicolon, dot, `+`, `-`, `*`, `/`, `=` punctuation tokens

- **FR-3** Implement an `.hdbsequence` parser (`src/parsers/hdbsequence/parser.ts`) using Chevrotain's `CstParser`. The grammar must cover:
    - `sequenceStatement` — top-level rule: `SEQUENCE <sequenceName> { <sequenceOption> } [;]`
    - `sequenceName` — a single identifier or a schema-qualified identifier (`<schema> . <name>`); both quoted and unquoted forms are supported; the schema qualifier (if present) is consumed but not included in the extracted name
    - `sequenceOption` — any one of:
        - `INCREMENT BY <numericLiteral>`
        - `START WITH <numericLiteral>`
        - `MINVALUE <numericLiteral>` or `NO MINVALUE`
        - `MAXVALUE <numericLiteral>` or `NO MAXVALUE`
        - `CYCLE` or `NO CYCLE`
        - `RESET BY <resetByClause>`
        - `DEPENDS ON <identifier>`
    - `resetByClause` — `SELECT <tokenSequence>` where `<tokenSequence>` greedily consumes all remaining tokens up to the next top-level sequence option keyword or end of input; this rule must not perform any extraction
    - Error recovery: use Chevrotain's built-in single-token deletion/insertion recovery so that a partially valid file still yields the sequence name if the name portion parsed successfully

- **FR-4** Implement a CST visitor (`src/parsers/hdbsequence/visitor.ts`) that:
    - Walks the `sequenceName` node in the CST
    - Reads the identifier token representing the local sequence name (i.e., the part after the dot in a schema-qualified name, or the sole identifier when no schema qualifier is present)
    - Strips surrounding double-quotes from quoted names
    - Pushes `{ type: 'sequenceName', name }` onto the result

- **FR-5** Implement a public extractor function `extractSequenceName(fileContent: string): ExtractedSubject[]` in `src/parsers/hdbsequence/index.ts`. This function:
    - Tokenises the input using the `.hdbsequence` lexer
    - Runs the parser
    - Visits the resulting CST via the visitor from `visitor.ts`
    - Returns an array containing at most one `ExtractedSubject` object with `type: 'sequenceName'`
    - If the lexer or parser reports errors, returns whatever could be extracted from the partial tree; does not throw

- **FR-6** Extend the `ContentTarget` union type in `src/types/rules.ts` with the new literal value:

    ```typescript
    export type ContentTarget = 'field' | 'inputParameter' | 'outputParameter' | 'roleName' | 'grantedRoleName' | 'sequenceName';
    ```

    Also extend the `subjectType` union in the `LintIssue` or `ExtractedSubject` type in `src/types/issues.ts` to include `'sequenceName'`, so that the new subject type flows correctly through the existing lint pipeline.

- **FR-7** Update `extractSubjects()` in `src/content-lint.ts`:
    - Import `extractSequenceName` from `./parsers/hdbsequence/index`
    - Add a dedicated `if (extension === '.hdbsequence')` branch calling `extractSequenceName(fileContent)` alongside the existing artifact branches

- **FR-8** The existing `ExtractedSubject` type and the rest of the `lintFileContent` pipeline must remain unchanged except for the additive `'sequenceName'` type value; no existing extraction paths are modified.

- **FR-9** The `extractSequenceName` function must handle both CRLF and LF line endings.

### Non-Functional Requirements

- **NFR-1** No new production dependencies are required; the feature uses the `chevrotain` package already declared as a `dependencies` entry.

- **NFR-2** No native binaries or build-step code generation. The parser is defined in TypeScript source files that compile with `npm run build` (`tsc`).

- **NFR-3** The lexer and parser must be instantiated **once** at module load time (not per-file), per Chevrotain best practices, to avoid re-parsing the grammar on every lint invocation.

- **NFR-4** Parsing a single `.hdbsequence` file must complete in under 100 ms on commodity hardware for files up to 500 lines.

- **NFR-5** The introduction of the `.hdbsequence` parser must not alter the public API of `src/index.ts`, `src/lint.ts`, or the `LintIssue` type (beyond the additive `'sequenceName'` union member).

- **NFR-6** The parser module must be independently unit-testable: given a string of `.hdbsequence` DDL, `extractSequenceName()` returns the expected `ExtractedSubject[]` array.

---

## 6. Acceptance Criteria

### AC-1 — Standard sequence name extraction (unquoted)

**Given** an `.hdbsequence` file declaring `SEQUENCE MY_SEQUENCE INCREMENT BY 1 START WITH 1`,  
**When** `extractSequenceName()` is called,  
**Then** it returns exactly `[{ type: 'sequenceName', name: 'MY_SEQUENCE' }]`.

### AC-2 — Standard sequence name extraction (quoted)

**Given** an `.hdbsequence` file declaring `SEQUENCE "MY_SEQUENCE" INCREMENT BY 1 START WITH 1`,  
**When** `extractSequenceName()` is called,  
**Then** it returns exactly `[{ type: 'sequenceName', name: 'MY_SEQUENCE' }]` (double-quotes stripped).

### AC-3 — Schema-qualified name — local name extracted

**Given** an `.hdbsequence` file declaring `SEQUENCE "MY_SCHEMA"."MY_SEQUENCE" INCREMENT BY 1`,  
**When** `extractSequenceName()` is called,  
**Then** it returns exactly `[{ type: 'sequenceName', name: 'MY_SEQUENCE' }]` and `MY_SCHEMA` is **not** present in the result.

### AC-4 — Block comment exclusion

**Given** an `.hdbsequence` file where the entire sequence body is wrapped in a `/* ... */` block comment and `SEQUENCE MY_SEQUENCE` appears before it,  
**When** `extractSequenceName()` is called,  
**Then** only the declared sequence name is extracted; tokens inside the comment are **not** present in the result.

### AC-5 — Line comment exclusion

**Given** an `.hdbsequence` file containing the line `-- SEQUENCE OLD_SEQUENCE START WITH 1` followed by `SEQUENCE MY_SEQUENCE INCREMENT BY 1`,  
**When** `extractSequenceName()` is called,  
**Then** `OLD_SEQUENCE` is **not** present in the result and only `MY_SEQUENCE` is extracted.

### AC-6 — `RESET BY SELECT` clause is ignored

**Given** an `.hdbsequence` file containing:

```
SEQUENCE "ORDER_SEQ"
  START WITH 1
  INCREMENT BY 1
  RESET BY SELECT IFNULL(MAX("ORDER_ID"), 0) + 1 FROM "ORDERS"
```

**When** `extractSequenceName()` is called,  
**Then** the result contains exactly `[{ type: 'sequenceName', name: 'ORDER_SEQ' }]` and no identifiers from the `RESET BY SELECT` clause (`ORDER_ID`, `ORDERS`, `IFNULL`, `MAX`) are present.

### AC-7 — All standard sequence options consumed without error

**Given** an `.hdbsequence` file that uses all optional clauses:

```
SEQUENCE "FULL_SEQ"
  INCREMENT BY 5
  START WITH 100
  MINVALUE 1
  MAXVALUE 9999999
  NO CYCLE
  DEPENDS ON "MY_TABLE";
```

**When** `extractSequenceName()` is called,  
**Then** it returns exactly `[{ type: 'sequenceName', name: 'FULL_SEQ' }]` and no exception is thrown.

### AC-8 — Optional semicolon terminator

**Given** two `.hdbsequence` files that are identical except one ends with `;` and the other does not,  
**When** `extractSequenceName()` is called on each,  
**Then** both return identical results (`[{ type: 'sequenceName', name: '<name>' }]`) and neither throws an exception.

### AC-9 — `NO MINVALUE` / `NO MAXVALUE` variants

**Given** an `.hdbsequence` file declaring `NO MINVALUE` and `NO MAXVALUE` instead of numeric bounds,  
**When** `extractSequenceName()` is called,  
**Then** the sequence name is correctly extracted and no exception is thrown.

### AC-10 — Graceful error on unparseable file

**Given** an `.hdbsequence` file with invalid or unsupported syntax,  
**When** `extractSequenceName()` is called,  
**Then** it does **not** throw an exception; it returns whatever could be extracted from the parseable portion (which may be an empty array) and the function completes normally.

### AC-11 — Integration with `lintFileContent` pipeline

**Given** an `.hdbsequence` file declaring `SEQUENCE "MY_SEQ"` and a `contentRuleSets` configuration with a `sequenceName` rule requiring the name to match `^[A-Z][A-Z0-9_]*_SEQ$`,  
**When** `lintFileContent()` is called,  
**Then** `MY_SEQ` is evaluated against the rule, a `LintIssue` is raised for the violation, and the issue correctly identifies the `subjectType` as `'sequenceName'` and the `subjectName` as `'MY_SEQ'`.

### AC-12 — Build integrity

**Given** the updated codebase including the new parser module and the extended `ContentTarget` type,  
**When** `npm run build` is executed,  
**Then** it completes with zero TypeScript compilation errors.

---

## 7. Out of Scope

- Extraction of sequence option values (e.g., the numeric start value, increment size, or min/max bounds) — only the sequence name is subject to naming convention rules.
- Validation of sequence option semantics (e.g., whether `START WITH` falls within `MINVALUE`/`MAXVALUE` bounds) — this linter validates naming conventions only.
- Support for `CREATE SEQUENCE` DDL syntax (the HANA SQL DDL form) — `.hdbsequence` HDI artifact files use the `SEQUENCE` keyword without `CREATE`; the standard SQL `CREATE SEQUENCE` syntax is a separate concern and out of scope.
- Parsing of arbitrary SQL inside the `RESET BY SELECT` clause — the clause is consumed as an opaque token stream; no structural analysis of the embedded SELECT is performed.
- Auto-fix / code-rewriting capabilities.
- Extraction of object names referenced in `DEPENDS ON` clauses — these are dependency declarations, not naming-convention subjects.
