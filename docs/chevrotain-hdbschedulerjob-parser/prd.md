# PRD: Chevrotain Lexer/Parser for `.hdbschedulerjob` Job Action Extraction

## 1. Feature Name

**Chevrotain `.hdbschedulerjob` Job Action Extractor**

---

## 2. Goal

### Problem

The current `extractSubjects()` function in `src/content-lint.ts` has no handler for `.hdbschedulerjob` files. When a user configures `contentRuleSets` targeting `.hdbschedulerjob` job actions, the linter silently returns an empty result — no action names are extracted, no lint issues are raised, and the user receives no indication that content-level linting is unsupported for this artifact type.

The structure of an `.hdbschedulerjob` file, while superficially resembling plain JSON, introduces parsing challenges that make both a simple regex approach and a standard `JSON.parse()` call unreliable:

- **C-style comments** — SAP HANA tooling and HDI authoring conventions allow `//` single-line comments and `/* … */` block comments inside `.hdbschedulerjob` files. Standard `JSON.parse()` rejects any comment token, causing a hard parse failure and leaving the linter with no extracted names at all. A regex scanning the raw text risks matching comment content as if it were live JSON.
- **Fully-qualified action names** — The `action` field contains a fully-qualified procedure or function reference, which typically uses the HDI package-path notation with a `::` separator (e.g., `"com.example.myapp::runMaintenance"`) or a schema-qualified SQL name (e.g., `"MY_SCHEMA"."MY_PROCEDURE"`). Extracting the local name or the full path for rule evaluation requires structured tokenisation.
- **Trailing commas** — Some HANA project tooling generates trailing commas in JSON objects and arrays. Standard `JSON.parse()` rejects trailing commas; a Chevrotain grammar can tolerate them explicitly and still extract the `action` value.
- **Nested `schedules` array** — The file contains a `schedules` array of objects, each with its own `description`, `xscron`, `parameter`, and `status` keys. A line-by-line regex risks confusing the string values in nested schedule objects with the top-level `action` value.
- **String escape sequences and Unicode** — JSON string values may contain `\"`, `\\`, `\uXXXX` escapes. A naive regex that looks for `"action"\s*:\s*"(.*?)"` breaks on escaped quotes inside the action string.
- **Optional semicolon / BOM** — Files produced by some tooling include a UTF-8 BOM or a trailing newline-only token that a strict parser must tolerate without error.

These failure modes mean that teams enforcing naming conventions on scheduled job actions currently receive no feedback from the linter at all.

### Solution

Implement a Chevrotain-based lexer and parser for `.hdbschedulerjob` files under `src/parsers/hdbschedulerjob/`, following the same architectural patterns established by the existing `.hdbtable`, `.hdbview`, `.hdbprocedure`, `.hdbfunction`, `.hdbtabletype`, `.hdbrole`, `.hdbcalculationview`, and `.hdbsequence` parsers. The parser tokenises the file, locates the top-level `"action"` key–value pair, and produces a CST from which a visitor extracts the action name. Wire the new extractor into `extractSubjects()` in `src/content-lint.ts` and extend the `ContentTarget` union type in `src/types/rules.ts` with the new `'jobAction'` value.

### Impact

- Enables content-level naming-convention rules for `.hdbschedulerjob` job action references, a previously unsupported artifact type.
- Eliminates the silent no-op that currently affects teams who configure `contentRuleSets` for `.hdbschedulerjob`.
- Extends the `ContentTarget` type with the semantically precise value `jobAction`, aligning with how teams express scheduled-job action naming policies.
- Reuses and validates the parser infrastructure across a ninth HANA artifact type, further reinforcing its conventions and reducing the cost of any future artifact parsers.

---

## 3. User Personas

**HANA Developer / CAP Developer**
A developer working on an SAP CAP or native HANA project who defines `.hdbschedulerjob` files to schedule recurring stored-procedure invocations (e.g., nightly data aggregation, daily cleanup routines). They configure `hana-linter` to enforce naming conventions on the procedure referenced in the `action` field (e.g., the local name must end with `_JOB` or follow a project-specific prefix). They run the linter locally and in CI. False positives block PRs unnecessarily; false negatives allow convention violations to ship.

