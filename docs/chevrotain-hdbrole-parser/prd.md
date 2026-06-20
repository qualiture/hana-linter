# PRD: Chevrotain Lexer/Parser for `.hdbrole` Role Name Extraction

## 1. Feature Name

**Chevrotain `.hdbrole` Role & Granted-Role Name Extractor**

---

## 2. Goal

### Problem

The current `extractSubjects()` function in `src/content-lint.ts` has no handler for `.hdbrole` files. When a user configures `contentRuleSets` targeting `.hdbrole` role names, the linter silently returns an empty result — no names are extracted, no lint issues are raised, and the user receives no indication that content-level linting is unsupported for this artifact type.

The structure of an `.hdbrole` file introduces parsing challenges that make a simple regex approach unreliable:

- **Fully-qualified role names** — Role names are typically package-qualified identifiers using a `::` separator (e.g., `com.example.myapp::AdminRole`). The package path uses `.` as a delimiter, and the `::` separator must be treated as a single token boundary; naive identifier regexes will split these into fragments.
- **`extends roles` block** — A role may inherit from one or more other roles listed inside curly braces. The opening `{` of the extends list and the opening `{` of the privilege body are syntactically distinct and must not be confused.
- **Block and line comments** — Developers comment out individual privilege grants or entire `extends roles` blocks; these must be excluded from extraction.
- **Multiple privilege clause types** — Catalog schema, catalog SQL-object, catalog package, and application-privilege grants all share a similar structure (keyword `catalog` or `application` followed by a privilege target and a colon-separated privilege list). Naive scanning produces false positives if only keywords are matched.
- **Schema-qualified object references** — Object references inside catalog privilege clauses use `"SCHEMA"."OBJECT"` notation; the dot and double-quotes must not be mistaken for role-name delimiters.
- **Optional semicolon terminators** — Some authoring tools omit the trailing `;` from individual privilege clauses; the parser must tolerate both forms.

### Solution

Implement a Chevrotain-based lexer and parser for `.hdbrole` files under `src/parsers/hdbrole/`, following the same architectural patterns established by the `.hdbtable`, `.hdbview`, `.hdbprocedure`, `.hdbfunction`, and `.hdbtabletype` parsers. The parser produces a CST from which a visitor extracts:

1. The **role name** being defined (the identifier that follows the `role` keyword) as a `roleName` subject.
2. Each **granted role name** listed in the `extends roles { ... }` block as a `grantedRoleName` subject.

Wire the new extractor into `extractSubjects()` in `src/content-lint.ts` and extend the `ContentTarget` union type in `src/types/rules.ts` with the two new target values.

### Impact

- Enables content-level naming-convention rules for `.hdbrole` role names and inherited role references, a previously unsupported artifact type.
- Eliminates the silent no-op that currently affects teams who configure `contentRuleSets` for `.hdbrole`.
- Extends the `ContentTarget` type with two semantically precise values (`roleName`, `grantedRoleName`) that align with how teams express role naming policies.
- Reuses and validates the parser infrastructure introduced by prior `.hdb*` features, reinforcing its conventions.

---

## 3. User Personas

**HANA Developer / CAP Developer**
A developer who creates `.hdbrole` files to define application-level security roles in SAP HANA XS Classic or HDI. They configure `hana-linter` to enforce naming conventions on role names (e.g., local name after `::` must be PascalCase, or the full qualified name must end in `Role`). They expect lint results for roles to be as reliable as those for tables or procedures.

**Security / Governance Engineer**
An engineer responsible for enforcing a role-naming standard across a large HANA development project. They may also want to ensure that only roles from approved packages are extended (`grantedRoleName` rules), making `grantedRoleName` extraction a first-class requirement alongside the role name itself.

**Tooling / Platform Engineer**
An engineer who maintains or extends `hana-linter`. They need the `.hdbrole` parser to follow the same structural conventions as the existing parsers so that the codebase remains uniform and new artifact parsers are straightforward to add.

---

## 4. User Stories

### Primary path

- **US-1**: As a HANA Developer, I want the linter to extract the name of the role defined in an `.hdbrole` file as a `roleName` subject, so that naming-convention rules can be applied to the role's own name.

- **US-2**: As a HANA Developer, I want each role listed in the `extends roles { ... }` block to be extracted as a `grantedRoleName` subject, so that naming-convention rules (or package-origin rules) can be applied to each inherited role reference.

- **US-3**: As a HANA Developer, I want inline `/* block comments */` and `-- line comments` inside `.hdbrole` files to be completely ignored during extraction, so that commented-out role or privilege references never trigger lint warnings.

- **US-4**: As a HANA Developer, I want privilege clauses (`catalog schema`, `catalog sql object`, `catalog package`, `application privilege`) to be parsed without error and entirely ignored during name extraction, so that only role identifiers are validated against naming rules.

