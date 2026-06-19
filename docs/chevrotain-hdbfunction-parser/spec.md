# Technical Design Specification: Chevrotain Lexer/Parser for `.hdbfunction`

**PRD**: [prd.md](./prd.md)  
**Feature**: Chevrotain `.hdbfunction` Function Parameter Extractor  
**Status**: Ready for Implementation

---

## 1. System Architecture Overview

### Current state

`extractSubjects()` in `src/content-lint.ts` routes `.hdbfunction` files to the legacy regex-based helper `extractProcedureFunctionParameters()`. That function uses a single `IN|OUT|INOUT` pattern and cannot distinguish the parameter list from the `RETURNS` clause or the function body.

```
content-lint.ts
  └── extractSubjects()
        ├── '.hdbtable'       → extractTableColumns()
        ├── '.hdbview'        → extractViewColumns()
        ├── '.hdbprocedure'   → extractProcedureParameters()
        └── '.hdbfunction'    → extractProcedureFunctionParameters()  ← regex (TO BE REPLACED)
```

### Target state

A new `src/parsers/hdbfunction/` sub-module mirrors the structure of `src/parsers/hdbprocedure/`. `extractSubjects()` gains a dedicated `.hdbfunction` branch that delegates to the new module. The now-orphaned `extractProcedureFunctionParameters()` function is deleted.

```
content-lint.ts
  └── extractSubjects()
        ├── '.hdbtable'       → extractTableColumns()
        ├── '.hdbview'        → extractViewColumns()
        ├── '.hdbprocedure'   → extractProcedureParameters()
        └── '.hdbfunction'    → extractFunctionParameters()   ← NEW

src/parsers/hdbfunction/
  ├── lexer.ts      Token definitions + singleton Lexer instance
  ├── parser.ts     CstParser subclass + grammar rules
  ├── visitor.ts    CST visitor that collects IN parameter declarations
  └── index.ts      Public API: extractFunctionParameters()
```

Everything above `extractSubjects()` — `lintFileContent()`, `runLint()`, `LintIssue`, and the public `src/index.ts` entry point — is unchanged.

---

## 2. Technology Stack

| Concern          | Choice                 | Rationale                                                  |
| ---------------- | ---------------------- | ---------------------------------------------------------- |
| Parser framework | **Chevrotain** (v11.x) | Already a `dependencies` entry; no new dependency required |
| Language         | TypeScript (existing)  | Matches the project                                        |
| Build            | `tsc` (existing)       | No additional build tooling needed                         |
| Runtime          | Node.js (existing)     | No change                                                  |

No new `npm install` step is needed. `chevrotain` is already present in `package.json` as a production dependency.

---

## 3. Component Design

### 3.1 File layout

```
src/
  parsers/
    hdbfunction/
      lexer.ts
      parser.ts
      visitor.ts
      index.ts
      __tests__/
        extractFunctionParameters.test.ts
```

### 3.2 `src/parsers/hdbfunction/lexer.ts`

#### Responsibility

Define every token the grammar needs and export a singleton `Lexer` instance.

#### Token ordering rules (Chevrotain-specific)

1. Skip tokens (`BlockComment`, `LineComment`, `WhiteSpace`) must be declared first so they are consumed before anything else.
2. String literals must be declared before keyword tokens to avoid partial matches on quoted strings containing keyword text.
3. Keyword tokens must appear **before** `QuotedIdentifier` and `Identifier` in the `allTokens` array.
4. All keyword tokens must declare `longer_alt: Identifier` so that identifiers that begin with a keyword prefix (e.g. `INVOICE`, `RETURNS_DATA`) are not split at the keyword boundary.
5. Tokens with a shared prefix must be declared in **longest-first** order within the group (see prefix-conflict table below).
6. `QuotedIdentifier` must appear before `Identifier`.
7. `IntegerLiteral` must appear after `Identifier` (conventional; digits do not appear in identifier patterns).

#### Prefix-conflict pairs requiring explicit ordering

| Longer token | Shorter token | Constraint                                                                                                                                                                                     |
| ------------ | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVOKER`    | `IN`          | Declare `Invoker` before `In` in `allTokens`                                                                                                                                                   |
| `INTEGER`    | (no `INT`)    | No conflict; only `INTEGER` is in the token catalogue                                                                                                                                          |
| `TIMESTAMP`  | `TIME`        | Declare `Timestamp` before `Time`                                                                                                                                                              |
| `SECONDDATE` | (no `SECOND`) | No conflict                                                                                                                                                                                    |
| `DEFINER`    | `DEFAULT`     | Both start with `DE` but diverge at 4th character; no ordering constraint between them, but both require `longer_alt: Identifier` to avoid being consumed by an identifier starting with `DEF` |
| `RETURNS`    | (no `RETURN`) | No conflict; only `RETURNS` is in the token catalogue                                                                                                                                          |

#### Token catalogue

**Skip tokens** (declared first):

| Token name     | Pattern              | Mode                       |
| -------------- | -------------------- | -------------------------- |
| `BlockComment` | `/\/\*[\s\S]*?\*\//` | `{ group: Lexer.SKIPPED }` |
| `LineComment`  | `/--[^\r\n]*/`       | `{ group: Lexer.SKIPPED }` |
| `WhiteSpace`   | `/\s+/`              | `{ group: Lexer.SKIPPED }` |

