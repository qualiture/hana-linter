# Changelog

All notable changes to this project will be documented in this file.

---

### 1.1.0

- Console output is now grouped by file, then by failed rule, reducing noise when multiple violations exist in the same file
- Added line numbers to content-lint violations (fields, input/output parameters) so users can jump directly to the offending identifier in their editor
- All four Chevrotain visitors (`hdbtable`, `hdbview`, `hdbprocedure`, `hdbfunction`) now capture `token.startLine` from the parsed token and propagate it through `ExtractedSubject` and `LintIssue`

---

### 1.0.3

- Fixed build: `src/assets/.hana-linter.json` is now correctly copied to `dist/assets/` during `pnpm build` via `copyfiles`, ensuring the default config template is bundled in the published package

---

### 1.0.2

- Added Chevrotain-based `.hdbfunction` parser; content-linting of function input parameters is now fully reliable
- The `.hdbfunction` parser isolates the parameter list from the `RETURNS` clause and the function body (`AS BEGIN … END`), eliminating false positives caused by `IN` keywords inside SQL body statements and column names in `RETURNS TABLE (...)` definitions
- HANA functions accept only `IN` parameters; the new parser correctly produces only `inputParameter` subjects and never emits `outputParameter` entries for `.hdbfunction` files
- Removed the shared ad-hoc regex extractor (`extractProcedureFunctionParameters`) that was previously used for both `.hdbprocedure` and `.hdbfunction` files

---

### 1.0.0

- Replaced ad-hoc, line-by-line regex extraction with Chevrotain-based lexer + CST parsers for `.hdbtable`, `.hdbprocedure`, and `.hdbview` files
- Added Chevrotain-based `.hdbview` parser; content-linting of view column aliases is now fully supported (both explicit column-list and `SELECT AS` alias modes)
- The `.hdbprocedure` parser isolates the parameter list from the procedure body (`AS BEGIN … END`), eliminating false positives caused by `IN`/`OUT`/`INOUT` keywords inside SQL body statements
- The `.hdbtable` parser correctly handles HANA-specific DDL variants (COLUMN TABLE, ROW TABLE, GLOBAL TEMPORARY COLUMN TABLE), constraint clauses, partition clauses, and quoted identifiers — removing false positives from the previous regex approach
- All three parsers gracefully handle block comments (`/* … */`), line comments (`-- …`), multi-line definitions, and schema-qualified identifiers

### 0.2.1

- Fixes npm publish

### 0.2.0

- Added content-based linting for extracted identifiers (fields, input parameters, output parameters)
- Added optional `contentRuleSets` configuration section for naming rules on file contents
- Added support for field naming validation in `.hdbtable` files
- Added support for input/output parameter naming validation in `.hdbprocedure` and `.hdbfunction` files
- Added optional `folderName` enforcement per extension rule set to require files in specific directories
- Refactored monolithic `src/index.ts` into focused modules: `cli.ts`, `config.ts`, `files.ts`, `lint.ts`, `report.ts`, `content-lint.ts`

### 0.1.1

- Added `hana-linter init` command to generate a default `.hana-linter.json` in the current project root
- Added `hana-linter init --force` option to overwrite an existing config file

### Initial Release

- Initial version with core linter functionality
