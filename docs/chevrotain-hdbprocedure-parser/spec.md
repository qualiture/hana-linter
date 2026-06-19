# Technical Design Specification: Chevrotain Lexer/Parser for `.hdbprocedure`

**PRD**: [prd.md](./prd.md)  
**Feature**: Chevrotain `.hdbprocedure` Procedure Parameter Extractor  
**Status**: Ready for Implementation

---

## 1. System Architecture Overview

### Current state

`extractSubjects()` in `src/content-lint.ts` routes both `.hdbprocedure` and `.hdbfunction` files to the same regex-based function `extractProcedureFunctionParameters()`. That function scans raw file content with a single regular expression and cannot distinguish the parameter list from the procedure body.

```
content-lint.ts
  └── extractSubjects()
        ├── '.hdbtable'                         → extractTableColumns()
        ├── '.hdbview'                          → extractViewColumns()
        └── '.hdbprocedure' | '.hdbfunction'   → extractProcedureFunctionParameters()  ← regex (partially TO BE REPLACED)
```

### Target state

A new `src/parsers/hdbprocedure/` sub-module mirrors the structure of `src/parsers/hdbtable/` and `src/parsers/hdbview/`. `extractSubjects()` gains a dedicated `.hdbprocedure` branch that delegates to the new module. The `.hdbfunction` path remains on the existing regex extractor unchanged.

```
content-lint.ts
  └── extractSubjects()
        ├── '.hdbtable'       → extractTableColumns()
        ├── '.hdbview'        → extractViewColumns()
        ├── '.hdbprocedure'   → extractProcedureParameters()   ← NEW
        └── '.hdbfunction'    → extractProcedureFunctionParameters()  (regex, unchanged)

src/parsers/hdbprocedure/
  ├── lexer.ts      Token definitions + singleton Lexer instance
  ├── parser.ts     CstParser subclass + grammar rules
  ├── visitor.ts    CST visitor that collects parameter declarations
  └── index.ts      Public API: extractProcedureParameters()
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
    hdbprocedure/
      lexer.ts
      parser.ts
      visitor.ts
      index.ts
      __tests__/
        extractProcedureParameters.test.ts
```

### 3.2 `src/parsers/hdbprocedure/lexer.ts`

#### Responsibility

Define every token the grammar needs and export a singleton `Lexer` instance.

#### Token ordering rules (Chevrotain-specific)

1. Skip tokens (BlockComment, LineComment, WhiteSpace) must be declared first so they are consumed before anything else.
2. String literals must be declared before keyword tokens to avoid partial matches on quoted strings containing keyword text.
3. Keyword tokens must appear **before** `QuotedIdentifier` and `Identifier` in the `allTokens` array.
4. All keyword tokens must declare `longer_alt: Identifier` so that identifiers that start with a keyword (e.g. `INVOKER`, `INOUT_PARAM`, `LANGUAGE_CODE`) are not split at the keyword boundary.
5. Tokens with a shared prefix must be declared in **longest-first** order within the group (see prefix-conflict table below).
6. `QuotedIdentifier` must appear before `Identifier`.
7. `IntegerLiteral` must appear after `Identifier` (digits do not appear in identifier patterns, so ordering is not strictly required, but placing it last is conventional).

#### Prefix-conflict pairs requiring explicit ordering

