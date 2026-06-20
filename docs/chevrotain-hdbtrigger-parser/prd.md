# PRD: Chevrotain Lexer/Parser for `.hdbtrigger` Trigger Name Extraction

## 1. Feature Name

**Chevrotain `.hdbtrigger` Trigger Name Extractor**

---

## 2. Goal

### Problem

The current `extractSubjects()` function in `src/content-lint.ts` has no handler for `.hdbtrigger` files. When a user configures `contentRuleSets` targeting `.hdbtrigger` trigger names, the linter silently returns an empty result — no names are extracted, no lint issues are raised, and the user receives no indication that content-level linting is unsupported for this artifact type.

The structure of an `.hdbtrigger` file, while syntactically regular at the declaration level, introduces parsing challenges that make a simple regex approach unreliable:

- **Trigger body pollution** — The body between `BEGIN` and `END` contains arbitrary SQLScript statements. A line-by-line scanner will encounter `TRIGGER`, `CREATE`, `ON`, and other declaration-level keywords inside DML statements inside the body and may misidentify them as trigger metadata or produce spurious extractions.
- **`REFERENCING` clause aliases** — An `.hdbtrigger` file may include a `REFERENCING OLD ROW AS <alias> NEW ROW AS <alias>` clause between the `ON <tableName>` clause and the trigger body. The alias identifiers appear as plain identifiers immediately following `AS`, which a naive regex keyed on `AS` could mistake for a different construct.
- **`UPDATE OF <column_list>`** — The optional `OF <column_list>` modifier on the `UPDATE` event exposes a comma-separated list of column identifiers. Any scanner that does not correctly track parser state will encounter those column names without knowing they are inside a column list, and may treat them as candidate trigger names.
- **`WHEN` clause expressions** — The optional `WHEN (<search_condition>)` clause before the body contains arbitrary boolean expressions (comparisons, function calls, `AND`/`OR` logic) that include unquoted and quoted identifiers. A regex cannot reliably delimit this clause and distinguish its content from the surrounding declaration.
- **Quoted and unquoted names** — The trigger name may appear as `"MY_TRIGGER"` (double-quoted) or `MY_TRIGGER` (unquoted). A pattern tuned for one form will silently miss the other.
- **Schema-qualified names** — The trigger name is frequently schema-qualified (`"MY_SCHEMA"."MY_TRIGGER"`); the dot operator and double-quote delimiters must not be treated as identifier boundaries by a naive scanner, and the schema qualifier must not be confused with the local trigger name.
- **Block and line comments** — Developers comment out trigger definitions or individual clauses during development (`/* ... */` or `-- ...`); these must be fully excluded from extraction.
- **Optional `CREATE` keyword** — Some authoring styles omit `CREATE` and begin the file directly with `TRIGGER <name> ...`; the parser must accept both forms.
- **Optional semicolon terminator** — Some authoring tools omit the trailing `;`; the parser must tolerate both forms without error.

These failure modes mean that teams enforcing naming conventions on HANA trigger names currently receive no feedback from the linter at all.

### Solution

Implement a Chevrotain-based lexer and parser for `.hdbtrigger` files under `src/parsers/hdbtrigger/`, following the same architectural patterns established by the existing `.hdbtable`, `.hdbview`, `.hdbprocedure`, `.hdbfunction`, `.hdbtabletype`, `.hdbrole`, `.hdbcalculationview`, `.hdbsequence`, `.hdbschedulerjob`, and `.hdbindex` parsers. The parser tokenises the file, identifies the `[CREATE] TRIGGER <name>` declaration, and produces a CST from which a visitor extracts the trigger name. The trigger body (`BEGIN ... END`) is consumed as an opaque token block so that SQLScript inside it never contaminates extraction. Wire the new extractor into `extractSubjects()` in `src/content-lint.ts` and extend the `ContentTarget` union type in `src/types/rules.ts` with the new `'triggerName'` value.

### Impact

- Enables content-level naming-convention rules for `.hdbtrigger` trigger names, a previously unsupported artifact type.
- Eliminates the silent no-op that currently affects teams who configure `contentRuleSets` for `.hdbtrigger`.
- Extends the `ContentTarget` type with the semantically precise value `triggerName`, aligning with how teams express trigger naming policies.
- Reuses and validates the parser infrastructure across an eleventh HANA artifact type, further reinforcing its conventions and reducing the cost of any subsequent artifact parsers.

---

## 3. User Personas

