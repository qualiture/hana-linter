# Technical Design Specification: Chevrotain Lexer/Parser for `.hdbview`

**PRD**: [prd.md](./prd.md)  
**Feature**: Chevrotain `.hdbview` View Column Extractor  
**Status**: Ready for Implementation

---

## 1. System Architecture Overview

### Current state

`extractSubjects()` in `src/content-lint.ts` has no handler for `.hdbview` files; the function falls through to `return []`, silently producing no subjects regardless of any configured `contentRuleSets`.

```
content-lint.ts
  └── extractSubjects()
        ├── '.hdbtable'  → extractTableColumns()   (implemented)
        ├── '.hdbprocedure' | '.hdbfunction'  → extractProcedureFunctionParameters()
        └── (default)   → []                       ← .hdbview falls here
```

### Target state

A new `src/parsers/hdbview/` sub-module mirrors the structure of `src/parsers/hdbtable/`. `extractSubjects()` gains a `.hdbview` branch that delegates to the new module's public function.

```
content-lint.ts
  └── extractSubjects()
        ├── '.hdbtable'  → extractTableColumns()
        ├── '.hdbview'   → extractViewColumns()    ← NEW
        └── '.hdbprocedure' | '.hdbfunction'  → extractProcedureFunctionParameters()

src/parsers/hdbview/
  ├── lexer.ts      Token definitions + singleton Lexer instance
  ├── parser.ts     CstParser subclass + grammar rules
  ├── visitor.ts    CST visitor that collects column aliases
  └── index.ts      Public API: extractViewColumns()
```

Everything above `extractSubjects()` is unchanged: `lintFileContent()`, `runLint()`, `LintIssue`, and the public `src/index.ts` entry point.

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
    hdbview/
      lexer.ts
      parser.ts
      visitor.ts
      index.ts
      __tests__/
        extractViewColumns.test.ts
```

### 3.2 `src/parsers/hdbview/lexer.ts`

#### Responsibility

Define every token the grammar needs and export a singleton `Lexer` instance.

#### Token ordering rules (Chevrotain-specific)

1. Skip tokens (BlockComment, LineComment, WhiteSpace) must be declared first.
2. Keywords with a shared prefix must appear in longest-first order (see prefix-conflict pairs below).
3. All keyword tokens must declare `longer_alt: Identifier` so that identifiers starting with a keyword (e.g., `INTERSECTING`) are not split at the keyword boundary.
4. `QuotedIdentifier` must appear before `Identifier`.
5. `IntegerLiteral` and `DecimalLiteral` must appear after all keywords.

#### Prefix-conflict pairs requiring explicit ordering

| Longer token | Shorter token | Constraint                                       |
| ------------ | ------------- | ------------------------------------------------ |
| `INTERSECT`  | `INNER`, `IN` | Declare `Intersect`, `Inner`, `In` in that order |
| `ORDER`      | `OR`          | Declare `Order` before `Or`                      |
| `OPTION`     | `ONLY`, `ON`  | Declare `Option`, `Only`, `On` in that order     |

In addition, `longer_alt` chains handle the identifier boundary: `In` should declare `longer_alt: [Inner, Intersect, Identifier]` as described below.

#### Token catalogue

**Skip tokens** (declared first):

| Token name     | Pattern              | Mode                       |
| -------------- | -------------------- | -------------------------- |
| `BlockComment` | `/\/\*[\s\S]*?\*\//` | `{ group: Lexer.SKIPPED }` |
| `LineComment`  | `/--[^\r\n]*/`       | `{ group: Lexer.SKIPPED }` |
| `WhiteSpace`   | `/\s+/`              | `{ group: Lexer.SKIPPED }` |

**DDL/DML keyword tokens** (all declare `longer_alt: Identifier`):