**Governance / Platform Engineer**
An engineer responsible for ensuring that all scheduled jobs in a HANA project invoke procedures that reside in approved packages or schemas. They use `contentRuleSets` with `target: "jobAction"` and regex patterns to allow only known package paths (e.g., `^com\\.myorg\\.`). They rely on the linter to flag jobs that point to ad-hoc or deprecated procedure paths.

**Tooling / Platform Engineer**
An engineer who maintains or extends `hana-linter` for their team or organisation. They need the `.hdbschedulerjob` parser to follow the same structural conventions as the existing parsers so that the codebase remains uniform and future artifact parsers are straightforward to add.

---

## 4. User Stories

### Primary path

- **US-1**: As a HANA Developer, I want the linter to extract the action reference from an `.hdbschedulerjob` file as a `jobAction` subject, so that naming-convention rules can be applied to the procedure or function the job invokes.

- **US-2**: As a HANA Developer, I want `//` single-line comments and `/* … */` block comments inside `.hdbschedulerjob` files to be completely ignored during extraction, so that commented-out action values never trigger lint warnings.

- **US-3**: As a HANA Developer, I want nested schedule objects inside the `schedules` array to be consumed without error and entirely ignored during action extraction, so that string values within schedule entries do not produce false extractions.

### Edge cases

- **US-4**: As a HANA Developer, I want a package-path–qualified action (`"com.example.myapp::runMaintenance"`) to be extracted in full as the `jobAction` value, so that regex rules can match on the package prefix, the `::` separator, or the local procedure name independently.

- **US-5**: As a HANA Developer, I want a plain (unqualified) action name (`"MY_PROCEDURE"`) to be extracted without error as the `jobAction` value, so that simpler project structures that omit the package path are fully supported.

- **US-6**: As a Governance Engineer, I want a schema-qualified SQL action name (`"MY_SCHEMA"."MY_PROCEDURE"`) to be tokenised and extracted as a single `jobAction` value (preserving the full string), so that schema-based naming rules can be applied.

- **US-7**: As a HANA Developer, I want a trailing comma after the last key–value pair in the top-level JSON object to be accepted without error, so that files produced by lenient tooling are parsed gracefully.

- **US-8**: As a HANA Developer, I want a file with no `action` key to produce an empty `ExtractedSubject[]` array rather than an error or crash, so that malformed or partial files do not block the lint pipeline.

- **US-9**: As a Tooling Engineer, I want the Chevrotain parser to emit structured parse errors (not throw unhandled exceptions) when it encounters unrecognised syntax, so that the linter degrades gracefully and reports a clear diagnostic instead of crashing.

- **US-10**: As a Tooling Engineer, I want the parser layer to expose a stable TypeScript interface (`extractSchedulerJobAction(fileContent: string): ExtractedSubject[]`) so that `content-lint.ts` is not coupled to Chevrotain internals and future parser upgrades are isolated.

---

## 5. Requirements

### Functional Requirements

- **FR-1** Create a dedicated parser sub-module at `src/parsers/hdbschedulerjob/` containing `lexer.ts`, `parser.ts`, `visitor.ts`, and `index.ts`, following the same file-structure conventions as the existing HANA artifact parser modules.

- **FR-2** Implement an `.hdbschedulerjob` lexer (`src/parsers/hdbschedulerjob/lexer.ts`) using Chevrotain's `createToken` and `Lexer` APIs. The lexer must define tokens for, at minimum:
    - Skip tokens: block comment (`/* … */`), single-line comment (`// …` up to end of line), whitespace — all in `Lexer.SKIPPED` group
    - JSON structural punctuation: `{`, `}`, `[`, `]`, `:`, `,`
    - JSON value keywords: `true`, `false`, `null`
    - A `JsonString` token covering standard JSON string literals (double-quoted, supporting `\"`, `\\`, `\/`, `\b`, `\f`, `\n`, `\r`, `\t`, and `\uXXXX` escape sequences): `"([^"\\]|\\.)*"`
    - A `JsonNumber` token covering integer and decimal number literals (JSON number syntax)
    - A `ActionKey` token that matches the literal `"action"` (including the quotes), declared with a higher priority than `JsonString` so that the `action` key is always identified as a distinct token; this simplifies the parser grammar and prevents ambiguity with arbitrary string values that happen to contain the word `action`