**HANA Developer / CAP Developer**
A developer working on an SAP CAP or native HANA project who defines `.hdbtrigger` files to automate table-level audit logging, enforcing referential integrity, or cascading updates. They configure `hana-linter` to enforce naming conventions on trigger names (e.g., all trigger names must carry a timing/event prefix such as `TRG_AI_` for "After Insert", use `SCREAMING_SNAKE_CASE`, or end with a table-name suffix). They run the linter locally and in CI. False positives block PRs unnecessarily; false negatives allow convention violations to ship.

**Tooling / Platform Engineer**
An engineer who maintains or extends `hana-linter` for their team or organisation. They need the `.hdbtrigger` parser to follow the same structural conventions as the existing parsers so that the codebase remains uniform and future artifact parsers are straightforward to add.

---

## 4. User Stories

### Primary path

- **US-1**: As a HANA Developer, I want the linter to extract the name of the trigger defined in an `.hdbtrigger` file as a `triggerName` subject, so that naming-convention rules can be applied to the trigger's declared name.

- **US-2**: As a HANA Developer, I want inline `/* block comments */` and `-- line comments` inside `.hdbtrigger` files to be completely ignored during extraction, so that commented-out definitions never trigger lint warnings.

- **US-3**: As a HANA Developer, I want the trigger body (`BEGIN ... END`) to be consumed as an opaque block and entirely excluded from extraction, so that SQLScript statements and identifiers inside the body never produce false trigger-name extractions.

- **US-4**: As a HANA Developer, I want the `REFERENCING` clause (including `OLD ROW AS`, `NEW ROW AS`, `OLD TABLE AS`, `NEW TABLE AS` aliases) to be parsed without error and ignored during extraction, so that correlation-name aliases are never mistaken for the trigger name.

### Edge cases

- **US-5**: As a HANA Developer, I want both quoted (`"MY_TRIGGER"`) and unquoted (`MY_TRIGGER`) trigger names to be extracted and normalised (double-quotes stripped), so that mixed-style `.hdbtrigger` files are linted without error.

- **US-6**: As a HANA Developer, I want schema-qualified trigger names (`"MY_SCHEMA"."MY_TRIGGER"`) to be parsed without error and the local name (after the dot) extracted as the `triggerName` subject, so that cross-schema trigger definitions are fully supported.

- **US-7**: As a HANA Developer, I want all three supported timing keywords (`BEFORE`, `AFTER`, `INSTEAD OF`) to be consumed without error, so that every standard trigger shape is handled gracefully.

- **US-8**: As a HANA Developer, I want all three event types — `INSERT`, `DELETE`, and `UPDATE` (with or without an `OF <column_list>` modifier) — to be consumed without error and entirely excluded from extraction, so that column names in an `UPDATE OF` list are never mistaken for the trigger name.

- **US-9**: As a HANA Developer, I want the `FOR EACH ROW` and `FOR EACH STATEMENT` granularity clauses to be consumed without error and ignored during extraction.

- **US-10**: As a HANA Developer, I want the optional `WHEN (<condition>)` clause to be consumed without error and ignored during extraction, so that predicate expressions in the condition are never mistaken for trigger metadata.

- **US-11**: As a HANA Developer, I want the optional `CREATE` keyword to be accepted or absent (`TRIGGER <name> ...` vs. `CREATE TRIGGER <name> ...`), so that all authoring styles are supported without parser errors.

- **US-12**: As a HANA Developer, I want a trailing semicolon to be accepted but not required, so that files produced by different tooling variants are supported without parser errors.

- **US-13**: As a Tooling Engineer, I want the Chevrotain parser to emit structured parse errors (not throw unhandled exceptions) when it encounters unrecognised syntax, so that the linter degrades gracefully and reports a clear diagnostic instead of crashing.

- **US-14**: As a Tooling Engineer, I want the parser layer to expose a stable TypeScript interface (`extractTriggerName(fileContent: string): ExtractedSubject[]`) so that `content-lint.ts` is not coupled to Chevrotain internals and future parser upgrades are isolated.

---

## 5. Requirements

### Functional Requirements

- **FR-1** Create a dedicated parser sub-module at `src/parsers/hdbtrigger/` containing `lexer.ts`, `parser.ts`, `visitor.ts`, and `index.ts`, following the same file-structure conventions as the existing HANA artifact parser modules.