**Literal tokens** (declared before keywords):

| Token name      | Pattern        |
| --------------- | -------------- | ---------- |
| `StringLiteral` | `/\'(?:[^\'\\] | \\.)\*\'/` |

**Function-level keyword tokens** (all with `longer_alt: Identifier`; listed in declaration order):

| Token name   | Pattern         | Notes           |
| ------------ | --------------- | --------------- |
| `Invoker`    | `/INVOKER/i`    | Before `In`     |
| `In`         | `/IN/i`         | After `Invoker` |
| `Create`     | `/CREATE/i`     |                 |
| `Function`   | `/FUNCTION/i`   |                 |
| `Returns`    | `/RETURNS/i`    |                 |
| `TableKw`    | `/TABLE/i`      |                 |
| `Language`   | `/LANGUAGE/i`   |                 |
| `Sqlscript`  | `/SQLSCRIPT/i`  |                 |
| `Sql`        | `/SQL/i`        |                 |
| `Security`   | `/SECURITY/i`   |                 |
| `Definer`    | `/DEFINER/i`    |                 |
| `Default`    | `/DEFAULT/i`    |                 |
| `Schema`     | `/SCHEMA/i`     |                 |
| `As`         | `/AS/i`         |                 |
| `Begin`      | `/BEGIN/i`      |                 |
| `End`        | `/END/i`        |                 |
| `With`       | `/WITH/i`       |                 |
| `Encryption` | `/ENCRYPTION/i` |                 |

> **Note**: `OUT` and `INOUT` are intentionally absent. HANA functions accept only `IN` parameters; these tokens serve no purpose and their absence prevents any `OUT`/`INOUT`-shaped body SQL from being misinterpreted as parameter modes.

**Data-type keyword tokens** (all with `longer_alt: Identifier`):

| Token name   | Pattern         | Notes             |
| ------------ | --------------- | ----------------- |
| `Timestamp`  | `/TIMESTAMP/i`  | Before `Time`     |
| `Seconddate` | `/SECONDDATE/i` |                   |
| `NVarchar`   | `/NVARCHAR/i`   |                   |
| `VarChar`    | `/VARCHAR/i`    |                   |
| `Alphanum`   | `/ALPHANUM/i`   |                   |
| `Shorttext`  | `/SHORTTEXT/i`  |                   |
| `Integer`    | `/INTEGER/i`    |                   |
| `Bigint`     | `/BIGINT/i`     |                   |
| `Smallint`   | `/SMALLINT/i`   |                   |
| `Tinyint`    | `/TINYINT/i`    |                   |
| `Decimal`    | `/DECIMAL/i`    |                   |
| `Double`     | `/DOUBLE/i`     |                   |
| `Float`      | `/FLOAT/i`      |                   |
| `Real`       | `/REAL/i`       |                   |
| `Boolean`    | `/BOOLEAN/i`    |                   |
| `Date`       | `/DATE/i`       |                   |
| `Time`       | `/TIME/i`       | After `Timestamp` |
| `Clob`       | `/CLOB/i`       |                   |
| `Nclob`      | `/NCLOB/i`      |                   |
| `Blob`       | `/BLOB/i`       |                   |
| `Varbinary`  | `/VARBINARY/i`  |                   |

**Identifier tokens** (declared after all keywords):

| Token name         | Pattern                    | Notes                                                        |
| ------------------ | -------------------------- | ------------------------------------------------------------ |
| `QuotedIdentifier` | `/\"[^\"]*\"/`             | Declared **before** `Identifier`                             |
| `Identifier`       | `/[A-Za-z_][A-Za-z0-9_]*/` | Catch-all; all keyword tokens use `longer_alt` pointing here |

**Numeric literal token:**

| Token name       | Pattern    |
| ---------------- | ---------- |
| `IntegerLiteral` | `/[0-9]+/` |

**Punctuation tokens:**

| Token name  | Pattern |
| ----------- | ------- |
| `LParen`    | `\(`    |
| `RParen`    | `\)`    |
| `Comma`     | `,`     |
| `Semicolon` | `;`     |
| `Dot`       | `\.`    |

#### `allTokens` array ordering (summary)

```
[
  // Skip
  BlockComment, LineComment, WhiteSpace,
  // String literal
  StringLiteral,
  // Function keywords — prefix-conflict groups in longest-first order
  Invoker, In,               // IN-prefix group: INVOKER before IN
  Create, Function, Returns,
  TableKw,
  Language, Sqlscript,
  Sql, Security, Definer, Default, Schema,
  As, Begin, End, With, Encryption,
  // Data-type keywords — prefix-conflict groups in longest-first order
  Timestamp, Seconddate,     // TIME-prefix group: TIMESTAMP before TIME
  NVarchar, VarChar, Alphanum, Shorttext,
  Integer, Bigint, Smallint, Tinyint,
  Decimal, Double, Float, Real, Boolean,
  Date, Time,                // TIME after TIMESTAMP
  Clob, Nclob, Blob, Varbinary,
  // Identifiers (catch-all — after all keywords)
  QuotedIdentifier, Identifier,
  // Numeric literal
  IntegerLiteral,
  // Punctuation
  LParen, RParen, Comma, Semicolon, Dot
]
```