| Token name  | Pattern        | Notes                         |
| ----------- | -------------- | ----------------------------- |
| `Create`    | `/CREATE/i`    |                               |
| `ViewKw`    | `/VIEW/i`      |                               |
| `As`        | `/AS/i`        |                               |
| `Select`    | `/SELECT/i`    |                               |
| `Distinct`  | `/DISTINCT/i`  |                               |
| `All`       | `/ALL/i`       |                               |
| `Top`       | `/TOP/i`       |                               |
| `From`      | `/FROM/i`      |                               |
| `Where`     | `/WHERE/i`     |                               |
| `Group`     | `/GROUP/i`     |                               |
| `By`        | `/BY/i`        |                               |
| `Having`    | `/HAVING/i`    |                               |
| `Intersect` | `/INTERSECT/i` | Before `Inner` and `In`       |
| `Inner`     | `/INNER/i`     | Before `In`                   |
| `In`        | `/IN/i`        | After `Intersect` and `Inner` |
| `Join`      | `/JOIN/i`      |                               |
| `Left`      | `/LEFT/i`      |                               |
| `Right`     | `/RIGHT/i`     |                               |
| `Full`      | `/FULL/i`      |                               |
| `Outer`     | `/OUTER/i`     |                               |
| `Cross`     | `/CROSS/i`     |                               |
| `Order`     | `/ORDER/i`     | Before `Or`                   |
| `Or`        | `/OR/i`        | After `Order`                 |
| `Union`     | `/UNION/i`     |                               |
| `Except`    | `/EXCEPT/i`    |                               |
| `Option`    | `/OPTION/i`    | Before `Only` and `On`        |
| `Only`      | `/ONLY/i`      | Before `On`                   |
| `On`        | `/ON/i`        | After `Option` and `Only`     |
| `With`      | `/WITH/i`      |                               |
| `Read`      | `/READ/i`      |                               |
| `Check`     | `/CHECK/i`     |                               |
| `Case`      | `/CASE/i`      |                               |
| `When`      | `/WHEN/i`      |                               |
| `Then`      | `/THEN/i`      |                               |
| `Else`      | `/ELSE/i`      |                               |
| `End`       | `/END/i`       |                               |
| `Not`       | `/NOT/i`       |                               |
| `Null`      | `/NULL/i`      |                               |
| `And`       | `/AND/i`       |                               |
| `Is`        | `/IS/i`        |                               |
| `Between`   | `/BETWEEN/i`   |                               |
| `Like`      | `/LIKE/i`      |                               |
| `Exists`    | `/EXISTS/i`    |                               |
| `Asc`       | `/ASC/i`       |                               |
| `Desc`      | `/DESC/i`      |                               |
| `Limit`     | `/LIMIT/i`     |                               |

**Identifier tokens** (declared after all keywords):

| Token name         | Pattern                    | Notes                                                  |
| ------------------ | -------------------------- | ------------------------------------------------------ |
| `QuotedIdentifier` | `/"[^"]*"/`                | Declared **before** `Identifier`                       |
| `Identifier`       | `/[A-Za-z_][A-Za-z0-9_]*/` | Catch-all; all keyword tokens use `longer_alt` to this |

**Literal tokens** (declared after identifiers):

| Token name       | Pattern      |
| ---------------- | ------------ | --------- |
| `IntegerLiteral` | `/[0-9]+/`   |
| `StringLiteral`  | `/'(?:[^'\\] | \\.)\*'/` |

**Punctuation and operator tokens:**

| Token name     | Pattern | Notes                                        |
| -------------- | ------- | -------------------------------------------- |
| `LParen`       | `\(`    |                                              |
| `RParen`       | `\)`    |                                              |
| `Comma`        | `,`     |                                              |
| `Semicolon`    | `;`     |                                              |
| `Dot`          | `\.`    |                                              |
| `Star`         | `\*`    |                                              |
| `Plus`         | `\+`    |                                              |
| `Minus`        | `-`     |                                              |
| `Slash`        | `/`     |                                              |
| `NotEqual`     | `<>`    | Declared before `LessThan` and `GreaterThan` |
| `LessEqual`    | `<=`    | Declared before `LessThan`                   |
| `GreaterEqual` | `>=`    | Declared before `GreaterThan`                |
| `LessThan`     | `<`     | After `NotEqual` and `LessEqual`             |
| `GreaterThan`  | `>`     | After `NotEqual` and `GreaterEqual`          |
| `Equals`       | `=`     |                                              |
| `Concat`       | `\|\|`  | String concatenation operator                |