- **FR-2** Implement an `.hdbtrigger` lexer (`src/parsers/hdbtrigger/lexer.ts`) using Chevrotain's `createToken` and `Lexer` APIs. The lexer must define tokens for, at minimum:
    - Skip tokens: block comment (`/* ... */`), line comment (`-- ...\n`), whitespace — all in `Lexer.SKIPPED` group
    - Trigger DDL keywords: `CREATE`, `TRIGGER`, `BEFORE`, `AFTER`, `INSTEAD`, `OF`, `INSERT`, `UPDATE`, `DELETE`, `ON`, `REFERENCING`, `OLD`, `NEW`, `ROW`, `TABLE`, `AS`, `FOR`, `EACH`, `STATEMENT`, `WHEN`, `BEGIN`, `END`
    - An `Identifier` token covering unquoted identifiers (`[A-Za-z_][A-Za-z0-9_]*`); all keyword tokens must declare `longer_alt: Identifier` so that identifiers whose names begin with a keyword prefix (e.g., `TRIGGER_NAME`, `BEFORE_DATE`, `INSERT_FLAG`) are not incorrectly split
    - A `QuotedIdentifier` token covering double-quoted identifiers (`"[^"]*"`)
    - A `TriggerBody` token defined as a pattern that matches the entire `BEGIN ... END` block (including nested `BEGIN/END` pairs from inner blocks or `CASE/END` constructs) as a single opaque token, so that all SQLScript inside the body is consumed without being tokenised as individual keywords
    - Single-quoted string literals (for any expressions that may appear in the `WHEN` clause)
    - Numeric literals (integer and decimal, for literals that may appear in `WHEN` clause predicates)
    - Parentheses, comma, semicolon, dot, and common comparison operator punctuation tokens (`=`, `<>`, `<`, `>`, `<=`, `>=`)

- **FR-3** Implement an `.hdbtrigger` parser (`src/parsers/hdbtrigger/parser.ts`) using Chevrotain's `CstParser`. The grammar must cover:
    - `triggerStatement` — top-level rule: `[CREATE] TRIGGER <triggerName> <triggerTiming> <triggerEvent> ON <tableName> [<referencingClause>] [<forEachClause>] [<whenClause>] <triggerBody> [;]`
    - `triggerName` — a single identifier or a schema-qualified identifier (`<schema> . <name>`); both quoted and unquoted forms are supported; the schema qualifier (if present) is consumed but not included in the extracted name
    - `triggerTiming` — any one of: `BEFORE`, `AFTER`, `INSTEAD OF`
    - `triggerEvent` — any one of: `INSERT`, `DELETE`, `UPDATE [OF <columnList>]`; the `columnList` rule consumes a comma-separated list of identifiers (quoted or unquoted) and produces no extracted subjects
    - `tableName` — a single identifier or a schema-qualified identifier (`<schema> . <name>`); consumed but not extracted
    - `referencingClause` — `REFERENCING { OLD ROW AS <alias> | NEW ROW AS <alias> | OLD TABLE AS <alias> | NEW TABLE AS <alias> }+`; consumed but not extracted
    - `forEachClause` — `FOR EACH { ROW | STATEMENT }`; consumed but not extracted
    - `whenClause` — `WHEN ( <expression> )`; the parenthesised expression is consumed as a sequence of any tokens until the matching closing parenthesis; not extracted
    - `triggerBody` — matches the `TriggerBody` token (a single opaque `BEGIN ... END` block); not extracted
    - Error recovery: use Chevrotain's built-in single-token deletion/insertion recovery so that partial parses still return any trigger name extracted from the portions that did parse

- **FR-4** Implement a CST visitor (`src/parsers/hdbtrigger/visitor.ts`) that:
    - Navigates to the `triggerName` CST node
    - Extracts the local name token (the second identifier token when a schema qualifier is present; the first otherwise)
    - Strips surrounding double-quotes from the extracted token image
    - Returns a single `ExtractedSubject` with `{ type: 'triggerName', name }` (or an empty array if the `triggerName` node is absent due to a parse error)

- **FR-5** Implement a public extractor function `extractTriggerName(fileContent: string): ExtractedSubject[]` in `src/parsers/hdbtrigger/index.ts`. This function:
    - Tokenises the input using the `.hdbtrigger` lexer
    - Runs the parser
    - Visits the resulting CST via the `HdbTriggerNameVisitor`
    - Returns an array of `ExtractedSubject` objects with `type: 'triggerName'`
    - If the lexer or parser reports errors, returns whatever name could be extracted from the partial tree; does not throw

- **FR-6** Extend `extractSubjects()` in `src/content-lint.ts` to handle `.hdbtrigger` files: add a branch `if (extension === '.hdbtrigger') return extractTriggerName(fileContent)` and add the corresponding import statement.

- **FR-7** Extend the `ContentTarget` union type in `src/types/rules.ts` to include the new value `'triggerName'`.