- **FR-3** Implement an `.hdbschedulerjob` parser (`src/parsers/hdbschedulerjob/parser.ts`) using Chevrotain's `CstParser`. The grammar must cover:
    - `schedulerJobDocument` — top-level rule: a JSON object `{ <member>* }`
    - `member` — a single key–value pair: `<JsonString | ActionKey> : <value>`; when the key is the `ActionKey` token, the rule delegates to `actionMember` to capture the value in a dedicated CST node
    - `actionMember` — `ActionKey : <JsonString>` — produces the CST node from which the visitor reads the action name
    - `value` — any JSON value: `JsonString`, `JsonNumber`, `true`, `false`, `null`, or a nested `object` or `array`
    - `object` — `{ <member> (, <member>)* [,] }` — trailing comma is accepted without error
    - `array` — `[ <value> (, <value>)* [,] ]` — trailing comma is accepted without error
    - The grammar must recursively consume nested objects and arrays (e.g., the `schedules` array) so that string values inside nested structures are never mis-identified as the top-level action value
    - Error recovery: use Chevrotain's built-in single-token deletion/insertion recovery so that a partially valid file still yields the action name if the `"action"` key–value pair parsed successfully before the error

- **FR-4** Implement a CST visitor (`src/parsers/hdbschedulerjob/visitor.ts`) that:
    - Walks the `actionMember` node in the CST
    - Reads the `JsonString` token value representing the action
    - Strips the surrounding double-quotes from the extracted string value
    - Pushes `{ type: 'jobAction', name }` onto the result, where `name` is the unquoted action string (e.g., `com.example.myapp::runMaintenance`)
    - Produces at most one `ExtractedSubject` per file (a well-formed `.hdbschedulerjob` has exactly one `action` key)

- **FR-5** Implement a public extractor function `extractSchedulerJobAction(fileContent: string): ExtractedSubject[]` in `src/parsers/hdbschedulerjob/index.ts`. This function:
    - Tokenises the input using the `.hdbschedulerjob` lexer
    - Runs the parser
    - Visits the resulting CST via the visitor from `visitor.ts`
    - Returns an array containing at most one `ExtractedSubject` object with `type: 'jobAction'`
    - If the lexer or parser reports errors, returns whatever could be extracted from the partial tree; does not throw

- **FR-6** Extend the `ContentTarget` union type in `src/types/rules.ts` with the new literal value:

    ```typescript
    export type ContentTarget = 'field' | 'inputParameter' | 'outputParameter' | 'roleName' | 'grantedRoleName' | 'sequenceName' | 'jobAction';
    ```

    Also extend the `subjectType` union in the `LintIssue` or `ExtractedSubject` type in `src/types/issues.ts` to include `'jobAction'`, so that the new subject type flows correctly through the existing lint pipeline.

- **FR-7** Update `extractSubjects()` in `src/content-lint.ts`:
    - Import `extractSchedulerJobAction` from `./parsers/hdbschedulerjob/index`
    - Add a dedicated `if (extension === '.hdbschedulerjob')` branch calling `extractSchedulerJobAction(fileContent)` alongside the existing artifact branches

- **FR-8** The existing `ExtractedSubject` type and the rest of the `lintFileContent` pipeline must remain unchanged except for the additive `'jobAction'` type value; no existing extraction paths are modified.

- **FR-9** The `extractSchedulerJobAction` function must handle both CRLF and LF line endings and must correctly skip a UTF-8 BOM (`\uFEFF`) at the start of the file if present.

### Non-Functional Requirements

- **NFR-1** No new production dependencies are required; the feature uses the `chevrotain` package already declared as a `dependencies` entry.

- **NFR-2** No native binaries or build-step code generation. The parser is defined in TypeScript source files that compile with `npm run build` (`tsc`).