| Longer token | Shorter token | Constraint                                                                                                                                                                |
| ------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INOUT`      | `IN`          | Declare `Inout` before `In` in `allTokens`                                                                                                                                |
| `INVOKER`    | `IN`          | Declare `Invoker` before `In` in `allTokens`                                                                                                                              |
| `INTEGER`    | (no `INT`)    | No conflict; only `INTEGER` is in the token catalogue                                                                                                                     |
| `TIMESTAMP`  | `TIME`        | Declare `Timestamp` before `Time`                                                                                                                                         |
| `SECONDDATE` | (no `SECOND`) | No conflict                                                                                                                                                               |
| `MODIFIES`   | `MODIFIES`    | No sub-prefix conflict; standalone keyword                                                                                                                                |
| `DEFINER`    | `DEFAULT`     | Both start with `DE` but diverge at 4th character; no conflict with each other. Both need `longer_alt: Identifier` to avoid being eaten by identifier starting with `DEF` |

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

**Procedure-level keyword tokens** (all with `longer_alt: Identifier`; listed in declaration order):

| Token name   | Pattern         | Notes                       |
| ------------ | --------------- | --------------------------- |
| `Inout`      | `/INOUT/i`      | Before `In`                 |
| `Invoker`    | `/INVOKER/i`    | Before `In`                 |
| `In`         | `/IN/i`         | After `Inout` and `Invoker` |
| `Out`        | `/OUT/i`        |                             |
| `Create`     | `/CREATE/i`     |                             |
| `Procedure`  | `/PROCEDURE/i`  |                             |
| `TableKw`    | `/TABLE/i`      |                             |
| `Language`   | `/LANGUAGE/i`   |                             |
| `Sqlscript`  | `/SQLSCRIPT/i`  |                             |
| `Sql`        | `/SQL/i`        |                             |
| `Security`   | `/SECURITY/i`   |                             |
| `Definer`    | `/DEFINER/i`    |                             |
| `Reads`      | `/READS/i`      |                             |
| `Modifies`   | `/MODIFIES/i`   |                             |
| `Data`       | `/DATA/i`       |                             |
| `Default`    | `/DEFAULT/i`    |                             |
| `Schema`     | `/SCHEMA/i`     |                             |
| `As`         | `/AS/i`         |                             |
| `Begin`      | `/BEGIN/i`      |                             |
| `End`        | `/END/i`        |                             |
| `With`       | `/WITH/i`       |                             |
| `Encryption` | `/ENCRYPTION/i` |                             |

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
  // Procedure keywords — prefix-conflict groups in longest-first order
  Inout, Invoker, In,          // IN-prefix group: longest first
  Out,
  Create, Procedure, TableKw,
  Language, Sqlscript,
  Sql, Security, Definer, Reads, Modifies, Data, Default, Schema,
  As, Begin, End, With, Encryption,
  // Data-type keywords — prefix-conflict groups in longest-first order
  Timestamp, Seconddate,       // TIME-prefix group: longest first
  NVarchar, VarChar, Alphanum, Shorttext,
  Integer, Bigint, Smallint, Tinyint,
  Decimal, Double, Float, Real, Boolean,
  Date, Time,                  // TIME after TIMESTAMP
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
export const HdbProcedureLexer: Lexer; // singleton — instantiated at module load
```

---

### 3.3 `src/parsers/hdbprocedure/parser.ts`

#### Responsibility

Define the grammar as a `CstParser` subclass. Expose a singleton parser instance.

#### Grammar notation

> `?` = optional, `*` = zero-or-more, `+` = one-or-more, `|` = alternation, `()` = grouping.

#### Grammar rules

```
createProcedureStatement
    CREATE? PROCEDURE procedureName
    LParen parameterList RParen
    procedureOption*
    AS procedureBody
    Semicolon?

procedureName
    identifier (Dot identifier)?
    -- identifier = Identifier | QuotedIdentifier
    -- handles both unquoted MY_PROC and quoted "MY_SCHEMA"."MY_PROCEDURE"

parameterList
    (parameterDeclaration (Comma parameterDeclaration)*)?
    -- zero or more parameters; empty list () is valid

parameterDeclaration
    parameterMode parameterName parameterType
    -- parameterMode token is what the visitor reads to determine subject type

parameterMode
    IN | OUT | INOUT

parameterName
    identifier

parameterType
    tableType | scalarType

tableType
    TABLE LParen tableColumnList RParen
    -- TABLE-type parameter; inner column list is parsed but NOT extracted

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

procedureOption
    languageOption
    | sqlSecurityOption
    | readWriteOption
    | defaultSchemaOption
    | encryptionOption

languageOption
    LANGUAGE SQLSCRIPT

sqlSecurityOption
    SQL SECURITY (INVOKER | Identifier)
    -- INVOKER and DEFINER are the standard values;
    -- Identifier catch-all handles non-standard values without failing

readWriteOption
    (READS | MODIFIES) SQL DATA

defaultSchemaOption
    DEFAULT SCHEMA identifier

encryptionOption
    WITH ENCRYPTION

procedureBody
    BEGIN procedureBodyContent END Semicolon?
    -- The body is consumed as a recursive block; its content is NEVER extracted.

procedureBodyContent
    MANY: (nestedBlock | anyBodyToken | parenGroup)
    -- Absorbs all tokens inside the body, including nested BEGIN/END pairs.
    -- Stops when the next token is END at the current nesting depth.

nestedBlock
    BEGIN procedureBodyContent END
    -- Handles nested BEGIN/END in IF/ELSE, CASE, WHILE, FOR, etc.

parenGroup
    LParen MANY:(parenGroup | anyBodyToken) RParen
    -- Handles parenthesised expressions inside the body (function calls etc.)

anyBodyToken
    -- Matches any single token except BEGIN, END, LParen, and RParen.
    -- The explicit enumeration ensures MANY in procedureBodyContent
    -- can stop correctly when it encounters END or RParen.
    (any token in allTokens except Begin, End, LParen, RParen)

identifier
    Identifier | QuotedIdentifier
```