#### `allTokens` array ordering (summary)

```
[
  // Skip
  BlockComment, LineComment, WhiteSpace,
  // String literal (before identifiers — avoids partial matches)
  StringLiteral,
  // DDL/DML keywords (longer_alt: Identifier; prefix-conflicts in order)
  Create, ViewKw, As, Select, Distinct, All, Top,
  From, Where, Group, By, Having,
  Intersect, Inner, In,         // IN prefix group: longest first
  Join, Left, Right, Full, Outer, Cross,
  Order, Or,                    // OR prefix group: longest first
  Union, Except,
  Option, Only, On,             // ON prefix group: longest first
  With, Read, Check,
  Case, When, Then, Else, End,
  Not, Null, And, Is, Between, Like, Exists,
  Asc, Desc, Limit,
  // Identifiers (catch-all — after all keywords)
  QuotedIdentifier, Identifier,
  // Numeric literal — after identifiers
  IntegerLiteral,
  // Multi-char operators before single-char sharing a prefix
  Concat, NotEqual, LessEqual, GreaterEqual,
  // Remaining punctuation
  LParen, RParen, Comma, Semicolon, Dot,
  Star, Plus, Minus, Slash,
  LessThan, GreaterThan, Equals
]
```

#### Exported symbols

```typescript
export const allTokens: TokenType[];
export const HdbViewLexer: Lexer; // singleton — instantiated at module load
```

---

### 3.3 `src/parsers/hdbview/parser.ts`

#### Responsibility

Define the grammar as a `CstParser` subclass. Expose a singleton parser instance.

#### Grammar notation

> `?` = optional, `*` = zero-or-more, `+` = one-or-more, `|` = alternation, `()` = grouping.

#### Grammar rules

```
createViewStatement
    CREATE? VIEW viewName explicitColumnList? AS selectStatement viewOptions? Semicolon?

viewName
    identifier (Dot identifier)?
    -- identifier = Identifier | QuotedIdentifier
    -- handles both unquoted MY_VIEW and quoted "MY_SCHEMA"."V_MY_VIEW"

explicitColumnList
    LParen identifier (Comma identifier)* RParen
    -- column names as declared, e.g. ("ID", "NAME")
    -- ONLY present when the view header has a column list before AS

selectStatement
    SELECT (DISTINCT | ALL | TOP IntegerLiteral)? selectList
    fromClause
    whereClause?
    groupByClause?
    havingClause?
    orderByClause?
    unionClause?

selectList
    Star
    | selectItem (Comma selectItem)*

selectItem
    selectExpression (AS identifier)?
    -- selectExpression consumes expression tokens greedily (see below)
    -- AS identifier is the alias; visitor extracts identifier when present

selectExpression
    MANY (GATE: next token is not a selectItemTerminator):
        parenGroup | anyToken
    -- "selectItemTerminator" at depth 0:
    --   AS, Comma, RParen, From, Where, Group, Having, Order,
    --   Union, Intersect, Except, Limit
    -- parenGroup consumes balanced (…) including any inner AS or commas,
    --   so CAST(x AS type), COUNT(*), CASE…END inside parens are safe

fromClause
    FROM fromItem (join fromItem)*

fromItem
    subquery alias
    | viewName alias?

subquery
    LParen selectStatement RParen
    -- !! visitor overrides this rule and does nothing —
    --    preventing extraction of aliases inside derived tables

alias
    AS? identifier

join
    (INNER | ((LEFT | RIGHT | FULL) OUTER?) | CROSS)? JOIN fromItem ON expression

expression
    -- loosely consumed (same GATE strategy as selectExpression)
    -- used in WHERE, ON, HAVING, and ORDER BY items
    MANY (GATE: next token is not an expressionTerminator):
        parenGroup | anyToken
    -- "expressionTerminator": Comma, RParen, Where, Group, Having,
    --   Order, Union, Intersect, Except, Semicolon, Limit,
    --   And, Or (depth 0 only — tracked externally via parenGroup nesting)

whereClause
    WHERE expression

groupByClause
    GROUP BY expression (Comma expression)*

havingClause
    HAVING expression

orderByClause
    ORDER BY orderItem (Comma orderItem)*

orderItem
    expression (ASC | DESC)?

unionClause
    (UNION ALL? | INTERSECT | EXCEPT) selectStatement

viewOptions
    WITH READ ONLY
    | WITH CHECK OPTION

parenGroup
    LParen
        MANY: parenGroup | anyToken   (stop when next is RParen)
    RParen
    -- handles nested parens of arbitrary depth

identifier
    Identifier | QuotedIdentifier

anyToken
    -- OR over every token type except LParen and RParen
    -- used inside parenGroup and selectExpression to consume opaque tokens
```