### Edge cases

- **US-5**: As a HANA Developer, I want a fully-qualified role name (`com.example.myapp::AdminRole`) to be extracted as a single `roleName` value (e.g., `com.example.myapp::AdminRole`), preserving the full qualified form so that regex rules can match on the package path, the separator, or the local name as required.

- **US-6**: As a HANA Developer, I want a plain (unqualified) role name (`AdminRole`, with no `::` separator) to be extracted as a `roleName` value without error, so that simple project structures that omit the package prefix are fully supported.

- **US-7**: As a HANA Developer, I want both quoted (`"AdminRole"`) and unquoted (`AdminRole`) role identifiers to be extracted and normalised (double-quotes stripped), so that mixed-quoting conventions are linted without error.

- **US-8**: As a HANA Developer, I want an `.hdbrole` file with no `extends roles` block to produce exactly one `roleName` subject and zero `grantedRoleName` subjects, so that a role with no inheritance is linted correctly.

- **US-9**: As a HANA Developer, I want an `.hdbrole` file with multiple roles in the `extends roles` block to produce exactly one `roleName` subject and one `grantedRoleName` subject per inherited role, so that every inherited role is independently checked against naming rules.

- **US-10**: As a Security Engineer, I want the `grantedRoleName` extraction to preserve the fully-qualified form of each inherited role name (e.g., `com.sap.security::BaseRole`), so that regex rules can enforce package-origin constraints on role inheritance.

- **US-11**: As a Tooling Engineer, I want the Chevrotain parser to emit structured parse errors (not throw unhandled exceptions) when it encounters unrecognised syntax, so that the linter degrades gracefully and reports a clear diagnostic instead of crashing.

- **US-12**: As a Tooling Engineer, I want the parser layer to expose a stable TypeScript interface (`extractRoleNames(fileContent: string): ExtractedSubject[]`) so that `content-lint.ts` is not coupled to Chevrotain internals and future parser upgrades are isolated.

---

## 5. Requirements

### Functional Requirements

- **FR-1** Create a dedicated parser sub-module at `src/parsers/hdbrole/` containing `lexer.ts`, `parser.ts`, `visitor.ts`, and `index.ts`, following the same file-structure conventions as `src/parsers/hdbtable/`, `src/parsers/hdbview/`, `src/parsers/hdbprocedure/`, `src/parsers/hdbfunction/`, and `src/parsers/hdbtabletype/`.

- **FR-2** Extend the `ContentTarget` union type in `src/types/rules.ts` with two new literal values:

    ```typescript
    export type ContentTarget = 'field' | 'inputParameter' | 'outputParameter' | 'roleName' | 'grantedRoleName';
    ```

    Also extend the `subjectType` union in the `LintIssue` type in `src/types/issues.ts` to include `'roleName'` and `'grantedRoleName'`.

- **FR-3** Implement an `.hdbrole` lexer (`src/parsers/hdbrole/lexer.ts`) using Chevrotain's `createToken` and `Lexer` APIs. The lexer must define tokens for, at minimum:
    - Skip tokens: block comment (`/* ... */`), line comment (`-- ...\n`), whitespace — all in `Lexer.SKIPPED` group
    - Role DSL keywords: `ROLE`, `EXTENDS`, `ROLES`, `CATALOG`, `SCHEMA`, `SQL`, `OBJECT`, `PACKAGE`, `APPLICATION`, `PRIVILEGE`, `READ`, `ONLY`, `CHECK`, `OPTION`
    - Privilege keywords (consumed and ignored during extraction): `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `EXECUTE`, `CREATE`, `ALTER`, `DROP`, `INDEX`, `TRIGGER`, `REFERENCES`, `DEBUG`, `ANY`
    - An `Identifier` token covering unquoted identifiers (`[A-Za-z_][A-Za-z0-9_]*`); all keyword tokens must declare `longer_alt: Identifier` so that identifiers that begin with a keyword substring are not incorrectly split
    - A `QuotedIdentifier` token covering double-quoted identifiers (`"[^"]*"`)
    - A `PackageQualifiedName` token (or composite rule) that matches a package-qualified role name of the form `<segment>('.'<segment>)*'::'<localName>` — this may be implemented either as a single high-priority token or as a parser-level composition of `Identifier`, `Dot`, `ColonColon`, and `Identifier` tokens
    - Punctuation tokens: `{`, `}`, `(`, `)`, `,`, `;`, `.`, `::`
    - A `Colon` token (`:`) for the privilege clause separator, distinct from `::` — the `::` token must take priority over two consecutive `Colon` tokens