#### Key design: procedure body isolation

The central correctness guarantee of this parser is that `parameterDeclaration` rules are parsed **before** `procedureBody` is entered. Once the parser consumes `AS`, it enters `procedureBody` which recursively swallows everything up to the matching `END`. The `IN`, `OUT`, and `INOUT` keyword tokens inside the body are consumed by `anyBodyToken` and never reach a `parameterDeclaration` rule. This eliminates the class of false-positive extractions caused by SQL predicates like `WHERE STATUS IN (...)`.

#### Key design: `nestedBlock` vs `parenGroup`

Two recursive constructs handle depth inside the body:

- **`nestedBlock`**: handles `BEGIN … END` pairs introduced by SQLScript control flow (`IF … THEN BEGIN … END`, `FOR … BEGIN … END`, etc.). The grammar must recurse here to avoid the outer `END` being consumed by the wrong nesting level.
- **`parenGroup`**: handles `(…)` parentheses (function call arguments, `IN (…)` value lists, etc.). Because `LParen`/`RParen` are excluded from `anyBodyToken`, any open `(` forces entry into `parenGroup`, which ensures the matching `)` is consumed at the correct depth.

#### Key design: `parameterMode` token visibility

`In`, `Out`, and `Inout` are keyword tokens. Because keyword tokens take priority over `Identifier` at the same length (per `longer_alt: Identifier` semantics), a parameter name like `IN_PARAM` will be correctly tokenised as `Identifier` (since `Identifier` matches all 8 characters, strictly longer than `In`'s 2-character match). The parameter name immediately following the mode keyword will always be an `Identifier` or `QuotedIdentifier`.

#### Error recovery

Use Chevrotain's default single-token insertion/deletion recovery. Do **not** override recovery methods — the defaults ensure partial CSTs are returned rather than exceptions when encountering unexpected syntax.

#### Exported symbols

```typescript
export class HdbProcedureParser extends CstParser { ... }
export const hdbProcedureParser: HdbProcedureParser; // singleton
```

---

### 3.4 `src/parsers/hdbprocedure/visitor.ts`

#### Responsibility

Walk the CST produced by `HdbProcedureParser` and emit `ExtractedSubject` entries for each `parameterDeclaration` node. Does not descend into `tableColumnList` or `procedureBody` nodes.

#### Design

The visitor extends `BaseCstVisitorWithDefaults` (obtained via `hdbProcedureParser.getBaseCstVisitorConstructorWithDefaults()`). This variant auto-visits all child nodes for any method not explicitly overridden, so only the rules we care about need to be implemented.

#### Extraction logic: `parameterDeclaration`

```typescript
parameterDeclaration(ctx: CstChildrenDictionary): void {
    // Determine mode from which mode keyword token is present.
    const isIn    = Boolean(ctx['In']?.[0]);
    const isOut   = Boolean(ctx['Out']?.[0]);
    const isInout = Boolean(ctx['Inout']?.[0]);

    // Extract the parameter name from the parameterName child rule.
    const nameNodes = ctx['parameterName'] as CstNode[] | undefined;
    if (!nameNodes?.length) return;

    const name = this.extractName(nameNodes[0]);
    if (!name) return;

    if (isIn || isInout) {
        this.parameters.push({ type: 'inputParameter', name });
    }
    if (isOut || isInout) {
        this.parameters.push({ type: 'outputParameter', name });
    }
}
```

#### Blocking `tableColumnList` extraction

`BaseCstVisitorWithDefaults` auto-visits `tableColumnDefinition` nodes. To prevent the visitor from treating column names inside TABLE-type parameters as parameter names, the visitor overrides `tableColumnDefinition` with a no-op:

```typescript
tableColumnDefinition(_ctx: CstChildrenDictionary): void {
    // Intentionally empty — inner column names of TABLE-type parameters
    // are NOT extracted as parameter subjects.
}
```

#### Blocking `procedureBody` extraction

Similarly, the visitor overrides `procedureBody`, `procedureBodyContent`, `nestedBlock`, `anyBodyToken`, and `parenGroup` with no-ops to prevent any descent into body content:

```typescript
procedureBody(_ctx: CstChildrenDictionary): void {
    // Intentionally empty — procedure body is opaque; no extraction.
}
```

Because `BaseCstVisitorWithDefaults` visits children of any non-overridden node, and `procedureBody` is the root of the body subtree, a single no-op override on `procedureBody` is sufficient to block all descent into the body.

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
export class HdbProcedureParameterVisitor { ... }
// parameters: ExtractedSubject[]  — public field read by index.ts after visit
```

---

### 3.5 `src/parsers/hdbprocedure/index.ts`

#### Responsibility

Public API boundary. Orchestrates tokenise → parse → visit.

#### Implementation

```typescript
import type { ExtractedSubject } from '../../types/issues';
import { HdbProcedureLexer } from './lexer';
import { hdbProcedureParser } from './parser';
import { HdbProcedureParameterVisitor } from './visitor';

export function extractProcedureParameters(fileContent: string): ExtractedSubject[] {
    const lexResult = HdbProcedureLexer.tokenize(fileContent);

    hdbProcedureParser.input = lexResult.tokens;

    const cst = hdbProcedureParser.createProcedureStatement();

    if (!cst) {
        return [];
    }

    const visitor = new HdbProcedureParameterVisitor();
    visitor.visit(cst);
    return visitor.parameters;
}
```

Lex and parse errors are intentionally not re-thrown. The CST visitor extracts whatever parameters were recoverable from the partial tree. Callers in `content-lint.ts` must not throw on bad input.

---

### 3.6 Changes to `src/content-lint.ts`

Two changes only:

1. **Add import** at the top alongside the existing parser imports:

    ```typescript
    import { extractProcedureParameters } from './parsers/hdbprocedure/index';
    ```

2. **Refactor** the combined `.hdbprocedure | .hdbfunction` branch in `extractSubjects()` into two separate branches:

    ```typescript
    // BEFORE
    function extractSubjects(extension: string, fileContent: string): ExtractedSubject[] {
        if (extension === '.hdbtable') {
            return extractTableColumns(fileContent);
        }
        if (extension === '.hdbview') {
            return extractViewColumns(fileContent);
        }
        if (extension === '.hdbprocedure' || extension === '.hdbfunction') {
            return extractProcedureFunctionParameters(fileContent);
        }
        return [];
    }

    // AFTER
    function extractSubjects(extension: string, fileContent: string): ExtractedSubject[] {
        if (extension === '.hdbtable') {
            return extractTableColumns(fileContent);
        }
        if (extension === '.hdbview') {
            return extractViewColumns(fileContent);
        }
        if (extension === '.hdbprocedure') {
            return extractProcedureParameters(fileContent);
        }
        if (extension === '.hdbfunction') {
            return extractProcedureFunctionParameters(fileContent);
        }
        return [];
    }
    ```

No other changes to `content-lint.ts`. `lintFileContent()`, `evaluateAllRules()`, `evaluateAnyRules()`, `LintIssue`, and the `extractProcedureFunctionParameters()` function are untouched.

---

## 4. Data Models

No new persistent data models. The only types crossing the parser boundary are the existing `ExtractedSubject` and `ContentTarget`:

```typescript
// src/types/issues.ts — already exported; no changes needed
type ExtractedSubject = {
    readonly type: ContentTarget; // 'inputParameter' | 'outputParameter'
    readonly name: string; // normalised identifier (double-quotes stripped)
};

// src/types/rules.ts — already exported; no changes needed
type ContentTarget = 'field' | 'inputParameter' | 'outputParameter';
```

---

## 5. API Specifications

### Public function

```typescript
/**
 * Extract parameter names from the content of a `.hdbprocedure` DDL file.
 *
 * Uses a Chevrotain lexer and CstParser. The parser recognises the procedure
 * header (parameter list + options) and consumes the entire procedure body
 * (AS BEGIN … END) as an opaque block, ensuring that SQL keywords IN/OUT/INOUT
 * inside the body never contaminate the extraction result.
 *
 * Each IN or INOUT parameter produces an { type: 'inputParameter', name } entry.
 * Each OUT or INOUT parameter produces an { type: 'outputParameter', name } entry.
 * An INOUT parameter therefore yields two entries (one of each type).
 *
 * Handles block/line comments, quoted and unquoted identifiers, schema-qualified
 * procedure names, TABLE-type parameters, and all standard procedure options.
 * Gracefully returns partial results on invalid input — does not throw.
 *
 * @param fileContent - Raw UTF-8 file content (LF or CRLF).
 * @returns Array of ExtractedSubject with type 'inputParameter' or 'outputParameter'.
 */
export function extractProcedureParameters(fileContent: string): ExtractedSubject[];
```

### Internal module exports (not part of public API)

| Symbol                                     | Module       | Visibility       |
| ------------------------------------------ | ------------ | ---------------- |
| `allTokens`, `HdbProcedureLexer`           | `lexer.ts`   | Package-internal |
| `HdbProcedureParser`, `hdbProcedureParser` | `parser.ts`  | Package-internal |
| `HdbProcedureParameterVisitor`             | `visitor.ts` | Package-internal |

---

## 6. Unit Test Design

Test file: `src/parsers/hdbprocedure/__tests__/extractProcedureParameters.test.ts`

The test file mirrors the structure of `extractTableColumns.test.ts` and `extractViewColumns.test.ts`: one `describe` block per acceptance criterion, using typed helper functions.

```typescript
import { describe, it, expect } from 'vitest';
import { extractProcedureParameters } from '../index';

function inputs(ddl: string): string[] {
    return extractProcedureParameters(ddl)
        .filter((s) => s.type === 'inputParameter')
        .map((s) => s.name);
}

function outputs(ddl: string): string[] {
    return extractProcedureParameters(ddl)
        .filter((s) => s.type === 'outputParameter')
        .map((s) => s.name);
}
```

### Test cases by acceptance criterion

**AC-1 — IN parameter extraction**

```typescript
describe('AC-1: IN parameter extraction', () => {
    it('extracts IN parameters as inputParameter subjects', () => {
        const ddl = `
            PROCEDURE MY_PROC (
                IN IV_CUSTOMER_ID NVARCHAR(10),
                IN IV_DATE DATE
            ) AS BEGIN END
        `;
        expect(extractProcedureParameters(ddl)).toEqual([
            { type: 'inputParameter', name: 'IV_CUSTOMER_ID' },
            { type: 'inputParameter', name: 'IV_DATE' }
        ]);
    });

    it('does not produce outputParameter entries for IN parameters', () => {
        const ddl = `PROCEDURE P (IN IV_AMOUNT DECIMAL(18,2)) AS BEGIN END`;
        expect(outputs(ddl)).toHaveLength(0);
    });
});
```

**AC-2 — OUT parameter extraction**

```typescript
describe('AC-2: OUT parameter extraction', () => {
    it('extracts OUT parameters as outputParameter subjects', () => {
        const ddl = `
            PROCEDURE MY_PROC (
                OUT EV_COUNT INTEGER,
                OUT EV_STATUS NVARCHAR(1)
            ) AS BEGIN END
        `;
        expect(extractProcedureParameters(ddl)).toEqual([
            { type: 'outputParameter', name: 'EV_COUNT' },
            { type: 'outputParameter', name: 'EV_STATUS' }
        ]);
    });

    it('does not produce inputParameter entries for OUT parameters', () => {
        const ddl = `PROCEDURE P (OUT EV_FLAG BOOLEAN) AS BEGIN END`;
        expect(inputs(ddl)).toHaveLength(0);
    });
});
```

**AC-3 — INOUT parameter yields both subject types**

```typescript
describe('AC-3: INOUT parameter yields inputParameter and outputParameter', () => {
    it('produces both types for an INOUT scalar parameter', () => {
        const ddl = `PROCEDURE P (INOUT CV_STATUS NVARCHAR(1)) AS BEGIN END`;
        expect(extractProcedureParameters(ddl)).toEqual([
            { type: 'inputParameter', name: 'CV_STATUS' },
            { type: 'outputParameter', name: 'CV_STATUS' }
        ]);
    });

    it('produces both types for an INOUT TABLE parameter', () => {
        const ddl = `PROCEDURE P (INOUT TV_RESULT TABLE (ID INTEGER)) AS BEGIN END`;
        const result = extractProcedureParameters(ddl);
        expect(result).toContainEqual({ type: 'inputParameter', name: 'TV_RESULT' });
        expect(result).toContainEqual({ type: 'outputParameter', name: 'TV_RESULT' });
    });
});
```

**AC-4 — TABLE-type parameter: inner columns not extracted**

```typescript
describe('AC-4: TABLE-type parameter columns not extracted', () => {
    it('extracts only the outer parameter name, not inner column names', () => {
        const ddl = `
            PROCEDURE P (
                IN TV_INPUT TABLE (COL1 INTEGER, COL2 NVARCHAR(100))
            ) AS BEGIN END
        `;
        const result = extractProcedureParameters(ddl);
        expect(result).toContainEqual({ type: 'inputParameter', name: 'TV_INPUT' });
        expect(result.map((s) => s.name)).not.toContain('COL1');
        expect(result.map((s) => s.name)).not.toContain('COL2');
    });

    it('handles multi-column TABLE type without extracting column names', () => {
        const ddl = `
            PROCEDURE P (
                OUT TV_OUT TABLE (
                    ID BIGINT,
                    NAME NVARCHAR(200),
                    CREATED_AT TIMESTAMP
                )
            ) AS BEGIN END
        `;
        expect(outputs(ddl)).toEqual(['TV_OUT']);
    });
});
```

**AC-5 — Procedure body SQL does not pollute extraction**

```typescript
describe('AC-5: procedure body SQL does not pollute extraction', () => {
    it('ignores IN keyword inside WHERE clause in the body', () => {
        const ddl = `
            PROCEDURE P (IN IV_ID INTEGER) AS
            BEGIN
                SELECT * FROM MY_TABLE WHERE STATUS IN ('A', 'B');
            END
        `;
        expect(inputs(ddl)).toEqual(['IV_ID']);
    });

    it('ignores OUT-like variable assignments in the body', () => {
        const ddl = `
            PROCEDURE P (OUT EV_COUNT INTEGER) AS
            BEGIN
                SELECT COUNT(*) INTO EV_COUNT FROM MY_TABLE;
            END
        `;
        expect(outputs(ddl)).toEqual(['EV_COUNT']);
    });

    it('handles nested BEGIN/END in body without false extraction', () => {
        const ddl = `
            PROCEDURE P (IN IV_FLAG BOOLEAN, OUT EV_RESULT NVARCHAR(10)) AS
            BEGIN
                IF IV_FLAG = TRUE THEN
                BEGIN
                    EV_RESULT = 'YES';
                END;
            END
        `;
        expect(inputs(ddl)).toEqual(['IV_FLAG']);
        expect(outputs(ddl)).toEqual(['EV_RESULT']);
    });
});
```

**AC-6 — Block comment exclusion**

```typescript
describe('AC-6: block comment exclusion', () => {
    it('does not extract a parameter wrapped in /* … */', () => {
        const ddl = `
            PROCEDURE P (
                IN IV_ACTIVE BOOLEAN,
                /* IN IV_OLD NVARCHAR(10), */
                OUT EV_COUNT INTEGER
            ) AS BEGIN END
        `;
        const names = extractProcedureParameters(ddl).map((s) => s.name);
        expect(names).not.toContain('IV_OLD');
        expect(names).toContain('IV_ACTIVE');
        expect(names).toContain('EV_COUNT');
    });
});
```

**AC-7 — Line comment exclusion**

```typescript
describe('AC-7: line comment exclusion', () => {
    it('does not extract a parameter on a -- comment line', () => {
        const ddl = `
            PROCEDURE P (
                IN IV_ID INTEGER
                -- , IN IV_OLD NVARCHAR(10)
            ) AS BEGIN END
        `;
        expect(inputs(ddl)).toEqual(['IV_ID']);
        expect(inputs(ddl)).not.toContain('IV_OLD');
    });
});
```

**AC-8 — Quoted identifier normalisation**

```typescript
describe('AC-8: quoted identifier normalisation', () => {
    it('strips double-quotes from quoted parameter name', () => {
        const ddl = `PROCEDURE P (IN "IV_CUSTOMER_ID" NVARCHAR(10)) AS BEGIN END`;
        expect(extractProcedureParameters(ddl)).toContainEqual({
            type: 'inputParameter',
            name: 'IV_CUSTOMER_ID'
        });
    });
});
```

**AC-9 — Schema-qualified procedure name**

```typescript
describe('AC-9: schema-qualified procedure name', () => {
    it('parses schema-qualified name without error', () => {
        const ddl = `
            PROCEDURE "MY_SCHEMA"."MY_PROCEDURE" (IN IV_ID INTEGER)
            AS BEGIN END
        `;
        expect(() => extractProcedureParameters(ddl)).not.toThrow();
        expect(inputs(ddl)).toEqual(['IV_ID']);
    });
});
```

**AC-10 — Procedure options are ignored**

```typescript
describe('AC-10: procedure option clauses do not affect extraction', () => {
    it('handles LANGUAGE SQLSCRIPT SQL SECURITY INVOKER READS SQL DATA', () => {
        const ddl = `
            PROCEDURE P (IN IV_ID INTEGER, OUT EV_NAME NVARCHAR(100))
            LANGUAGE SQLSCRIPT
            SQL SECURITY INVOKER
            READS SQL DATA
            AS BEGIN END
        `;
        expect(inputs(ddl)).toEqual(['IV_ID']);
        expect(outputs(ddl)).toEqual(['EV_NAME']);
    });

    it('handles SQL SECURITY DEFINER MODIFIES SQL DATA WITH ENCRYPTION', () => {
        const ddl = `
            PROCEDURE P (OUT EV_FLAG BOOLEAN)
            SQL SECURITY DEFINER
            MODIFIES SQL DATA
            WITH ENCRYPTION
            AS BEGIN END
        `;
        expect(outputs(ddl)).toEqual(['EV_FLAG']);
    });

    it('handles DEFAULT SCHEMA option', () => {
        const ddl = `
            PROCEDURE P (IN IV_X INTEGER)
            DEFAULT SCHEMA MY_SCHEMA
            AS BEGIN END
        `;
        expect(inputs(ddl)).toEqual(['IV_X']);
    });
});
```

**AC-11 — Empty parameter list**

```typescript
describe('AC-11: empty parameter list', () => {
    it('returns empty array for a procedure with no parameters', () => {
        const ddl = `PROCEDURE P () AS BEGIN END`;
        expect(extractProcedureParameters(ddl)).toEqual([]);
    });
});
```

**AC-12 — CREATE keyword optional**

```typescript
describe('AC-12: CREATE keyword optional', () => {
    it('extracts identically with and without CREATE keyword', () => {
        const withCreate = `CREATE PROCEDURE P (IN IV_ID INTEGER) AS BEGIN END`;
        const withoutCreate = `PROCEDURE P (IN IV_ID INTEGER) AS BEGIN END`;
        expect(extractProcedureParameters(withCreate)).toEqual(extractProcedureParameters(withoutCreate));
    });
});
```

**AC-13 — Graceful error on unparseable file**

```typescript
describe('AC-13: graceful error handling', () => {
    it('does not throw on invalid syntax', () => {
        const ddl = `PROCEDURE ??? GARBAGE SYNTAX`;
        expect(() => extractProcedureParameters(ddl)).not.toThrow();
    });

    it('returns an array (possibly empty) on invalid syntax', () => {
        const ddl = `PROCEDURE ??? GARBAGE SYNTAX`;
        expect(Array.isArray(extractProcedureParameters(ddl))).toBe(true);
    });
});
```

**AC-14 — No regression in `.hdbfunction` extraction**

> This acceptance criterion is validated at the integration level by running `lintFileContent()` against existing `.hdbfunction` fixtures after the refactor. Because `extractProcedureFunctionParameters()` is unchanged, no new unit test is required here beyond verifying `content-lint.ts` still compiles correctly.

**AC-15 — Build integrity**

> Validated by `npm run build` completing with zero TypeScript errors. No unit test needed.

---

## 7. Security Considerations

- **ReDoS**: `BlockComment` uses `/\/\*[\s\S]*?\*\//` (lazy quantifier). This is safe; input is file content read from disk, not user-supplied web input. Chevrotain guarantees linear-time lexing.
- **Input size**: Chevrotain tokenises in linear time. A 5,000-line `.hdbprocedure` file (including a large procedure body) is well within the 100 ms NFR. The `procedureBodyContent` MANY loop runs in O(n) token count.
- **No eval / dynamic code generation**: the grammar is defined as plain TypeScript objects; no `eval`, no `Function()`, no runtime code generation occurs anywhere in the module.
- **Dependency supply chain**: `chevrotain` is already pinned in `package-lock.json`. No new supply-chain surface is introduced by this feature.

---

## 8. Performance Considerations

- **Singleton instantiation** (NFR-3): Both `HdbProcedureLexer` and `hdbProcedureParser` are created once at module load time. Chevrotain's grammar self-analysis (validation for ambiguities) runs once per process lifetime, not per file.
- **Visitor allocation per file**: A new `HdbProcedureParameterVisitor` instance is created per `extractProcedureParameters()` call. Construction is O(1) and negligible.
- **Body consumption**: The `procedureBodyContent` MANY loop absorbs every token in the body in a single pass via `anyBodyToken` and `nestedBlock`. The loop depth is bounded by nesting depth, which is practically small (single digits) for real procedures.
- **CRLF handling**: Do **not** pre-normalise CRLF→LF. The `WhiteSpace` SKIP token (`/\s+/`) absorbs both transparently; normalisation would allocate a redundant copy of potentially large files.

---

## 9. Implementation Approach and Milestones

### Milestone 1 — Lexer (`src/parsers/hdbprocedure/lexer.ts`, ~45 min)

1. Define all tokens per §3.2, observing the prefix-conflict ordering constraints (especially `Inout`, `Invoker` before `In`; `Timestamp` before `Time`).
2. Assemble the `allTokens` array in the required order.
3. Instantiate `HdbProcedureLexer` as a singleton.
4. Run `npm run build` — zero type errors expected.
5. Smoke-test: `HdbProcedureLexer.tokenize('PROCEDURE P (IN IV_X INTEGER) AS BEGIN END')` — verify token sequence.

### Milestone 2 — Parser (`src/parsers/hdbprocedure/parser.ts`, ~2 h)

1. Implement `HdbProcedureParser extends CstParser` with grammar rules per §3.3.
2. Pay special attention to:
    - `parameterList` optional alternation (empty list is valid).
    - `parameterMode` consuming exactly one of `In`, `Out`, or `Inout`.
    - `procedureOption*` loop — use `GATE` or `OR` with lookahead to avoid infinite recursion; each option alternative is unambiguous from its leading keyword.
    - `procedureBodyContent` MANY loop — GATE must stop on `End` at the current depth; `nestedBlock` pushes depth; `parenGroup` handles `(…)`.
3. Call `this.performSelfAnalysis()` at end of constructor.
4. Instantiate singleton `hdbProcedureParser`.
5. Run `npm run build` — zero type errors expected.
6. Address any ambiguity warnings from Chevrotain's self-analysis output.

### Milestone 3 — Visitor (`src/parsers/hdbprocedure/visitor.ts`, ~45 min)

1. Retrieve the base visitor constructor from `hdbProcedureParser.getBaseCstVisitorConstructorWithDefaults()`.
2. Implement `HdbProcedureParameterVisitor` per §3.4:
    - `parameterDeclaration` override to detect mode and extract name.
    - `tableColumnDefinition` no-op override.
    - `procedureBody` no-op override (blocks all body descent).
    - `extractName` private helper.
3. Call `this.validateVisitor()` in the constructor.
4. Verify all visitor method names exactly match parser rule names (case-sensitive; Chevrotain enforces this at runtime via `validateVisitor()`).

### Milestone 4 — Public API & integration (`src/parsers/hdbprocedure/index.ts` + `content-lint.ts`, ~20 min)

1. Implement `extractProcedureParameters()` per §3.5.
2. Update `content-lint.ts` per §3.6: split the combined branch into separate `.hdbprocedure` and `.hdbfunction` guards.
3. Run `npm run build` — zero type errors expected.

### Milestone 5 — Unit tests (`__tests__/extractProcedureParameters.test.ts`, ~1 h)

1. Create test file per §6.
2. Run `npm test` — all tests expected to pass.
3. Verify no regressions in existing `extractTableColumns` and `extractViewColumns` test suites.

---

## 10. Risk Assessment

| Risk                                                                                                    | Probability | Impact | Mitigation                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------- | ----------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Nested `BEGIN/END` in the body causes `nestedBlock` recursion to mis-match depth                        | Medium      | High   | Write targeted unit tests with deeply nested IF/BEGIN/END and FOR/BEGIN/END bodies; the recursive grammar handles arbitrary depth by design                                    |
| Chevrotain ambiguity warning on `procedureOption*` MANY loop vs `As` leading into `procedureBody`       | Medium      | Medium | Add GATE on `procedureOption` MANY: check that `LA(1)` is one of the option-leading keywords (`LANGUAGE`, `SQL`, `READS`, `MODIFIES`, `DEFAULT`, `WITH`) before each iteration |
| `SQLSCRIPT` is not a data-type keyword but could be an identifier; Sqlscript token not matched          | Low         | Low    | `Sqlscript` has `longer_alt: Identifier`; if a user names a parameter `SQLSCRIPT_PARAM` it correctly becomes `Identifier`                                                      |
| `.hdbprocedure` files that use `DECLARE` variable blocks before `BEGIN` (non-standard dialect)          | Low         | Low    | `procedureOption*` is a loose consumer; unrecognised tokens between `)` and `AS` trigger error recovery, returning partial results rather than crashing                        |
| False regressions: parameters the regex extractor extracted incorrectly (false positives) now disappear | Low         | Low    | These disappearances are correct behaviour; review existing tests written against the regex output and update them to reflect the now-accurate results                         |
| `hdbProcedureParser.input` assignment is not re-entrant                                                 | N/A         | N/A    | Node.js is single-threaded; no concurrent access concern                                                                                                                       |