#### Key disambiguation: `fromItem` — subquery vs table reference

Both alternatives begin with either `LParen` (subquery) or an `Identifier`/`QuotedIdentifier` (table reference). Chevrotain resolves this with a 1-token lookahead:

- `FIRST(subquery)` = `{ LParen }`
- `FIRST(viewName)` = `{ Identifier, QuotedIdentifier }`

The sets are disjoint → LL(1) lookahead is sufficient.

#### Key design: `selectExpression` stop conditions

The `selectExpression` MANY loop uses a GATE predicate. The gate must stop at `AS` (which signals the alias), but also at any top-level clause keyword. Because `parenGroup` recurses to consume balanced parentheses before the GATE is re-evaluated, tokens inside `(…)` never trigger a false stop:

- `CAST(x AS INTEGER)` → `CAST` consumed by `anyToken`, then `(x AS INTEGER)` consumed by `parenGroup` (inner `AS` is absorbed), then outer `AS MY_ALIAS` triggers gate stop correctly.
- `CASE WHEN … THEN … ELSE … END` — The `CASE` keyword and its body are consumed by `anyToken` iterations (no parentheses), until `AS <alias>` triggers gate stop. This works correctly as long as CASE/WHEN/THEN/ELSE/END tokens are not declared as stop tokens in the gate (they are not in the list above).

#### Error recovery

Use Chevrotain's default single-token insertion/deletion recovery. Do **not** override recovery methods — the defaults are adequate for DDL/DML recovery and ensure partial CSTs are returned instead of exceptions.

#### Exported symbols

```typescript
export class HdbViewParser extends CstParser { ... }
export const hdbViewParser: HdbViewParser;  // singleton
```

---

### 3.4 `src/parsers/hdbview/visitor.ts`

#### Responsibility

Walk the CST produced by `HdbViewParser` and collect the column aliases exposed by the view, implementing the two-mode extraction strategy from the PRD.

#### Extraction strategy

The visitor reads the `createViewStatement` CST node and branches on the presence of `explicitColumnList`:

```
if CST contains an explicitColumnList node:
    → extract identifiers from explicitColumnList only
    → do NOT descend into selectStatement (selectItem aliases are irrelevant)
else:
    → extract AS alias identifiers from top-level selectItem nodes only
    → do NOT recurse into subquery nodes (subquery aliases are not view columns)
```

#### Implementation detail: blocking subquery recursion

The visitor extends `BaseCstVisitorWithDefaults`, which auto-visits all child `CstNode` elements for any method not explicitly overridden. To prevent extraction of aliases from derived-table subqueries in the `FROM` clause, the visitor overrides the `subquery` rule method and performs **no action** (no `super` call, no child visit):

```typescript
subquery(_ctx: CstChildrenDictionary): void {
    // Intentionally empty — do not recurse into derived-table SELECT bodies.
}
```

#### Implementation detail: explicit-column-list mode

When the visitor detects an `explicitColumnList` node, it overrides `createViewStatement` to handle the two-mode split:

```typescript
createViewStatement(ctx: CstChildrenDictionary): void {
    if (ctx['explicitColumnList']) {
        // Mode 1: column names are declared in the list
        this.visit(ctx['explicitColumnList'] as CstNode[]);
        // Do not visit selectStatement — avoids double-extraction
    } else {
        // Mode 2: column names come from AS aliases in the SELECT clause
        if (ctx['selectStatement']) {
            this.visit(ctx['selectStatement'] as CstNode[]);
        }
    }
}
```

In mode 1, the visitor also overrides `explicitColumnList` to collect the `identifier` children:

```typescript
explicitColumnList(ctx: CstChildrenDictionary): void {
    const identifiers = ctx['identifier'] as CstNode[] | undefined;
    if (!identifiers) return;
    for (const node of identifiers) {
        this.extractIdentifier(node);
    }
}
```

#### Implementation detail: SELECT alias extraction (mode 2)

The visitor overrides `selectItem` to extract only the alias (the `AS identifier` portion), not the expression:

```typescript
selectItem(ctx: CstChildrenDictionary): void {
    // ctx['identifier'] is the alias identifier node from "AS identifier"
    // Only present if the selectItem had an AS clause.
    const aliasNodes = ctx['identifier'] as CstNode[] | undefined;
    if (!aliasNodes || aliasNodes.length === 0) {
        return; // no AS alias — silently skip (per US-8/AC-9)
    }
    // The single identifier from the AS clause
    this.extractIdentifier(aliasNodes[0]);
}
```

#### Implementation detail: identifier normalisation

A shared private helper strips surrounding double-quotes and pushes to `this.columns`:

```typescript
private extractIdentifier(node: CstNode): void {
    if (!node.children) return;
    const token =
        (node.children['Identifier']?.[0] as IToken | undefined) ??
        (node.children['QuotedIdentifier']?.[0] as IToken | undefined);
    if (!token) return;
    const raw = token.image;
    const name = raw.startsWith('"') ? raw.slice(1, -1) : raw;
    this.columns.push({ type: 'field', name });
}
```

#### Exported symbols

```typescript
export class HdbViewColumnVisitor { ... }
// columns: ExtractedSubject[]  — public field read by index.ts after visit
```

---

### 3.5 `src/parsers/hdbview/index.ts`

#### Responsibility

Public API boundary. Orchestrates tokenise → parse → visit.

#### Implementation

```typescript
import type { ExtractedSubject } from '../../types/issues';
import { HdbViewLexer } from './lexer';
import { hdbViewParser } from './parser';
import { HdbViewColumnVisitor } from './visitor';

export function extractViewColumns(fileContent: string): ExtractedSubject[] {
    const lexResult = HdbViewLexer.tokenize(fileContent);

    hdbViewParser.input = lexResult.tokens;
    const cst = hdbViewParser.createViewStatement();

    if (!cst) {
        return [];
    }

    const visitor = new HdbViewColumnVisitor();
    visitor.visit(cst);
    return visitor.columns;
}
```

Lex/parse errors are intentionally not re-thrown. The CST visitor will extract whatever columns were recoverable from the partial tree. Callers in `content-lint.ts` must not throw on bad input.

---

### 3.6 Changes to `src/content-lint.ts`

Two changes only:

1. **Add import** at the top alongside the existing `extractTableColumns` import:

    ```typescript
    import { extractViewColumns } from './parsers/hdbview/index';
    ```

2. **Add branch** inside `extractSubjects()`:

    ```typescript
    // BEFORE
    function extractSubjects(extension: string, fileContent: string): ExtractedSubject[] {
        if (extension === '.hdbtable') {
            return extractTableColumns(fileContent);
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
        if (extension === '.hdbprocedure' || extension === '.hdbfunction') {
            return extractProcedureFunctionParameters(fileContent);
        }
        return [];
    }
    ```

No other changes to `content-lint.ts`. `lintFileContent()`, `evaluateAllRules()`, `evaluateAnyRules()`, and the `LintIssue` type are untouched.

---

## 4. Data Models