#### Exported symbols

```typescript
export const allTokens: TokenType[];
export const HdbFunctionLexer: Lexer; // singleton — instantiated at module load
```

---

### 3.3 `src/parsers/hdbfunction/parser.ts`

#### Responsibility

Define the grammar as a `CstParser` subclass. Expose a singleton parser instance.

#### Grammar notation

> `?` = optional, `*` = zero-or-more, `+` = one-or-more, `|` = alternation, `()` = grouping.

#### Grammar rules

```
createFunctionStatement
    CREATE? FUNCTION functionName
    LParen parameterList RParen
    RETURNS returnsClause
    functionOption*
    AS functionBody
    Semicolon?

functionName
    identifier (Dot identifier)?
    -- identifier = Identifier | QuotedIdentifier
    -- handles both unquoted MY_FUNC and quoted "MY_SCHEMA"."MY_FUNCTION"

parameterList
    (parameterDeclaration (Comma parameterDeclaration)*)?
    -- zero or more parameters; empty list () is valid

parameterDeclaration
    IN parameterName parameterType
    -- only IN mode is valid for HANA functions
    -- no OUT or INOUT alternatives

parameterName
    identifier

parameterType
    tableType | scalarType

tableType
    TABLE LParen tableColumnList RParen
    -- TABLE-type IN parameter; inner column list is parsed but NOT extracted

tableColumnList
    tableColumnDefinition (Comma tableColumnDefinition)*

tableColumnDefinition
    identifier scalarType
    -- column name is intentionally not extracted by the visitor

scalarType
    dataTypeKeyword (LParen IntegerLiteral (Comma IntegerLiteral)? RParen)?
    -- e.g. NVARCHAR(100), DECIMAL(18, 2), INTEGER (no parens)

dataTypeKeyword
    -- any of the data-type keyword tokens listed in §3.2

returnsClause
    returnsTable | returnsScalar
    -- returnsTable is tried first; TABLE keyword disambiguates

returnsTable
    TABLE LParen returnColumnList RParen
    -- e.g. RETURNS TABLE (ID INTEGER, NAME NVARCHAR(100))
    -- column names are consumed but NOT extracted as subjects

returnColumnList
    returnColumnDefinition (Comma returnColumnDefinition)*

returnColumnDefinition
    identifier scalarType
    -- return column name is intentionally not extracted

returnsScalar
    scalarType
    -- e.g. RETURNS NVARCHAR(100), RETURNS INTEGER

functionOption
    languageOption
    | sqlSecurityOption
    | defaultSchemaOption
    | encryptionOption

languageOption
    LANGUAGE SQLSCRIPT

sqlSecurityOption
    SQL SECURITY (INVOKER | Identifier)
    -- INVOKER and DEFINER are the standard values;
    -- Identifier catch-all handles non-standard values without failing

defaultSchemaOption
    DEFAULT SCHEMA identifier

encryptionOption
    WITH ENCRYPTION

functionBody
    BEGIN functionBodyContent END Semicolon?
    -- The body is consumed as a recursive block; its content is NEVER extracted.

functionBodyContent
    MANY: (nestedBlock | anyBodyToken | parenGroup)
    -- Absorbs all tokens inside the body, including nested BEGIN/END pairs.
    -- Stops when the next token is END at the current nesting depth.

nestedBlock
    BEGIN functionBodyContent END
    -- Handles nested BEGIN/END in IF/ELSE, CASE, WHILE, FOR, etc.

parenGroup
    LParen MANY:(parenGroup | anyBodyToken) RParen
    -- Handles parenthesised expressions inside the body (function calls etc.)

anyBodyToken
    -- Matches any single token except BEGIN, END, LParen, and RParen.
    -- The explicit enumeration ensures MANY in functionBodyContent
    -- can stop correctly when it encounters END or RParen.
    (any token in allTokens except Begin, End, LParen, RParen)

identifier
    Identifier | QuotedIdentifier
```

#### Key design: function body isolation

The central correctness guarantee is that `parameterDeclaration` and `returnsClause` rules are fully parsed **before** `functionBody` is entered. Once the parser consumes `AS`, it enters `functionBody` which recursively swallows everything up to the matching `END`. The `IN` keyword token inside the body (e.g. `WHERE STATUS IN (...)`) is consumed by `anyBodyToken` and never reaches a `parameterDeclaration` rule.

#### Key design: `returnsClause` alternation order

`returnsClause` tries `returnsTable` before `returnsScalar`. This is important because `TABLE` is itself a keyword token and must be matched before the grammar falls through to `returnsScalar` (which would try to match `TABLE` as a `dataTypeKeyword` and fail or produce an incorrect result). Chevrotain's `OR` with a token-type lookahead (`GATE: () => this.LA(1).tokenType === TableKw`) provides clean disambiguation.

#### Key design: `RETURNS TABLE` vs `parameterType TABLE`