- **NFR-3** The lexer and parser must be instantiated **once** at module load time (not per-file), per Chevrotain best practices, to avoid re-parsing the grammar on every lint invocation.

- **NFR-4** Parsing a single `.hdbschedulerjob` file must complete in under 100 ms on commodity hardware for files up to 200 lines.

- **NFR-5** The introduction of the `.hdbschedulerjob` parser must not alter the public API of `src/index.ts`, `src/lint.ts`, or the `LintIssue` type (beyond the additive `'jobAction'` union member).

- **NFR-6** The parser module must be independently unit-testable: given a string of `.hdbschedulerjob` content, `extractSchedulerJobAction()` returns the expected `ExtractedSubject[]` array.

---

## 6. Acceptance Criteria

### AC-1 — Plain action name extraction

**Given** an `.hdbschedulerjob` file containing:

```json
{
    "description": "Nightly cleanup",
    "action": "MY_PROCEDURE",
    "status": "active",
    "schedules": []
}
```

**When** `extractSchedulerJobAction()` is called,  
**Then** it returns exactly `[{ type: 'jobAction', name: 'MY_PROCEDURE' }]`.

---

### AC-2 — Package-path–qualified action name extraction

**Given** an `.hdbschedulerjob` file containing:

```json
{
    "description": "Nightly cleanup",
    "action": "com.example.myapp::runMaintenance",
    "status": "active",
    "schedules": []
}
```

**When** `extractSchedulerJobAction()` is called,  
**Then** it returns exactly `[{ type: 'jobAction', name: 'com.example.myapp::runMaintenance' }]`.

---

### AC-3 — Schema-qualified SQL action name extraction

**Given** an `.hdbschedulerjob` file containing:

```json
{
    "description": "Archival job",
    "action": "\"MY_SCHEMA\".\"MY_PROCEDURE\"",
    "status": "active",
    "schedules": []
}
```

**When** `extractSchedulerJobAction()` is called,  
**Then** it returns exactly `[{ type: 'jobAction', name: '"MY_SCHEMA"."MY_PROCEDURE"' }]` (outer JSON quotes stripped; embedded double-quotes preserved so that downstream rules can match on them).

---

### AC-4 — `//` single-line comment exclusion

**Given** an `.hdbschedulerjob` file containing:

```json
{
    // "action": "OLD_PROCEDURE",
    "action": "com.example::runJob",
    "status": "active",
    "schedules": []
}
```

**When** `extractSchedulerJobAction()` is called,  
**Then** `OLD_PROCEDURE` is **not** present in the result and only `com.example::runJob` is extracted.

---

### AC-5 — `/* */` block comment exclusion

**Given** an `.hdbschedulerjob` file containing:

```json
{
    /* "action": "DEPRECATED_PROC", */
    "action": "com.example::runJob",
    "status": "active",
    "schedules": []
}
```

**When** `extractSchedulerJobAction()` is called,  
**Then** `DEPRECATED_PROC` is **not** present in the result and only `com.example::runJob` is extracted.

---

### AC-6 — Nested schedule objects are ignored

**Given** an `.hdbschedulerjob` file containing:

```json
{
    "description": "My job",
    "action": "com.example::theAction",
    "locale": "en",
    "status": "active",
    "schedules": [
        {
            "description": "Run daily at midnight",
            "xscron": "* * * * 1 0 0",
            "parameter": "{ \"mode\": \"full\" }",
            "status": "active"
        }
    ]
}
```

**When** `extractSchedulerJobAction()` is called,  
**Then** the result contains exactly `[{ type: 'jobAction', name: 'com.example::theAction' }]` and no strings from within the `schedules` array (e.g., `Run daily at midnight`, `full`, `active`) appear in the result.

---

### AC-7 — Trailing comma tolerance

**Given** an `.hdbschedulerjob` file containing a trailing comma after the last key–value pair:

```json
{
    "description": "My job",
    "action": "com.example::runJob",
    "status": "active"
}
```

**When** `extractSchedulerJobAction()` is called,  
**Then** the parser does not throw and returns `[{ type: 'jobAction', name: 'com.example::runJob' }]`.