No new persistent data models. The only type crossing the parser boundary is the existing `ExtractedSubject` (already in `src/types/issues.ts`):

```typescript
type ExtractedSubject = {
    readonly type: ContentTarget; // 'field' for view column aliases
    readonly name: string; // normalised identifier (double-quotes stripped)
};
```

All view column aliases are reported with `type: 'field'`, consistent with `.hdbtable` column subjects.

---

## 5. API Specifications

### Public function

```typescript
/**
 * Extract column alias names from the content of a `.hdbview` DDL file.
 *
 * Uses a Chevrotain lexer and CstParser. Handles block/line comments,
 * multi-line expressions, quoted and unquoted identifiers, schema-qualified
 * view names, subquery isolation, and both extraction modes:
 *   - Explicit column list:  VIEW V ("A","B") AS SELECT ...
 *   - SELECT-clause aliases: VIEW V AS SELECT T.X AS "A", T.Y AS "B" FROM T
 *
 * Gracefully returns partial results on invalid input — does not throw.
 *
 * @param fileContent - Raw UTF-8 file content (LF or CRLF).
 * @returns Array of ExtractedSubject with type 'field' for each alias.
 */
export function extractViewColumns(fileContent: string): ExtractedSubject[];
```

### Internal module exports (not part of public API)

| Symbol                           | Module       | Visibility       |
| -------------------------------- | ------------ | ---------------- |
| `allTokens`, `HdbViewLexer`      | `lexer.ts`   | Package-internal |
| `HdbViewParser`, `hdbViewParser` | `parser.ts`  | Package-internal |
| `HdbViewColumnVisitor`           | `visitor.ts` | Package-internal |

---

## 6. Unit Test Design

Test file: `src/parsers/hdbview/__tests__/extractViewColumns.test.ts`

The test file mirrors the structure of `extractTableColumns.test.ts`: one `describe` block per acceptance criterion, using a `names()` helper.

```typescript
function names(ddl: string): string[] {
    return extractViewColumns(ddl).map((s) => s.name);
}
```

### Test cases by acceptance criterion

**AC-1 — Explicit column list extraction**

```typescript
it('extracts column names from explicit column list, not SELECT aliases', () => {
    const ddl = `VIEW V_FOO ("ID", "NAME") AS SELECT T."CUST_ID", T."CUST_NAME" FROM T`;
    expect(names(ddl)).toEqual(['ID', 'NAME']);
    expect(names(ddl)).not.toContain('CUST_ID');
});
```

**AC-2 — SELECT alias extraction (no explicit column list)**

```typescript
it('extracts AS aliases from top-level SELECT when no column list present', () => {
    const ddl = `VIEW V_BAR AS SELECT T."CUST_ID" AS "ID", T."CUST_NAME" AS "NAME" FROM T`;
    expect(extractViewColumns(ddl)).toEqual([
        { type: 'field', name: 'ID' },
        { type: 'field', name: 'NAME' }
    ]);
});
```

**AC-3 — Subquery alias exclusion**

```typescript
it('does not extract aliases from subqueries in the FROM clause', () => {
    const ddl = `
        VIEW V_BAZ AS SELECT S."X" AS "MY_COL"
        FROM (SELECT "A" AS "X" FROM "T") S
    `;
    expect(names(ddl)).toEqual(['MY_COL']);
    expect(names(ddl)).not.toContain('X');
    expect(names(ddl)).not.toContain('A');
});
```

**AC-4 — Block comment exclusion**

```typescript
it('does not extract an alias wrapped in /* … */', () => {
    const ddl = `
        VIEW V AS SELECT
            T."ID" AS "ID",
            /* T."OLD" AS "GHOST", */
            T."NAME" AS "NAME"
        FROM T
    `;
    expect(names(ddl)).not.toContain('GHOST');
    expect(names(ddl)).toContain('ID');
    expect(names(ddl)).toContain('NAME');
});
```

**AC-5 — Line comment exclusion**