- **FR-8** Extend the `subjectType` union in the `LintIssue` type in `src/types/issues.ts` to include the new value `'triggerName'`.

- **FR-9** The `extractTriggerName` function must handle both CRLF and LF line endings.

- **FR-10** The existing `ExtractedSubject` type and the rest of the `lintFileContent` pipeline must remain unchanged beyond the two type union extensions described in FR-7 and FR-8; the new parser is otherwise additive only.

### Non-Functional Requirements

- **NFR-1** No new production dependencies are required; the feature uses the `chevrotain` package already declared as a `dependencies` entry.

- **NFR-2** No native binaries or build-step code generation. The parser is defined in TypeScript source files that compile with `npm run build` (`tsc`).

- **NFR-3** The lexer and parser must be instantiated **once** at module load time (not per-file), per Chevrotain best practices, to avoid re-parsing the grammar on every lint invocation.

- **NFR-4** Parsing a single `.hdbtrigger` file must complete in under 100 ms on commodity hardware for files up to 2,000 lines.

- **NFR-5** The introduction of the `.hdbtrigger` parser must not alter the public API of `src/index.ts` or `src/lint.ts`.

- **NFR-6** The parser module must be independently unit-testable: given a string of `.hdbtrigger` DDL, `extractTriggerName()` returns the expected `ExtractedSubject[]` array.

---

## 6. Acceptance Criteria

### AC-1 — Basic trigger name extraction

**Given** an `.hdbtrigger` file: `CREATE TRIGGER TRG_AI_MY_TABLE AFTER INSERT ON "MY_TABLE" FOR EACH ROW BEGIN END`,  
**When** `extractTriggerName()` is called,  
**Then** it returns exactly `[{ type: 'triggerName', name: 'TRG_AI_MY_TABLE' }]`.

### AC-2 — Quoted trigger name normalisation

**Given** an `.hdbtrigger` file with a quoted trigger name: `CREATE TRIGGER "TRG_AI_MY_TABLE" AFTER INSERT ON "MY_TABLE" FOR EACH ROW BEGIN END`,  
**When** `extractTriggerName()` is called,  
**Then** it returns exactly `[{ type: 'triggerName', name: 'TRG_AI_MY_TABLE' }]` (double-quotes stripped).

### AC-3 — Schema-qualified trigger name

**Given** an `.hdbtrigger` file with a schema-qualified trigger name: `CREATE TRIGGER "MY_SCHEMA"."TRG_AI_MY_TABLE" AFTER INSERT ON "MY_TABLE" FOR EACH ROW BEGIN END`,  
**When** `extractTriggerName()` is called,  
**Then** it returns exactly `[{ type: 'triggerName', name: 'TRG_AI_MY_TABLE' }]` (schema qualifier not included).

### AC-4 — Optional `CREATE` keyword absent

**Given** an `.hdbtrigger` file that begins with `TRIGGER TRG_AI_MY_TABLE AFTER INSERT ON "MY_TABLE" FOR EACH ROW BEGIN END` (no `CREATE` keyword),  
**When** `extractTriggerName()` is called,  
**Then** it returns exactly `[{ type: 'triggerName', name: 'TRG_AI_MY_TABLE' }]`, identical to the same file with `CREATE TRIGGER`.

### AC-5 — `BEFORE` timing keyword

**Given** an `.hdbtrigger` file using the `BEFORE` timing: `CREATE TRIGGER "TRG_BI_T" BEFORE INSERT ON "T" FOR EACH ROW BEGIN END`,  
**When** `extractTriggerName()` is called,  
**Then** it returns `[{ type: 'triggerName', name: 'TRG_BI_T' }]` with no error.

### AC-6 — `INSTEAD OF` timing keyword

**Given** an `.hdbtrigger` file using the `INSTEAD OF` timing: `CREATE TRIGGER "TRG_IO_V" INSTEAD OF INSERT ON "V" FOR EACH ROW BEGIN END`,  
**When** `extractTriggerName()` is called,  
**Then** it returns `[{ type: 'triggerName', name: 'TRG_IO_V' }]` with no error.

### AC-7 — `UPDATE OF` column list excluded

**Given** an `.hdbtrigger` file with an `UPDATE OF` event: `CREATE TRIGGER TRG_AU_T AFTER UPDATE OF COL1, COL2 ON "T" FOR EACH ROW BEGIN END`,  
**When** `extractTriggerName()` is called,  
**Then** the result contains only `[{ type: 'triggerName', name: 'TRG_AU_T' }]` and `COL1`, `COL2` are **not** present.