- **FR-4** Implement an `.hdbrole` parser (`src/parsers/hdbrole/parser.ts`) using Chevrotain's `CstParser`. The grammar must cover:
    - `roleDefinition` — top-level rule: `ROLE <roleName> [EXTENDS ROLES '{' <grantedRoleList> '}'] '{' {<privilegeClause>} '}'`
    - `roleName` — a package-qualified name (`<pkg.path>::<LocalName>`) or a plain identifier or quoted identifier
    - `grantedRoleList` — one or more `grantedRoleName` entries separated by commas; each entry is a package-qualified name, plain identifier, or quoted identifier
    - `privilegeClause` — one of:
        - `catalogSchemaPrivilege`: `CATALOG SCHEMA <quotedOrUnquotedIdentifier> ':' <privilegeList> [';']`
        - `catalogObjectPrivilege`: `CATALOG SQL OBJECT <quotedOrUnquotedIdentifier> '.' <quotedOrUnquotedIdentifier> ':' <privilegeList> [';']`
        - `catalogPackagePrivilege`: `CATALOG PACKAGE <quotedOrUnquotedIdentifier> ':' <privilegeList> [';']`
        - `applicationPrivilege`: `APPLICATION PRIVILEGE ':' <roleName> [';']`
    - `privilegeList` — one or more privilege keyword tokens separated by commas; consumed but not extracted
    - Error recovery: use Chevrotain's built-in single-token deletion/insertion recovery so partial parses still return the role name from the portions that did parse

- **FR-5** Implement a CST visitor (`src/parsers/hdbrole/visitor.ts`) that:
    - Collects the identifier from the `roleName` node at the top level and stores it as `{ type: 'roleName', name }`, with double-quotes stripped if the name was quoted
    - For each entry in the `grantedRoleList` node, collects the identifier and stores it as `{ type: 'grantedRoleName', name }`, with double-quotes stripped
    - Ignores all `privilegeClause` nodes entirely — no identifiers are extracted from privilege body content

- **FR-6** Implement a public extractor function `extractRoleNames(fileContent: string): ExtractedSubject[]` in `src/parsers/hdbrole/index.ts`. This function:
    - Tokenises the input using the `.hdbrole` lexer
    - Runs the parser
    - Visits the resulting CST via the `HdbRoleNameVisitor`
    - Returns an array of `ExtractedSubject` objects; the first element has `type: 'roleName'`, followed by zero or more elements with `type: 'grantedRoleName'`
    - If the lexer or parser reports errors, returns whatever names could be extracted from the partial tree; does not throw

- **FR-7** Extend `extractSubjects()` in `src/content-lint.ts` to handle `.hdbrole` files: add a branch `if (extension === '.hdbrole') return extractRoleNames(fileContent)`.

- **FR-8** The existing `ExtractedSubject`, `LintIssue`, and `ContentRuleSet` types must remain backward-compatible; the type-union extensions in FR-2 are purely additive.

- **FR-9** The `extractRoleNames` function must handle both CRLF and LF line endings.

- **FR-10** The fully-qualified role name (package path + `::` + local name) must be stored as a single `name` string (e.g., `com.example.myapp::AdminRole`), not split into parts, so that regex rules may match on any portion of the qualified name.

### Non-Functional Requirements

- **NFR-1** No new production dependencies are required; the feature uses the `chevrotain` package already declared as a `dependencies` entry.

- **NFR-2** No native binaries or build-step code generation. The parser is defined in TypeScript source files that compile with `npm run build` (`tsc`).

- **NFR-3** The lexer and parser must be instantiated **once** at module load time (not per-file), per Chevrotain best practices, to avoid re-parsing the grammar on every lint invocation.

- **NFR-4** Parsing a single `.hdbrole` file must complete in under 50 ms on commodity hardware for files up to 1,000 lines.

- **NFR-5** The introduction of the `.hdbrole` parser must not alter the public API of `src/index.ts` or `src/lint.ts` beyond the additive `ContentTarget` union extension.

- **NFR-6** The parser module must be independently unit-testable: given a string of `.hdbrole` DSL content, `extractRoleNames()` returns the expected `ExtractedSubject[]` array.

---

## 6. Acceptance Criteria

### AC-1 — Role name extraction (unqualified)

**Given** an `.hdbrole` file with content `role AdminRole { }`,  
**When** `extractRoleNames()` is called,  
**Then** it returns exactly `[{ type: 'roleName', name: 'AdminRole' }]`.

### AC-2 — Role name extraction (fully-qualified)

**Given** an `.hdbrole` file with content `role com.example.app::AdminRole { }`,  
**When** `extractRoleNames()` is called,  
**Then** it returns exactly `[{ type: 'roleName', name: 'com.example.app::AdminRole' }]`.