```typescript
it('does not extract an alias appearing only in a -- comment', () => {
    const ddl = `
        VIEW V AS SELECT
            T."ID" AS "ID"
            -- , T."OLD" AS "OLD_COL"
        FROM T
    `;
    expect(names(ddl)).not.toContain('OLD_COL');
});
```

**AC-6 — Quoted identifier normalisation**

```typescript
it('strips double-quotes from quoted aliases', () => {
    const ddl = `VIEW V AS SELECT T.X AS "MY_ALIAS" FROM T`;
    expect(extractViewColumns(ddl)).toContainEqual({ type: 'field', name: 'MY_ALIAS' });
});
```

**AC-7 — Schema-qualified view name**

```typescript
it('parses schema-qualified view name without error', () => {
    const ddl = `VIEW "MY_SCHEMA"."V_MY_VIEW" AS SELECT T.X AS "COL" FROM T`;
    expect(() => extractViewColumns(ddl)).not.toThrow();
    expect(names(ddl)).toEqual(['COL']);
});
```

**AC-8 — `WITH READ ONLY` trailing clause**

```typescript
it('handles WITH READ ONLY without affecting column extraction', () => {
    const ddl = `VIEW V AS SELECT T.X AS "COL" FROM T WITH READ ONLY`;
    expect(names(ddl)).toEqual(['COL']);
});
```

**AC-9 — Unaliased SELECT item silently skipped**

```typescript
it('skips SELECT items with no AS alias when no explicit column list', () => {
    const ddl = `VIEW V AS SELECT T."RAW_FIELD" FROM T`;
    expect(names(ddl)).toEqual([]);
});
```

**AC-10 — CREATE keyword optional**

```typescript
it('extracts columns when CREATE keyword is absent', () => {
    const withCreate = `CREATE VIEW V AS SELECT T.X AS "COL" FROM T`;
    const withoutCreate = `VIEW V AS SELECT T.X AS "COL" FROM T`;
    expect(names(withCreate)).toEqual(names(withoutCreate));
});
```

**AC-11 — Graceful error on unparseable file**

```typescript
it('does not throw on invalid syntax; returns partial or empty result', () => {
    const ddl = `VIEW V AS SELECT ??? GARBAGE SYNTAX`;
    expect(() => extractViewColumns(ddl)).not.toThrow();
});
```

---

## 7. Security Considerations

- **ReDoS**: `BlockComment` uses `/\/\*[\s\S]*?\*\//` (lazy quantifier). This is safe; input is file content read from disk, not user-supplied web input. Linear-time lexing is Chevrotain's documented guarantee.
- **Input size**: Chevrotain tokenises in linear time. A 5,000-line `.hdbview` file is well within the 100 ms NFR.
- **No eval / dynamic code generation**: the grammar is defined as plain TypeScript objects; no `eval`, no `Function()`, no runtime code generation.
- **Dependency supply chain**: `chevrotain` is already present and pinned in `package-lock.json`. No new supply-chain surface is introduced.

---

## 8. Performance Considerations

- **Singleton instantiation** (NFR-3): both `HdbViewLexer` and `hdbViewParser` are created once at module load time. Chevrotain's grammar self-analysis (validation of the grammar for ambiguities) runs once per process, not per file.
- **Visitor allocation per file**: a new `HdbViewColumnVisitor` instance is created per `extractViewColumns()` call. Construction is O(1) and negligible.
- **CRLF handling**: do **not** pre-normalise CRLF→LF. The `WhiteSpace` SKIP token (`/\s+/`) absorbs both transparently; normalisation would allocate a second copy of large strings unnecessarily.
- **Expression consumption**: the `selectExpression` MANY loop with a GATE predicate runs in O(n) token count. For typical `.hdbview` files (tens to hundreds of SELECT items) this is well within budget.

---

## 9. Implementation Approach and Milestones

### Milestone 1 — Lexer (`src/parsers/hdbview/lexer.ts`, ~1 h)

1. Define all tokens per §3.2, observing the prefix-conflict ordering constraints.
2. Assemble the `allTokens` array in the required order.
3. Instantiate `HdbViewLexer` as a singleton.
4. Run `npm run build` — zero type errors expected.
5. Smoke-test with `HdbViewLexer.tokenize('VIEW V AS SELECT T.X AS "COL" FROM T')` — verify token sequence in a quick script or test.

