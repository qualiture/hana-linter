# hana-linter

Lint SAP HANA artifact names in CAP projects using configurable regex-based naming rules.

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

Each `extensionRuleSets` item contains:

- `extension` (string): target extension, for example `.hdbtable`
- `groups.all` (optional array): all rules must match
- `groups.any` (optional array): at least one rule must match

Each rule contains:

- `description` (string): readable rule label for output
- `pattern` (string): regex source (without `/` delimiters)
- `flags` (optional string): regex flags, for example `i`, `u`, `iu`

At least one of `groups.all` or `groups.any` must be present for each extension.

### Default Config Example

```json
{
    "rootDir": "db",
    "ignoredDirectories": ["node_modules", ".git", "gen"],
    "extensionRuleSets": [
        {
            "extension": ".hdbtable",
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
                ],
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
                    },
                    {
                        "description": "Case-insensitive example (demo)",
                        "pattern": "^v_.+",
                        "flags": "i"
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

## Requirements

- Node.js >= 14
- npm >= 7

## Contributing

Contributions are welcome. Please open an issue or submit a pull request.

## License

MIT
