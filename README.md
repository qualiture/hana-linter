# hana-linter

[![npm version](https://img.shields.io/npm/v/hana-linter)](https://www.npmjs.com/package/hana-linter)
[![CI](https://github.com/qualiture/hana-linter/actions/workflows/npm-publish.yml/badge.svg?branch=main)](https://github.com/qualiture/hana-linter/actions/workflows/npm-publish.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/qualiture/hana-linter/blob/main/LICENSE)
[![Node >=14](https://img.shields.io/badge/node-%3E%3D14-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

Naming-convention lint for SAP HANA artifacts in CAP projects.

> **⚠️ Work in progress.** This project is under active development. APIs, configuration options, and supported artifact types may change between releases. See [Parser Status](#parser-status) for the current state of content extraction support.

[NPM package](https://www.npmjs.com/package/hana-linter) • [Report issue](https://github.com/qualiture/hana-linter/issues)

Lint SAP HANA artifact file names and content identifiers in CAP projects using configurable regex-based naming rules.

## Why

Teams often rely on naming conventions for HANA artifacts such as tables and views. When these conventions are enforced manually, drift is common and code reviews become noisy.

hana-linter helps you:

- enforce naming standards consistently
- catch violations early in local development and CI
- apply different rules per file extension
- keep naming policy in version control via a single config file

## How It Works

hana-linter reads a `.hana-linter.json` file and validates artifact file names against rules grouped by extension.

It supports two lint modes:

- Full scan mode: no file arguments, recursively scans `rootDir`
- File-list mode: pass file paths, only those files are validated

Rule groups per extension:

- `groups.all`: every rule must match (AND)
- `groups.any`: at least one rule must match (OR)

You can define `extension: "*"` as a shared rule set. Its rules are applied to every file extension and are merged with any extension-specific rule set.

Content-based linting uses purpose-built parsers to reliably extract identifiers from HANA artifact files. SQL DDL artifact types (`.hdbtable`, `.hdbview`, `.hdbprocedure`, `.hdbfunction`, `.hdbtabletype`, `.hdbrole`, `.hdbsequence`) use [Chevrotain](https://chevrotain.io)-powered lexers and CST parsers that correctly handle block and line comments, multi-line definitions, quoted identifiers, and HANA-specific DDL constructs. The JSON-like `.hdbschedulerjob` format is also parsed with Chevrotain, tolerating C-style comments (`//` and `/* … */`) and trailing commas that standard `JSON.parse()` rejects. The XML-based `.hdbcalculationview` format uses [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser) to navigate the logical model tree — without the false positives and false negatives that ad-hoc regex scanning produces.

## Parser Status

> **Work in progress.** Not all artifact types have been migrated to the Chevrotain-based parsing infrastructure yet.

| Artifact extension        | Content extractor      | Status                 |
| ------------------------- | ---------------------- | ---------------------- |
| `.hdbtable`               | Chevrotain lexer + CST | ✅ Migrated            |
| `.hdbview`                | Chevrotain lexer + CST | ✅ Migrated            |
| `.hdbprocedure`           | Chevrotain lexer + CST | ✅ Migrated            |
| `.hdbfunction`            | Chevrotain lexer + CST | ✅ Migrated            |
| `.hdbtabletype`           | Chevrotain lexer + CST | ✅ Migrated            |
| `.hdbrole`                | Chevrotain lexer + CST | ✅ Migrated            |
| `.hdbcalculationview`     | fast-xml-parser (XML)  | ✅ Migrated            |
| `.hdbanalyticalprivilege` | —                      | ❌ Not yet implemented |
| `.hdbsequence`            | Chevrotain lexer + CST | ✅ Migrated            |
| `.hdbconstraint`          | —                      | ❌ Not yet implemented |
| `.hdbschedulerjob`        | Chevrotain lexer + CST | ✅ Migrated            |
| `.hdbindex`               | —                      | ❌ Not yet implemented |
| `.hdbtrigger`             | —                      | ❌ Not yet implemented |

- The regex **file name** validations for all of the above listed extensions **are implemented**. The **content extractor** hasn't been implemented everywhere yet.
- **Not implemented**: `contentRuleSets` targeting these extensions will silently return no results — no identifiers are extracted and no content issues are raised.

## Install

### Local (recommended for projects)

```bash
npm install --save-dev hana-linter
```

Run with:

```bash
npx hana-linter
```

### Global

```bash
npm install -g hana-linter
```

## Quick Start

1. Generate a default config in your project root:

```bash
hana-linter init
```

2. Run the linter:

```bash
hana-linter
```

3. If needed, regenerate and overwrite config:

```bash
hana-linter init --force
```

## Commands

### `hana-linter`

Run lint using `.hana-linter.json` from the current working directory.

```bash
hana-linter
```

Lint specific files only:

```bash
hana-linter db/src/T_CUSTOMER.hdbtable db/src/V_ACTIVE_USERS.hdbview
```

Use a custom config path:

```bash
hana-linter --config ./config/.hana-linter.json
```

### `hana-linter init`

Create `.hana-linter.json` in the current working directory from the bundled default template.

```bash
hana-linter init
```

Overwrite existing config:

```bash
hana-linter init --force
```

## Configuration

Create a `.hana-linter.json` file in your project root.

### Configuration Fields

- `rootDir` (string): directory to scan in full scan mode
- `ignoredDirectories` (string[]): folder names ignored during recursive traversal
- `extensionRuleSets` (array): rule definitions grouped by file extension
- `contentRuleSets` (optional array): naming rules for identifiers extracted from file contents (for example table fields and procedure/function parameters)

Each `extensionRuleSets` item contains:

- `extension` (string): target extension, for example `.hdbtable`; use `*` to target all extensions
- `folderName` (optional string): enforce that matching files are located in a folder with this name (at any depth under `rootDir`)
- `groups.all` (optional array): all rules must match
- `groups.any` (optional array): at least one rule must match

Each rule contains:

- `description` (string): readable rule label for output
- `pattern` (string): regex source (without `/` delimiters)
- `flags` (optional string): regex flags, for example `i`, `u`, `iu`

At least one of `groups.all` or `groups.any` must be present for each extension.

When `folderName` is omitted, no folder-location enforcement is applied.

Each `contentRuleSets` item contains:

- `extension` (string): target extension, for example `.hdbtable`; use `*` to target all extensions
- `target` (string): extracted identifier type to validate; one of `field`, `inputParameter`, `outputParameter`, `roleName`, `grantedRoleName`, `sequenceName`, `jobAction`
- `groups.all` (optional array): all rules must match
- `groups.any` (optional array): at least one rule must match

Supported extractors in this version:

| `target`          | Supported extensions  | Extracted identifiers                                                         |
| ----------------- | --------------------- | ----------------------------------------------------------------------------- |
| `field`           | `.hdbtable`           | Column names                                                                  |
| `field`           | `.hdbview`            | Column aliases (explicit list or `AS` aliases)                                |
| `field`           | `.hdbtabletype`       | Column names                                                                  |
| `inputParameter`  | `.hdbprocedure`       | `IN` and `INOUT` parameters                                                   |
| `inputParameter`  | `.hdbfunction`        | `IN` parameters (functions accept `IN` only)                                  |
| `outputParameter` | `.hdbprocedure`       | `OUT` and `INOUT` parameters                                                  |
| `roleName`        | `.hdbrole`            | The role name defined in the file                                             |
| `grantedRoleName` | `.hdbrole`            | Each role listed in `extends roles { ... }`                                   |
| `field`           | `.hdbcalculationview` | Output attributes, calculated attributes, base/calculated/restricted measures |
| `inputParameter`  | `.hdbcalculationview` | Input parameters (`variable[@parameter="true"]`)                              |
| `sequenceName`    | `.hdbsequence`        | The sequence name declared in the file                                        |
| `jobAction`       | `.hdbschedulerjob`    | The procedure/function reference in the `action` field                        |

### Default Config Example

```json
{
    "rootDir": "db",
    "ignoredDirectories": ["node_modules", ".git", "gen"],
    "extensionRuleSets": [
        {
            "extension": "*",
            "groups": {
                "all": [
                    {
                        "description": "Upper snake case only",
                        "pattern": "^[A-Z0-9]+(?:_[A-Z0-9]+)*$"
                    },
                    {
                        "description": "Max length 30",
                        "pattern": "^.{1,30}$",
                        "flags": "u"
                    }
                ]
            }
        },
        {
            "extension": ".hdbtable",
            "folderName": "tables",
            "groups": {
                "any": [
                    {
                        "description": "Prefix T_",
                        "pattern": "^T_.+"
                    },
                    {
                        "description": "Prefix TX_",
                        "pattern": "^TX_.+"
                    }
                ]
            }
        },
        {
            "extension": ".hdbview",
            "groups": {
                "all": [
                    {
                        "description": "Starts with V_",
                        "pattern": "^V_.+"
                    }
                ]
            }
        }
    ],
    "contentRuleSets": [
        {
            "extension": ".hdbtable",
            "target": "field",
            "groups": {
                "all": [
                    {
                        "description": "Field names in uppercase snake case",
                        "pattern": "^[A-Z0-9]+(?:_[A-Z0-9]+)*$"
                    }
                ]
            }
        },
        {
            "extension": ".hdbprocedure",
            "target": "inputParameter",
            "groups": {
                "all": [
                    {
                        "description": "Input parameters prefixed with IP_",
                        "pattern": "^IP_[A-Z0-9_]+$"
                    }
                ]
            }
        },
        {
            "extension": ".hdbprocedure",
            "target": "outputParameter",
            "groups": {
                "all": [
                    {
                        "description": "Output parameters prefixed with OP_",
                        "pattern": "^OP_[A-Z0-9_]+$"
                    }
                ]
            }
        },
        {
            "extension": ".hdbview",
            "target": "field",
            "groups": {
                "all": [
                    {
                        "description": "View column aliases in uppercase snake case",
                        "pattern": "^[A-Z0-9]+(?:_[A-Z0-9]+)*$"
                    }
                ]
            }
        },
        {
            "extension": ".hdbfunction",
            "target": "inputParameter",
            "groups": {
                "all": [
                    {
                        "description": "Input parameters prefixed with IP_",
                        "pattern": "^IP_[A-Z0-9_]+$"
                    }
                ]
            }
        },
        {
            "extension": ".hdbtabletype",
            "target": "field",
            "groups": {
                "all": [
                    {
                        "description": "Field names in uppercase snake case",
                        "pattern": "^[A-Z0-9]+(?:_[A-Z0-9]+)*$"
                    }
                ]
            }
        },
        {
            "extension": ".hdbrole",
            "target": "roleName",
            "groups": {
                "all": [
                    {
                        "description": "Role names prefixed with R_",
                        "pattern": "^R_.+"
                    }
                ]
            }
        },
        {
            "extension": ".hdbcalculationview",
            "target": "field",
            "groups": {
                "all": [
                    {
                        "description": "Output column IDs in uppercase snake case",
                        "pattern": "^[A-Z0-9]+(?:_[A-Z0-9]+)*$"
                    }
                ]
            }
        },
        {
            "extension": ".hdbcalculationview",
            "target": "inputParameter",
            "groups": {
                "all": [
                    {
                        "description": "Input parameters prefixed with IP_",
                        "pattern": "^IP_[A-Z0-9_]+$"
                    }
                ]
            }
        },
        {
            "extension": ".hdbsequence",
            "target": "sequenceName",
            "groups": {
                "all": [
                    {
                        "description": "Sequence names in uppercase snake case",
                        "pattern": "^[A-Z0-9]+(?:_[A-Z0-9]+)*$"
                    }
                ]
            }
        },
        {
            "extension": ".hdbschedulerjob",
            "target": "jobAction",
            "groups": {
                "all": [
                    {
                        "description": "Job action must reference a package-qualified procedure (contains ::)",
                        "pattern": "::"
                    }
                ]
            }
        }
    ]
}
```

## Exit Codes

- `0`: lint passed or `init` completed successfully
- `1`: lint violations found or command failed

This makes the CLI suitable for CI pipelines.

## CI Example

```yaml
name: lint-hana-names
on: [push, pull_request]

jobs:
	hana-lint:
		runs-on: ubuntu-latest
		steps:
			- uses: actions/checkout@v4
			- uses: actions/setup-node@v4
				with:
					node-version: 20
			- run: npm ci
			- run: npx hana-linter
```

## Pre-commit Hook (husky + lint-staged)

hana-linter's file-list mode (passing files as arguments) integrates cleanly with [lint-staged](https://github.com/lint-staged/lint-staged): lint-staged appends each staged file that matches the glob to the command, so only the files you are about to commit are linted.

**1. Install the tools**

```bash
npm install --save-dev husky lint-staged
npx husky init
```

**2. Configure lint-staged**

Add a `lint-staged` key to `package.json`:

```json
{
    "lint-staged": {
        "*.hdb*": "hana-linter"
    }
}
```

lint-staged turns this into `hana-linter <file1> <file2> …` for every staged file that matches the glob, which is exactly the file-list mode hana-linter supports.

**3. Wire the pre-commit hook**

Replace the contents of `.husky/pre-commit` with:

```bash
npx lint-staged
```

Now, every `git commit` will automatically run hana-linter against the staged HANA artifact files. If any naming violations are found, the commit is blocked and the issues are reported in the terminal.

> **Tip:** Add `hana-linter` to `dependencies` (not `devDependencies`) if the linter also runs in production CI, so it is available after a plain `npm ci --production` install. For pre-commit-only use, `devDependencies` is fine.

## Requirements

- Node.js >= 14
- npm >= 7

## Contributing

Contributions are welcome. Please open an issue or submit a pull request.

## License

MIT