### Milestone 2 — Parser (`src/parsers/hdbview/parser.ts`, ~2.5 h)

1. Implement `HdbViewParser extends CstParser` with grammar rules per §3.3.
2. Pay special attention to:
    - `selectExpression` GATE predicate listing all stop tokens.
    - `fromItem` OR alternation (subquery first, viewName second).
    - `unionClause` recursive call to `selectStatement`.
3. Call `this.performSelfAnalysis()` at end of constructor.
4. Instantiate singleton `hdbViewParser`.
5. Run `npm run build` — zero type errors expected.
6. Address any ambiguity warnings from Chevrotain's self-analysis output.

### Milestone 3 — Visitor (`src/parsers/hdbview/visitor.ts`, ~1 h)

1. Retrieve the base visitor constructor from `hdbViewParser.getBaseCstVisitorConstructorWithDefaults()`.
2. Implement `HdbViewColumnVisitor` per §3.4:
    - Two-mode `createViewStatement` override.
    - `explicitColumnList` override for mode 1.
    - `selectItem` override for mode 2.
    - `subquery` override (no-op) to block recursion.
    - `extractIdentifier` private helper.
3. Call `this.validateVisitor()` in the constructor.
4. Verify visitor method names exactly match parser rule names (case-sensitive).

### Milestone 4 — Public API & integration (~30 min)

1. Implement `extractViewColumns()` in `src/parsers/hdbview/index.ts` per §3.5.
2. Update `src/content-lint.ts` per §3.6 (import + new branch).
3. Run `npm run build` — zero type errors expected.

### Milestone 5 — Unit tests (~1.5 h)

1. Create `src/parsers/hdbview/__tests__/extractViewColumns.test.ts` with all AC test cases per §6.
2. Run `npm test` — all tests pass expected.
3. Run `npm run coverage` and verify the new module has ≥ 90 % branch coverage.

### Milestone 6 — Integration verification (~30 min)

1. Run `hana-linter` against a real project containing `.hdbview` files.
2. Confirm that configured `contentRuleSets` for `.hdbview` produce issues for non-conforming column aliases and no issues for conforming ones.

---

## 10. Risk Assessment

| Risk                                                                                              | Probability | Impact | Mitigation                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------- | ----------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complex SQL expressions (CASE/WHEN, window functions) break the `selectExpression` GATE logic     | Medium      | Medium | `parenGroup` absorbs balanced `(…)` opaquely; CASE/WHEN tokens are not declared as stop tokens. If a specific construct fails, add a targeted test and adjust the stop-token list.      |
| `UNION ALL` / compound SELECT: secondary SELECT items are extracted when they should not be       | Low         | Low    | `unionClause` recurses into `selectStatement`; in mode-2 the visitor visits `selectStatement` children. Override `unionClause` to no-op if this proves to be an issue.                  |
| Visitor method name mismatch (e.g. `selectItem` vs `SelectItem`) causes silent skip               | Low         | Medium | `this.validateVisitor()` in the constructor throws at construction time if a method name does not correspond to a grammar rule — catches typos before any test runs.                    |
| `fromItem` ambiguity: a view named `SELECT` or a keyword-named table reference confuses the lexer | Very Low    | Low    | All keyword tokens use `longer_alt: Identifier`; a quoted `"SELECT"` is always a `QuotedIdentifier` token. Unquoted keyword-named objects are a HANA restriction, not a parser concern. |
| Performance regression for very large views (thousands of JOIN clauses)                           | Very Low    | Low    | Chevrotain tokenises and parses in linear time; `selectExpression` GATE is O(1) per token. Even a 5,000-line file is well within the 100 ms NFR.                                        |
| Chevrotain singleton `hdbViewParser.input` shared across parallel calls                           | N/A         | N/A    | Node.js is single-threaded; no concern.                                                                                                                                                 |