---

### AC-8 — Missing `action` key returns empty array

**Given** an `.hdbschedulerjob` file that omits the `action` key:

```json
{
    "description": "Incomplete job",
    "status": "active",
    "schedules": []
}
```

**When** `extractSchedulerJobAction()` is called,  
**Then** it returns `[]` and does not throw.

---

### AC-9 — Malformed JSON degrades gracefully

**Given** an `.hdbschedulerjob` file with a syntax error (e.g., `{ "action": "com.example::runJob" ` — missing closing brace),  
**When** `extractSchedulerJobAction()` is called,  
**Then** the function does not throw; it returns the partial extraction result if the `action` key–value pair was successfully parsed before the error (i.e., `[{ type: 'jobAction', name: 'com.example::runJob' }]`), or `[]` if it was not.

---

### AC-10 — CRLF line endings supported

**Given** an `.hdbschedulerjob` file whose line endings are `\r\n` (Windows CRLF) and whose `action` is `"com.example::runJob"`,  
**When** `extractSchedulerJobAction()` is called,  
**Then** it returns exactly `[{ type: 'jobAction', name: 'com.example::runJob' }]` without error.

---

### AC-11 — UTF-8 BOM is tolerated

**Given** an `.hdbschedulerjob` file that begins with a UTF-8 BOM (`\uFEFF`) followed by valid JSON with `"action": "com.example::runJob"`,  
**When** `extractSchedulerJobAction()` is called,  
**Then** it returns exactly `[{ type: 'jobAction', name: 'com.example::runJob' }]` without error.

---

### AC-12 — `ContentTarget` type is extended

**Given** the updated `src/types/rules.ts`,  
**When** a developer configures a `contentRuleSet` with `target: "jobAction"`,  
**Then** the TypeScript compiler accepts the configuration without a type error and the lint pipeline routes the extracted `jobAction` subjects through the rule evaluation logic correctly.

---

### AC-13 — Lint pipeline integration

**Given** an `.hdbschedulerjob` file whose `action` is `"com.example::myJob"` and a `contentRuleSet` configured as:

```json
{
    "extension": ".hdbschedulerjob",
    "target": "jobAction",
    "groups": {
        "all": [{ "description": "Must end with Job", "pattern": "Job$" }]
    }
}
```

**When** `lintFileContent()` is called,  
**Then** no lint issue is raised (the action ends with `Job`).

**Given** the same configuration but an `action` of `"com.example::runMaintenance"`,  
**When** `lintFileContent()` is called,  
**Then** exactly one lint issue is raised for the `jobAction` subject `runMaintenance` (or the full action string, depending on the configured pattern), referencing the correct file path.

---

## 7. Out of Scope

- **Schedule field extraction** — The `description`, `xscron`, `parameter`, and `status` fields within the `schedules` array are not extracted and not exposed as `ContentTarget` subjects. Scheduling configuration is considered operational metadata, not a naming-convention concern.
- **Top-level `description` field** — The top-level `description` string is free text, not an identifier, and is not extracted.
- **`locale` and `status` field validation** — Validating locale codes or enforcing `"active"` / `"inactive"` enum values is not part of this feature. Such checks belong in a separate structural lint rule.
- **Multiple `action` keys** — A well-formed `.hdbschedulerjob` file has exactly one `action` key. The parser extracts only the first `action` key encountered; duplicate keys (which are invalid per the JSON specification) are out of scope.
- **Action parameter validation** — Validating the contents of `schedules[].parameter` (a JSON string containing runtime arguments) is not part of this feature.
- **Automatic fix / auto-correct** — The linter reports violations but does not modify `.hdbschedulerjob` files.
- **`.xsjob` (XS Classic) support** — The XS Classic job scheduler format (`.xsjob`) is a distinct artifact type and is not covered by this feature.
- **`hdbschedulerjob` structural linting** — Validating that required keys (`action`, `schedules`) are present or that `xscron` expressions are syntactically valid is outside the scope of content-level naming linting and belongs to a future structural lint rule feature.