### AC-3 — Quoted role name normalisation

**Given** an `.hdbrole` file with content `role "AdminRole" { }`,  
**When** `extractRoleNames()` is called,  
**Then** it returns exactly `[{ type: 'roleName', name: 'AdminRole' }]` (double-quotes stripped).

### AC-4 — Granted role extraction (single)

**Given** an `.hdbrole` file:

```
role com.example.app::AdminRole
    extends roles { com.example.app::BaseRole }
{ }
```

**When** `extractRoleNames()` is called,  
**Then** it returns `[{ type: 'roleName', name: 'com.example.app::AdminRole' }, { type: 'grantedRoleName', name: 'com.example.app::BaseRole' }]`.

### AC-5 — Granted role extraction (multiple)

**Given** an `.hdbrole` file with `extends roles { com.example.app::BaseRole, com.example.app::AuditRole }`,  
**When** `extractRoleNames()` is called,  
**Then** the result contains exactly one `roleName` subject and two `grantedRoleName` subjects — one per inherited role.

### AC-6 — No `extends roles` block

**Given** an `.hdbrole` file with no `extends roles` block,  
**When** `extractRoleNames()` is called,  
**Then** the result contains exactly one `roleName` subject and zero `grantedRoleName` subjects.

### AC-7 — Privilege clauses not extracted

**Given** an `.hdbrole` file with multiple privilege clauses:

```
role com.example.app::AdminRole {
    catalog schema "MY_SCHEMA": SELECT, INSERT, UPDATE, DELETE;
    application privilege: com.example.app::EditData;
}
```

**When** `extractRoleNames()` is called,  
**Then** `MY_SCHEMA`, `EditData`, `SELECT`, `INSERT`, `UPDATE`, and `DELETE` are **not** present in the result.

### AC-8 — Block comment exclusion

**Given** an `.hdbrole` file where a role reference inside `extends roles` is wrapped in `/* ... */`,  
**When** `extractRoleNames()` is called,  
**Then** the commented-out role name is **not** present in the result.

### AC-9 — Line comment exclusion

**Given** an `.hdbrole` file where a line inside `extends roles { ... }` is prefixed with `-- com.example.app::OldRole`,  
**When** `extractRoleNames()` is called,  
**Then** `com.example.app::OldRole` is **not** present in the result.

### AC-10 — Fully-qualified granted role name preserved

**Given** an `.hdbrole` file with `extends roles { com.sap.security::BaseRole }`,  
**When** `extractRoleNames()` is called,  
**Then** the result contains `{ type: 'grantedRoleName', name: 'com.sap.security::BaseRole' }` with the full qualified name intact.

### AC-11 — Graceful error on unparseable file

**Given** an `.hdbrole` file with invalid or unsupported syntax,  
**When** `extractRoleNames()` is called,  
**Then** it does **not** throw an exception; it returns any names extractable from parseable portions and completes normally.

### AC-12 — Integration with `lintFileContent`

**Given** an `.hdbrole` file whose role name violates a configured `contentRuleSet` rule targeting `roleName`,  
**When** `lintFileContent()` is called,  
**Then** one `LintIssue` is returned with `subjectType: 'roleName'` and the correct `subjectName`.

### AC-13 — Integration with `lintFileContent` for granted roles

**Given** an `.hdbrole` file whose inherited role name violates a configured `contentRuleSet` rule targeting `grantedRoleName`,  
**When** `lintFileContent()` is called,  
**Then** one `LintIssue` per violating inherited role name is returned with `subjectType: 'grantedRoleName'` and the correct `subjectName`.

### AC-14 — Build integrity

**Given** the updated codebase,  
**When** `npm run build` is executed,  
**Then** it completes with zero TypeScript compilation errors.

---

## 7. Out of Scope

- Parsers for any other `.hdb*` artifact type — separate features.
- Extraction of privilege identifiers (schema names, object names, package names, privilege-type keywords) from `catalog` or `application privilege` clauses — the linter validates role naming conventions only.
- Full semantic validation of role definitions (e.g., verifying that referenced schemas or objects exist) — the linter validates naming conventions only.
- Support for the HDI JSON-based `.hdbrole` format used in SAP HANA XS Advanced / Cloud Foundry deployments — this PRD targets the XS Classic DSL format only.
- Auto-fix / code-rewriting capabilities.
- Checking whether a role name matches the file name — that is handled by the existing artifact-name rules, not content rules.
- Extraction or validation of privilege-type keywords (`SELECT`, `INSERT`, `EXECUTE`, etc.) — privilege types are a distinct concern and out of scope.
- A HANA SQL grammar covering `GRANT`/`REVOKE` statements — the parser covers the `role ... { ... }` DSL shape only.