Both `parameterType` and `returnsClause` can contain `TABLE (...)`. The grammar rule invoked disambiguates: `parameterType` is reached only inside `parameterDeclaration` (within the parameter list), and `returnsClause` is reached only after the closing `)` of the parameter list, following the `RETURNS` keyword. There is no structural ambiguity.

#### Key design: `nestedBlock` vs `parenGroup`

Identical design rationale to the `.hdbprocedure` parser:

- **`nestedBlock`**: handles `BEGIN … END` pairs introduced by SQLScript control flow. Recursion ensures the outer `END` is consumed at the correct nesting level.
- **`parenGroup`**: handles `(…)` parentheses. `LParen`/`RParen` are excluded from `anyBodyToken` so every `(` forces entry into `parenGroup`, consuming the matching `)` at the correct depth.

#### Error recovery

Use Chevrotain's default single-token insertion/deletion recovery. Do **not** override recovery methods — the defaults ensure partial CSTs are returned rather than exceptions when encountering unexpected syntax.

#### Exported symbols

```typescript
export class HdbFunctionParser extends CstParser { ... }
export const hdbFunctionParser: HdbFunctionParser; // singleton
```

---

### 3.4 `src/parsers/hdbfunction/visitor.ts`

#### Responsibility

Walk the CST produced by `HdbFunctionParser` and emit `ExtractedSubject` entries for each `parameterDeclaration` node. Does not descend into `tableColumnList`, `returnColumnList`, or `functionBody` nodes.

#### Design

The visitor extends `BaseCstVisitorWithDefaults` (obtained via `hdbFunctionParser.getBaseCstVisitorConstructorWithDefaults()`). This variant auto-visits all child nodes for any method not explicitly overridden, so only the rules we care about need to be implemented.

#### Extraction logic: `parameterDeclaration`

```typescript
parameterDeclaration(ctx: CstChildrenDictionary): void {
    // All function parameters are IN; no mode check required.
    // Extract the parameter name from the parameterName child rule.
    const nameNodes = ctx['parameterName'] as CstNode[] | undefined;
    if (!nameNodes?.length) return;

    const name = this.extractName(nameNodes[0]);
    if (!name) return;

    this.parameters.push({ type: 'inputParameter', name });
}
```

#### Blocking `tableColumnList` and `returnColumnList` extraction

`BaseCstVisitorWithDefaults` auto-visits `tableColumnDefinition` and `returnColumnDefinition` nodes. To prevent any column names inside TABLE-type parameters or `RETURNS TABLE` from being extracted, both rules are overridden with no-ops:

```typescript
tableColumnDefinition(_ctx: CstChildrenDictionary): void {
    // Intentionally empty — inner column names of TABLE-type IN parameters
    // are NOT extracted as parameter subjects.
}

returnColumnDefinition(_ctx: CstChildrenDictionary): void {
    // Intentionally empty — RETURNS TABLE column names are NOT extracted.
}
```

#### Blocking `functionBody` extraction

The visitor overrides `functionBody` with a no-op to prevent all descent into body content:

```typescript
functionBody(_ctx: CstChildrenDictionary): void {
    // Intentionally empty — function body is opaque; no extraction.
}
```

Because `BaseCstVisitorWithDefaults` visits children of any non-overridden node, and `functionBody` is the root of the body subtree, a single no-op override is sufficient to block all descent into the body.

#### Identifier normalisation

A private helper strips surrounding double-quotes from `QuotedIdentifier` image strings:

```typescript
private extractName(node: CstNode): string | undefined {
    if (!node.children) return undefined;
    const token =
        (node.children['Identifier']?.[0] as IToken | undefined) ??
        (node.children['QuotedIdentifier']?.[0] as IToken | undefined);
    if (!token) return undefined;
    const raw = token.image;
    return raw.startsWith('"') ? raw.slice(1, -1) : raw;
}
```

#### Exported symbols

```typescript
export class HdbFunctionParameterVisitor { ... }
// parameters: ExtractedSubject[]  — public field read by index.ts after visit
```

---

### 3.5 `src/parsers/hdbfunction/index.ts`

#### Responsibility

Public API boundary. Orchestrates tokenise → parse → visit.

#### Implementation

```typescript
import type { ExtractedSubject } from '../../types/issues';
import { HdbFunctionLexer } from './lexer';
import { hdbFunctionParser } from './parser';
import { HdbFunctionParameterVisitor } from './visitor';

export function extractFunctionParameters(fileContent: string): ExtractedSubject[] {
    const lexResult = HdbFunctionLexer.tokenize(fileContent);

    hdbFunctionParser.input = lexResult.tokens;

    const cst = hdbFunctionParser.createFunctionStatement();

    if (!cst) {
        return [];
    }

    const visitor = new HdbFunctionParameterVisitor();
    visitor.visit(cst);
    return visitor.parameters;
}
```

Lex and parse errors are intentionally not re-thrown. The CST visitor extracts whatever parameters were recoverable from the partial tree. Callers in `content-lint.ts` must not throw on bad input.

---

### 3.6 Changes to `src/content-lint.ts`

Two changes only:

1. **Replace import**: swap `extractProcedureFunctionParameters` (local function, no import) with an import of `extractFunctionParameters`:

    ```typescript
    import { extractFunctionParameters } from './parsers/hdbfunction/index';
    ```

2. **Update** the `.hdbfunction` branch in `extractSubjects()` and **delete** `extractProcedureFunctionParameters()`:

    ```typescript
    // BEFORE
    function extractSubjects(extension: string, fileContent: string): ExtractedSubject[] {
        if (extension === '.hdbtable') return extractTableColumns(fileContent);
        if (extension === '.hdbview') return extractViewColumns(fileContent);
        if (extension === '.hdbprocedure') return extractProcedureParameters(fileContent);
        if (extension === '.hdbfunction') return extractProcedureFunctionParameters(fileContent);
        return [];
    }

    // AFTER
    function extractSubjects(extension: string, fileContent: string): ExtractedSubject[] {
        if (extension === '.hdbtable') return extractTableColumns(fileContent);
        if (extension === '.hdbview') return extractViewColumns(fileContent);
        if (extension === '.hdbprocedure') return extractProcedureParameters(fileContent);
        if (extension === '.hdbfunction') return extractFunctionParameters(fileContent);
        return [];
    }
    // + delete the extractProcedureFunctionParameters() helper function entirely
    ```

No other changes to `content-lint.ts`. `lintFileContent()`, `evaluateAllRules()`, `evaluateAnyRules()`, and `LintIssue` are untouched.

---

## 4. Data Models

No new persistent data models. The only types crossing the parser boundary are the existing `ExtractedSubject` and `ContentTarget`:

```typescript
// src/types/issues.ts — already exported; no changes needed
type ExtractedSubject = {
    readonly type: ContentTarget; // 'inputParameter' (only) for .hdbfunction
    readonly name: string; // normalised identifier (double-quotes stripped)
};

// src/types/rules.ts — already exported; no changes needed
type ContentTarget = 'field' | 'inputParameter' | 'outputParameter';
```

> **Note**: `'outputParameter'` remains a valid `ContentTarget` for `.hdbprocedure` files. The `.hdbfunction` extractor simply never emits it — it is not an error if a `contentRuleSet` targeting `outputParameter` is configured against `.hdbfunction`; it will just match zero subjects.

---

## 5. API Specifications

### Public function

```typescript
/**
 * Extract parameter names from the content of a `.hdbfunction` DDL file.
 *
 * Uses a Chevrotain lexer and CstParser. The parser recognises the function
 * header (parameter list, RETURNS clause, and options) and consumes the entire
 * function body (AS BEGIN … END) as an opaque block, ensuring that SQL keywords
 * inside the body never contaminate the extraction result.
 *
 * HANA functions accept only IN parameters. Every parameter produces an
 * { type: 'inputParameter', name } entry. No 'outputParameter' entries are
 * ever produced. RETURNS clause types and RETURNS TABLE column names are
 * parsed structurally but not extracted.
 *
 * Handles block/line comments, quoted and unquoted identifiers, schema-qualified
 * function names, TABLE-type IN parameters, RETURNS TABLE definitions, and all
 * standard function options. Gracefully returns partial results on invalid input
 * — does not throw.
 *
 * @param fileContent - Raw UTF-8 file content (LF or CRLF).
 * @returns Array of ExtractedSubject with type 'inputParameter' only.
 */
export function extractFunctionParameters(fileContent: string): ExtractedSubject[];
```

### Internal module exports (not part of public API)

| Symbol                                   | Module       | Visibility       |
| ---------------------------------------- | ------------ | ---------------- |
| `allTokens`, `HdbFunctionLexer`          | `lexer.ts`   | Package-internal |
| `HdbFunctionParser`, `hdbFunctionParser` | `parser.ts`  | Package-internal |
| `HdbFunctionParameterVisitor`            | `visitor.ts` | Package-internal |

---

## 6. Unit Test Design

Test file: `src/parsers/hdbfunction/__tests__/extractFunctionParameters.test.ts`

The test file mirrors the structure of `extractProcedureParameters.test.ts`: one `describe` block per acceptance criterion, using typed helper functions.

```typescript
import { describe, it, expect } from 'vitest';
import { extractFunctionParameters } from '../index';

function inputs(ddl: string): string[] {
    return extractFunctionParameters(ddl)
        .filter((s) => s.type === 'inputParameter')
        .map((s) => s.name);
}
```

### Test cases by acceptance criterion

**AC-1 — IN parameter extraction (scalar function)**

```typescript
describe('AC-1: IN parameter extraction (scalar function)', () => {
    it('extracts IN parameters as inputParameter subjects', () => {
        const ddl = `
            FUNCTION MY_FUNC (
                IN IV_CUSTOMER_ID NVARCHAR(10),
                IN IV_DATE DATE
            ) RETURNS NVARCHAR(100) AS BEGIN END
        `;
        expect(extractFunctionParameters(ddl)).toEqual([
            { type: 'inputParameter', name: 'IV_CUSTOMER_ID' },
            { type: 'inputParameter', name: 'IV_DATE' }
        ]);
    });
});
```

**AC-2 — IN parameter extraction (table function)**