### AC-8 — `REFERENCING` clause excluded

**Given** an `.hdbtrigger` file with a `REFERENCING` clause: `CREATE TRIGGER TRG_AI_T AFTER INSERT ON "T" REFERENCING NEW ROW AS NEW_ROW FOR EACH ROW BEGIN END`,  
**When** `extractTriggerName()` is called,  
**Then** the result contains only `[{ type: 'triggerName', name: 'TRG_AI_T' }]` and `NEW_ROW` is **not** present.

### AC-9 — `WHEN` clause excluded

**Given** an `.hdbtrigger` file with a `WHEN` clause: `CREATE TRIGGER TRG_AI_T AFTER INSERT ON "T" FOR EACH ROW WHEN (NEW."STATUS" = 'ACTIVE') BEGIN END`,  
**When** `extractTriggerName()` is called,  
**Then** it returns `[{ type: 'triggerName', name: 'TRG_AI_T' }]` with no error and no extraction from the predicate.

### AC-10 — Trigger body excluded

**Given** an `.hdbtrigger` file whose body contains SQLScript that references `TRIGGER`, `INSERT`, and `ON` keywords: `CREATE TRIGGER TRG_AI_T AFTER INSERT ON "T" FOR EACH ROW BEGIN INSERT INTO "AUDIT" VALUES ('INSERT triggered'); END`,  
**When** `extractTriggerName()` is called,  
**Then** it returns only `[{ type: 'triggerName', name: 'TRG_AI_T' }]`; no identifiers from the body are included.

### AC-11 — Block comment exclusion

**Given** an `.hdbtrigger` file where a declaration element is wrapped in `/* ... */`,  
**When** `extractTriggerName()` is called,  
**Then** any identifier inside the comment is **not** present in the result.

### AC-12 — Line comment exclusion

**Given** an `.hdbtrigger` file where a line is prefixed with `-- OLD: CREATE TRIGGER TRG_OLD ...`,  
**When** `extractTriggerName()` is called,  
**Then** `TRG_OLD` is **not** present in the result.

### AC-13 — `FOR EACH STATEMENT` granularity

**Given** an `.hdbtrigger` file using `FOR EACH STATEMENT`: `CREATE TRIGGER TRG_AI_T AFTER INSERT ON "T" FOR EACH STATEMENT BEGIN END`,  
**When** `extractTriggerName()` is called,  
**Then** it returns `[{ type: 'triggerName', name: 'TRG_AI_T' }]` with no error.

### AC-14 — Optional trailing semicolon

**Given** an `.hdbtrigger` file that ends with `END;` vs. one that ends with `END` (no semicolon),  
**When** `extractTriggerName()` is called on each,  
**Then** both return the same trigger name result with no error.

### AC-15 — Graceful error on unparseable file

**Given** an `.hdbtrigger` file with invalid or unsupported syntax,  
**When** `extractTriggerName()` is called,  
**Then** it does **not** throw an exception; it returns any name extractable from parseable portions and completes normally.

### AC-16 — Integration with `lintFileContent`

**Given** an `.hdbtrigger` file whose trigger name violates a configured `contentRuleSet` rule,  
**When** `lintFileContent()` is called,  
**Then** one `LintIssue` is returned with `subjectType: 'triggerName'` and the correct `subjectName`.

### AC-17 — Build integrity

**Given** the updated codebase,  
**When** `npm run build` is executed,  
**Then** it completes with zero TypeScript compilation errors.

---

## 7. Out of Scope

- Parsers for other `.hdb*` artifact types not already covered — separate features.
- Full SQL semantic validation of the trigger body (e.g., referential integrity, data-type consistency) — the linter validates naming conventions only.
- Extraction of the target table name from the `ON <tableName>` clause — teams enforce trigger naming conventions, not table references.
- Extraction of correlation-name aliases from the `REFERENCING` clause — these are internal to the trigger body and not subject to the same naming policies as the trigger itself.
- Extraction of column names from the `UPDATE OF <column_list>` event modifier — the linter validates trigger names only.
- Auto-fix / code-rewriting capabilities.
- Support for the `.hdbcds` CDS (Core Data Services) format — structurally different from DDL files.
- Parsing compound trigger events (e.g., `INSERT OR UPDATE OR DELETE`) beyond what is needed for correct token consumption — only the trigger name is extracted.
- A HANA SQL grammar covering `INSERT`, `UPDATE`, `DELETE` DML statements inside the trigger body — the body is consumed as an opaque token.
