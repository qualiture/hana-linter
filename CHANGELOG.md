# Changelog

All notable changes to this project will be documented in this file.

---

### 0.2.0

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