```typescript
describe('AC-2: IN parameter extraction (table function)', () => {
    it('extracts IN params and ignores RETURNS TABLE columns', () => {
        const ddl = `
            FUNCTION MY_FUNC (
                IN IV_STATUS NVARCHAR(1)
            ) RETURNS TABLE (ID INTEGER, NAME NVARCHAR(100)) AS BEGIN END
        `;
        expect(extractFunctionParameters(ddl)).toEqual([{ type: 'inputParameter', name: 'IV_STATUS' }]);
    });
});
```

**AC-3 — RETURNS TABLE columns are not extracted**

```typescript
describe('AC-3: RETURNS TABLE columns not extracted', () => {
    it('does not extract OUT_COL or IN_COL from RETURNS TABLE definition', () => {
        const ddl = `
            FUNCTION F ()
            RETURNS TABLE (OUT_COL INTEGER, IN_COL NVARCHAR(10))
            AS BEGIN END
        `;
        const names = extractFunctionParameters(ddl).map((s) => s.name);
        expect(names).not.toContain('OUT_COL');
        expect(names).not.toContain('IN_COL');
    });

    it('does not extract column names from a multi-column RETURNS TABLE', () => {
        const ddl = `
            FUNCTION F (IN IV_X INTEGER)
            RETURNS TABLE (
                COL_A BIGINT,
                COL_B NVARCHAR(200),
                COL_C TIMESTAMP
            ) AS BEGIN END
        `;
        expect(inputs(ddl)).toEqual(['IV_X']);
    });
});
```

**AC-4 — No outputParameter subjects produced**

```typescript
describe('AC-4: no outputParameter subjects produced', () => {
    it('never emits an outputParameter entry', () => {
        const ddl = `
            FUNCTION F (IN IV_A INTEGER, IN IV_B NVARCHAR(10))
            RETURNS INTEGER AS BEGIN END
        `;
        const outputSubjects = extractFunctionParameters(ddl).filter((s) => s.type === 'outputParameter');
        expect(outputSubjects).toHaveLength(0);
    });
});
```

**AC-5 — TABLE-type IN parameter: inner columns not extracted**

```typescript
describe('AC-5: TABLE-type IN parameter columns not extracted', () => {
    it('extracts only the outer parameter name', () => {
        const ddl = `
            FUNCTION F (
                IN TV_INPUT TABLE (COL1 INTEGER, COL2 NVARCHAR(100))
            ) RETURNS INTEGER AS BEGIN END
        `;
        const result = extractFunctionParameters(ddl);
        expect(result).toContainEqual({ type: 'inputParameter', name: 'TV_INPUT' });
        expect(result.map((s) => s.name)).not.toContain('COL1');
        expect(result.map((s) => s.name)).not.toContain('COL2');
    });
});
```

**AC-6 — Function body SQL does not pollute extraction**

```typescript
describe('AC-6: function body SQL does not pollute extraction', () => {
    it('ignores IN keyword inside WHERE clause in the body', () => {
        const ddl = `
            FUNCTION F (IN IV_ID INTEGER) RETURNS INTEGER AS
            BEGIN
                SELECT COUNT(*) FROM MY_TABLE WHERE STATUS IN ('A', 'B');
            END
        `;
        expect(inputs(ddl)).toEqual(['IV_ID']);
    });

    it('handles nested BEGIN/END in body without false extraction', () => {
        const ddl = `
            FUNCTION F (IN IV_FLAG BOOLEAN) RETURNS NVARCHAR(10) AS
            BEGIN
                DECLARE result NVARCHAR(10);
                IF IV_FLAG = TRUE THEN
                BEGIN
                    result = 'YES';
                END;
                RETURN result;
            END
        `;
        expect(inputs(ddl)).toEqual(['IV_FLAG']);
    });
});
```

**AC-7 — Block comment exclusion**

```typescript
describe('AC-7: block comment exclusion', () => {
    it('does not extract a parameter wrapped in /* … */', () => {
        const ddl = `
            FUNCTION F (
                IN IV_ACTIVE BOOLEAN
                /* , IN IV_OLD NVARCHAR(10) */
            ) RETURNS INTEGER AS BEGIN END
        `;
        const names = inputs(ddl);
        expect(names).not.toContain('IV_OLD');
        expect(names).toContain('IV_ACTIVE');
    });
});
```

**AC-8 — Line comment exclusion**

```typescript
describe('AC-8: line comment exclusion', () => {
    it('does not extract a parameter on a -- comment line', () => {
        const ddl = `
            FUNCTION F (
                IN IV_ID INTEGER
                -- , IN IV_OLD NVARCHAR(10)
            ) RETURNS INTEGER AS BEGIN END
        `;
        expect(inputs(ddl)).toEqual(['IV_ID']);
        expect(inputs(ddl)).not.toContain('IV_OLD');
    });
});
```

**AC-9 — Quoted identifier normalisation**

```typescript
describe('AC-9: quoted identifier normalisation', () => {
    it('strips double-quotes from a quoted parameter name', () => {
        const ddl = `FUNCTION F (IN "IV_CUSTOMER_ID" NVARCHAR(10)) RETURNS INTEGER AS BEGIN END`;
        expect(extractFunctionParameters(ddl)).toContainEqual({
            type: 'inputParameter',
            name: 'IV_CUSTOMER_ID'
        });
    });
});
```

**AC-10 — Schema-qualified function name**

```typescript
describe('AC-10: schema-qualified function name', () => {
    it('parses schema-qualified name without error', () => {
        const ddl = `
            FUNCTION "MY_SCHEMA"."MY_FUNCTION" (IN IV_ID INTEGER)
            RETURNS INTEGER AS BEGIN END
        `;
        expect(() => extractFunctionParameters(ddl)).not.toThrow();
        expect(inputs(ddl)).toEqual(['IV_ID']);
    });
});
```

**AC-11 — Function options are ignored**

```typescript
describe('AC-11: function option clauses do not affect extraction', () => {
    it('handles LANGUAGE SQLSCRIPT SQL SECURITY INVOKER', () => {
        const ddl = `
            FUNCTION F (IN IV_ID INTEGER)
            RETURNS INTEGER
            LANGUAGE SQLSCRIPT
            SQL SECURITY INVOKER
            AS BEGIN END
        `;
        expect(inputs(ddl)).toEqual(['IV_ID']);
    });

    it('handles SQL SECURITY DEFINER WITH ENCRYPTION', () => {
        const ddl = `
            FUNCTION F (IN IV_X NVARCHAR(10))
            RETURNS NVARCHAR(10)
            SQL SECURITY DEFINER
            WITH ENCRYPTION
            AS BEGIN END
        `;
        expect(inputs(ddl)).toEqual(['IV_X']);
    });

    it('handles DEFAULT SCHEMA option', () => {
        const ddl = `
            FUNCTION F (IN IV_X INTEGER)
            RETURNS INTEGER
            DEFAULT SCHEMA MY_SCHEMA
            AS BEGIN END
        `;
        expect(inputs(ddl)).toEqual(['IV_X']);
    });
});
```

**AC-12 — Empty parameter list**

```typescript
describe('AC-12: empty parameter list', () => {
    it('returns empty array for a function with no parameters', () => {
        const ddl = `FUNCTION F () RETURNS INTEGER AS BEGIN END`;
        expect(extractFunctionParameters(ddl)).toEqual([]);
    });
});
```

**AC-13 — CREATE keyword optional**

```typescript
describe('AC-13: CREATE keyword optional', () => {
    it('extracts identically with and without CREATE keyword', () => {
        const withCreate = `CREATE FUNCTION F (IN IV_ID INTEGER) RETURNS INTEGER AS BEGIN END`;
        const withoutCreate = `FUNCTION F (IN IV_ID INTEGER) RETURNS INTEGER AS BEGIN END`;
        expect(extractFunctionParameters(withCreate)).toEqual(extractFunctionParameters(withoutCreate));
    });
});
```

**AC-14 — Graceful error on unparseable file**

```typescript
describe('AC-14: graceful error handling', () => {
    it('does not throw on invalid syntax', () => {
        const ddl = `FUNCTION ??? GARBAGE SYNTAX`;
        expect(() => extractFunctionParameters(ddl)).not.toThrow();
    });

    it('returns an array (possibly empty) on invalid syntax', () => {
        const ddl = `FUNCTION ??? GARBAGE SYNTAX`;
        expect(Array.isArray(extractFunctionParameters(ddl))).toBe(true);
    });
});
```

**AC-15 — No regression in `.hdbprocedure` extraction**

> Validated at the integration level by running `lintFileContent()` against existing `.hdbprocedure` fixtures after the `.hdbfunction` refactor. Because `extractProcedureParameters()` is unchanged, no new unit test is required beyond verifying `content-lint.ts` still compiles correctly.

**AC-16 — Build integrity**

> Validated by `npm run build` completing with zero TypeScript errors. No unit test needed.

**AC-17 — Dead code removal**

> Validated by inspecting the final `src/content-lint.ts`: `extractProcedureFunctionParameters` must not appear. Can be enforced with a grep-based CI step or a simple `expect(source).not.toContain('extractProcedureFunctionParameters')` in a smoke test if desired.

---

## 7. Security Considerations

- **ReDoS**: `BlockComment` uses `/\/\*[\s\S]*?\*\//` (lazy quantifier). This is safe; input is file content read from disk, not user-supplied web input. Chevrotain guarantees linear-time lexing over its token stream.
- **Input size**: Chevrotain tokenises in linear time. A 5,000-line `.hdbfunction` file (including a large body) is well within the 100 ms NFR. The `functionBodyContent` MANY loop runs in O(n) token count.
- **No eval / dynamic code execution**: the grammar is defined as plain TypeScript objects; no `eval`, no `Function()`, no runtime code generation occurs anywhere in the module.
- **Dependency supply chain**: `chevrotain` is already pinned in `package-lock.json`. No new supply-chain surface is introduced by this feature.

---

## 8. Performance Considerations

- **Singleton instantiation** (NFR-3): Both `HdbFunctionLexer` and `hdbFunctionParser` are created once at module load time. Chevrotain's grammar self-analysis runs once per process lifetime, not per file.
- **Visitor allocation per file**: A new `HdbFunctionParameterVisitor` instance is created per `extractFunctionParameters()` call. Construction is O(1) and negligible.
- **Body consumption**: The `functionBodyContent` MANY loop absorbs every token in the body in a single pass via `anyBodyToken` and `nestedBlock`. The loop depth is bounded by nesting depth, which is practically small for real functions.
- **CRLF handling**: Do **not** pre-normalise CRLF→LF before tokenising. The `WhiteSpace` SKIP token (`/\s+/`) absorbs both transparently; normalisation would allocate a redundant copy of potentially large files.

---

## 9. Implementation Approach and Milestones

### Milestone 1 — Lexer (`src/parsers/hdbfunction/lexer.ts`, ~30 min)

1. Define all tokens per §3.2, observing the prefix-conflict ordering constraints (especially `Invoker` before `In`; `Timestamp` before `Time`).
2. Assemble the `allTokens` array in the required order.
3. Instantiate `HdbFunctionLexer` as a singleton.
4. Run `npm run build` — zero type errors expected.
5. Smoke-test: `HdbFunctionLexer.tokenize('FUNCTION F (IN IV_X INTEGER) RETURNS INTEGER AS BEGIN END')` — verify token sequence.

### Milestone 2 — Parser (`src/parsers/hdbfunction/parser.ts`, ~1.5 h)

1. Implement `HdbFunctionParser extends CstParser` with grammar rules per §3.3.
2. Pay special attention to:
    - `returnsClause` alternation — try `returnsTable` before `returnsScalar`; use a `GATE` or `OR` with lookahead on `TableKw` token type.
    - `parameterList` optional section (empty list is valid).
    - `functionOption*` loop — each option is unambiguous from its leading keyword; use `OR` alternatives.
    - `functionBodyContent` MANY loop — GATE must stop on `End` at the current depth; `nestedBlock` pushes depth; `parenGroup` handles `(…)`.
3. Call `this.performSelfAnalysis()` at end of constructor.
4. Instantiate singleton `hdbFunctionParser`.
5. Run `npm run build` — zero type errors expected.

### Milestone 3 — Visitor (`src/parsers/hdbfunction/visitor.ts`, ~30 min)

1. Retrieve the base visitor constructor from `hdbFunctionParser.getBaseCstVisitorConstructorWithDefaults()`.
2. Implement `HdbFunctionParameterVisitor` per §3.4, including the three no-op overrides for `tableColumnDefinition`, `returnColumnDefinition`, and `functionBody`.
3. Verify it collects names from a hard-coded CST fixture.

### Milestone 4 — Public API (`src/parsers/hdbfunction/index.ts`, ~15 min)

1. Implement `extractFunctionParameters()` per §3.5.
2. Run `npm run build` — zero errors expected.

### Milestone 5 — Integration (`src/content-lint.ts`, ~15 min)

1. Add the import for `extractFunctionParameters`.
2. Replace the `.hdbfunction` branch with the new call.
3. Delete `extractProcedureFunctionParameters()` (confirm it has no remaining callers).
4. Run `npm run build` — zero errors expected.

### Milestone 6 — Tests (`src/parsers/hdbfunction/__tests__/extractFunctionParameters.test.ts`, ~1 h)

1. Implement all test cases per §6.
2. Run `npm test` (or `npx vitest run`) — all tests green.

### Milestone 7 — Verification (~30 min)

1. Run the linter against real `.hdbfunction` files and compare output to the previous regex extractor.
2. Confirm `extractProcedureFunctionParameters` is absent from `content-lint.ts`.
3. Manually verify AC-1 through AC-17 from the PRD.

---

## 10. Risk Assessment

| Risk                                                                                                                           | Probability | Impact | Mitigation                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `returnsClause` alternation ambiguity between `returnsTable` and `returnsScalar`                                               | Medium      | Medium | Use explicit `GATE: () => this.LA(1).tokenType === TableKw` on the `returnsTable` alternative in `OR`; the leading `TABLE` token is an unambiguous discriminant                             |
| Grammar incomplete for exotic HANA function DDL constructs                                                                     | Medium      | Low    | Error recovery + graceful partial return means lint still runs; unknown option tokens are absorbed by `anyBodyToken` or Chevrotain's error recovery                                         |
| `DEFINER` / `DEFAULT` token prefix confusion                                                                                   | Low         | Low    | Both tokens diverge at position 4 (`DEFIN` vs `DEFAU`); no ordering constraint needed between them. Both declare `longer_alt: Identifier` to prevent being consumed by a longer identifier. |
| False regressions: parameters the regex extractor extracted incorrectly (body SQL, `RETURNS TABLE` columns) will now disappear | Low         | Low    | These are correct behaviour improvements, not regressions; however, any existing test fixtures written against the buggy regex output will need to be updated                               |
| Chevrotain singleton `hdbFunctionParser.input` concurrency                                                                     | N/A         | N/A    | Node.js is single-threaded; `input` assignment is safe                                                                                                                                      |
| `extractProcedureFunctionParameters` deletion breaks an unknown caller                                                         | Low         | Medium | Verify with `grep -r 'extractProcedureFunctionParameters'` before deletion; TypeScript compilation will catch any missed reference                                                          |
