# Technical Design Specification: Chevrotain Lexer/Parser for `.hdbsequence`

**PRD**: [prd.md](./prd.md)  
**Feature**: Chevrotain `.hdbsequence` Sequence Name Extractor  
**Status**: Ready for Implementation

---

## 1. System Architecture Overview

### Current state

`extractSubjects()` in `src/content-lint.ts` has no handler for `.hdbsequence` files. When a file with that extension is processed, the function falls through to the `return []` catch-all, silently yielding no subjects and no lint output.

```
content-lint.ts
  └── extractSubjects()
        ├── '.hdbtable'          → extractTableColumns()
        ├── '.hdbview'           → extractViewColumns()
        ├── '.hdbprocedure'      → extractProcedureParameters()
        ├── '.hdbfunction'       → extractFunctionParameters()
        ├── '.hdbtabletype'      → extractTableTypeColumns()
        ├── '.hdbrole'           → extractRoleNames()
        ├── '.hdbcalculationview'→ extractCalculationViewOutputs()
        └── (default)            → []   ← .hdbsequence silently falls here
```

In addition, the `ContentTarget` union type in `src/types/rules.ts` and the `subjectType` union in `LintIssue` in `src/types/issues.ts` do not include `'sequenceName'`, so even if a user configures a `contentRuleSet` for `.hdbsequence` the target name would be unresolvable.

### Target state

A new `src/parsers/hdbsequence/` sub-module mirrors the structure of all existing `.hdb*` parser modules. `extractSubjects()` gains a dedicated `.hdbsequence` branch. The two type unions are extended additively with `'sequenceName'`.

```
content-lint.ts
  └── extractSubjects()
        ├── '.hdbtable'          → extractTableColumns()
        ├── '.hdbview'           → extractViewColumns()
        ├── '.hdbprocedure'      → extractProcedureParameters()
        ├── '.hdbfunction'       → extractFunctionParameters()
        ├── '.hdbtabletype'      → extractTableTypeColumns()
        ├── '.hdbrole'           → extractRoleNames()
        ├── '.hdbcalculationview'→ extractCalculationViewOutputs()
        └── '.hdbsequence'       → extractSequenceName()   ← NEW

src/parsers/hdbsequence/
  ├── lexer.ts      Token definitions + singleton Lexer instance
  ├── parser.ts     CstParser subclass + grammar rules
  ├── visitor.ts    CST visitor that collects the sequence name
  └── index.ts      Public API: extractSequenceName()
```

Everything above `extractSubjects()` — `lintFileContent()`, `runLint()`, and the public `src/index.ts` entry point — is unchanged. The type additions in `src/types/rules.ts` and `src/types/issues.ts` are purely additive.

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
    hdbsequence/
      lexer.ts
      parser.ts
      visitor.ts
      index.ts
      __tests__/
        extractSequenceName.test.ts
```

### 3.2 `src/parsers/hdbsequence/lexer.ts`

#### Responsibility

Define every token the grammar needs and export a singleton `Lexer` instance.

#### Token ordering rules (Chevrotain-specific)

1. Skip tokens (`BlockComment`, `LineComment`, `WhiteSpace`) must be declared first so they are consumed before anything else.
2. `Identifier` must be declared **before** keyword tokens so keyword tokens can reference it via `longer_alt`.
3. All keyword tokens must declare `longer_alt: Identifier` so that identifiers whose names begin with a keyword prefix (e.g., `SEQUENCE_ID`, `NO_WAIT`, `CYCLE_COUNT`, `START_DATE`) are not split at the keyword boundary.
4. `QuotedIdentifier` must appear before `Identifier` in the `allTokens` array.
5. Multi-character operators (e.g., `<>`, `<=`, `>=`) must appear **before** the single-character operators that share their leading character (`<`, `>`, `=`).
6. Single-quoted string literal must appear after skip tokens and before numeric literals to avoid any ambiguity around leading digits.

#### Prefix-conflict pairs requiring explicit ordering

| Longer token | Shorter token | Ordering constraint                                     |
| ------------ | ------------- | ------------------------------------------------------- |
| `MaxvalueKw` | (no overlap)  | `MAX` and `MAXVALUE` diverge at char 4 — no conflict    |
| `MinvalueKw` | (no overlap)  | `MIN` and `MINVALUE` diverge at char 4 — no conflict    |
| `NotEq`      | `Lt`          | Declare `NotEq` (`<>`) before `Lt` (`<`) in `allTokens` |
| `LtEq`       | `Lt`          | Declare `LtEq` (`<=`) before `Lt` (`<`) in `allTokens`  |
| `GtEq`       | `Gt`          | Declare `GtEq` (`>=`) before `Gt` (`>`) in `allTokens`  |

#### Token catalogue

**Skip tokens** (declared first):

| Token name     | Pattern              | Mode                       |
| -------------- | -------------------- | -------------------------- |
| `BlockComment` | `/\/\*[\s\S]*?\*\//` | `{ group: Lexer.SKIPPED }` |
| `LineComment`  | `/--[^\r\n]*/`       | `{ group: Lexer.SKIPPED }` |
| `WhiteSpace`   | `/\s+/`              | `{ group: Lexer.SKIPPED }` |

**Identifier tokens** (declared before keywords so `longer_alt` can reference them):

| Token name         | Pattern                    | Notes                                          |
| ------------------ | -------------------------- | ---------------------------------------------- |
| `Identifier`       | `/[A-Za-z_][A-Za-z0-9_]*/` | Catch-all; all keyword tokens use `longer_alt` |
| `QuotedIdentifier` | `/"[^"]*"/`                | Declared before `Identifier` in `allTokens`    |

**Sequence DDL keyword tokens** (all declare `longer_alt: Identifier`):

| Token name    | Pattern        | Notes                                                               |
| ------------- | -------------- | ------------------------------------------------------------------- |
| `SequenceKw`  | `/SEQUENCE/i`  | Top-level statement keyword; `longer_alt: Identifier`               |
| `IncrementKw` | `/INCREMENT/i` | `longer_alt: Identifier`                                            |
| `ByKw`        | `/BY/i`        | `longer_alt: Identifier`                                            |
| `StartKw`     | `/START/i`     | `longer_alt: Identifier`; `START_DATE` → `Identifier`               |
| `WithKw`      | `/WITH/i`      | `longer_alt: Identifier`                                            |
| `MinvalueKw`  | `/MINVALUE/i`  | `longer_alt: Identifier`                                            |
| `MaxvalueKw`  | `/MAXVALUE/i`  | `longer_alt: Identifier`                                            |
| `NoKw`        | `/NO/i`        | `longer_alt: Identifier`; `NO_WAIT` → `Identifier`                  |
| `CycleKw`     | `/CYCLE/i`     | `longer_alt: Identifier`; `CYCLE_COUNT` → `Identifier`              |
| `ResetKw`     | `/RESET/i`     | `longer_alt: Identifier`                                            |
| `DependsKw`   | `/DEPENDS/i`   | `longer_alt: Identifier`                                            |
| `OnKw`        | `/ON/i`        | `longer_alt: Identifier`; shared with DEPENDS ON and RESET BY logic |

**SQL clause/function keyword tokens** (used inside `RESET BY SELECT`; all declare `longer_alt: Identifier`):

| Token name   | Pattern       | Notes                                                         |
| ------------ | ------------- | ------------------------------------------------------------- |
| `SelectKw`   | `/SELECT/i`   | Mandatory first token of `resetByClause`                      |
| `FromKw`     | `/FROM/i`     | Consumed as part of `resetByToken`                            |
| `WhereKw`    | `/WHERE/i`    | Consumed as part of `resetByToken`                            |
| `IfnullKw`   | `/IFNULL/i`   | Consumed as part of `resetByToken`                            |
| `CoalesceKw` | `/COALESCE/i` | Consumed as part of `resetByToken`                            |
| `NvlKw`      | `/NVL/i`      | Consumed as part of `resetByToken`                            |
| `MaxKw`      | `/MAX/i`      | Consumed as part of `resetByToken`                            |
| `MinKw`      | `/MIN/i`      | Consumed as part of `resetByToken`                            |
| `CountKw`    | `/COUNT/i`    | Consumed as part of `resetByToken`                            |
| `SumKw`      | `/SUM/i`      | Consumed as part of `resetByToken`                            |
| `AndKw`      | `/AND/i`      | Consumed as part of `resetByToken`                            |
| `OrKw`       | `/OR/i`       | Consumed as part of `resetByToken`                            |
| `IsKw`       | `/IS/i`       | Consumed as part of `resetByToken`                            |
| `NullKw`     | `/NULL/i`     | Consumed as part of `resetByToken`; `NULL` in RESET BY bodies |
| `NotKw`      | `/NOT/i`      | Consumed as part of `resetByToken`                            |
| `CaseKw`     | `/CASE/i`     | Consumed as part of `resetByToken`                            |
| `WhenKw`     | `/WHEN/i`     | Consumed as part of `resetByToken`                            |
| `ThenKw`     | `/THEN/i`     | Consumed as part of `resetByToken`                            |
| `ElseKw`     | `/ELSE/i`     | Consumed as part of `resetByToken`                            |
| `EndKw`      | `/END/i`      | Consumed as part of `resetByToken`                            |
| `JoinKw`     | `/JOIN/i`     | Consumed as part of `resetByToken`                            |
| `InnerKw`    | `/INNER/i`    | Consumed as part of `resetByToken`                            |
| `LeftKw`     | `/LEFT/i`     | Consumed as part of `resetByToken`                            |

**Literal tokens:**

| Token name       | Pattern               | Notes                                  |
| ---------------- | --------------------- | -------------------------------------- | ------------------------------------------------- |
| `NumericLiteral` | `/[0-9]+(\.[0-9]+)?/` | Integer and decimal; for option values |
| `StringLiteral`  | `/'(?:[^'\\]          | \\.)\*'/`                              | Single-quoted; for string expressions in RESET BY |

**Punctuation tokens:**

| Token name  | Pattern | Notes                                                     |
| ----------- | ------- | --------------------------------------------------------- |
| `NotEq`     | `<>`    | Declared **before** `Lt`                                  |
| `LtEq`      | `<=`    | Declared **before** `Lt`                                  |
| `GtEq`      | `>=`    | Declared **before** `Gt`                                  |
| `LParen`    | `\(`    |                                                           |
| `RParen`    | `\)`    |                                                           |
| `Comma`     | `,`     |                                                           |
| `Semicolon` | `;`     |                                                           |
| `Dot`       | `\.`    | Schema qualifier separator in sequence name               |
| `Plus`      | `\+`    | Arithmetic in RESET BY body                               |
| `Minus`     | `-`     | Arithmetic in RESET BY body                               |
| `Star`      | `\*`    | Multiplication / wildcard in RESET BY body                |
| `Slash`     | `\/`    | Division in RESET BY body                                 |
| `Eq`        | `=`     | Comparison in RESET BY body (after `NotEq`, `LtEq`, etc.) |
| `Lt`        | `<`     | Declared **after** `NotEq` and `LtEq`                     |
| `Gt`        | `>`     | Declared **after** `GtEq`                                 |

#### `allTokens` array ordering (summary)

```
[
  // Skip
  BlockComment, LineComment, WhiteSpace,
  // Identifiers (declared before keywords for longer_alt references)
  Identifier, QuotedIdentifier,
  // Sequence DDL keywords
  SequenceKw, IncrementKw, ByKw, StartKw, WithKw,
  MinvalueKw, MaxvalueKw, NoKw, CycleKw,
  ResetKw, DependsKw, OnKw,
  // SQL clause/function keywords (for RESET BY body)
  SelectKw, FromKw, WhereKw,
  IfnullKw, CoalesceKw, NvlKw, MaxKw, MinKw, CountKw, SumKw,
  AndKw, OrKw, IsKw, NullKw, NotKw,
  CaseKw, WhenKw, ThenKw, ElseKw, EndKw,
  JoinKw, InnerKw, LeftKw,
  // Literals
  NumericLiteral, StringLiteral,
  // Punctuation — multi-char operators before single-char sharing a prefix
  NotEq, LtEq, GtEq,
  LParen, RParen, Comma, Semicolon, Dot,
  Plus, Minus, Star, Slash, Eq, Lt, Gt
]
```

#### Exported symbols

```typescript
export const allTokens: TokenType[];
export const HdbSequenceLexer: Lexer; // singleton — instantiated at module load
```

---

### 3.3 `src/parsers/hdbsequence/parser.ts`

#### Responsibility

Define the grammar as a `CstParser` subclass and expose a singleton parser instance.

#### Grammar notation

> `?` = optional, `*` = zero-or-more, `+` = one-or-more, `|` = alternation, `()` = grouping.

#### Grammar rules

```
sequenceStatement
    SequenceKw sequenceName sequenceOption* Semicolon?
    -- Top-level rule.
    -- SequenceKw is mandatory; no CREATE prefix in .hdbsequence files.
    -- sequenceOption* allows any number of options in any order.
    -- Trailing semicolon is optional.

sequenceName
    identifier (Dot identifier)?
    -- identifier = Identifier | QuotedIdentifier
    -- Handles both plain MY_SEQ and schema-qualified "MY_SCHEMA"."MY_SEQ".
    -- The schema qualifier (before Dot), if present, is consumed structurally
    -- but NOT included in the extracted subject name.

sequenceOption
    incrementByOption
    | startWithOption
    | minvalueOption
    | maxvalueOption
    | cycleOption
    | resetByOption
    | dependsOnOption

incrementByOption
    IncrementKw ByKw NumericLiteral

startWithOption
    StartKw WithKw NumericLiteral

minvalueOption
    MinvalueKw NumericLiteral
    | NoKw MinvalueKw

maxvalueOption
    MaxvalueKw NumericLiteral
    | NoKw MaxvalueKw

cycleOption
    CycleKw
    | NoKw CycleKw

resetByOption
    ResetKw ByKw resetByClause

resetByClause
    SelectKw resetByToken*
    -- Greedily consumes all tokens that are NOT the start of a sequenceOption
    -- or end-of-input. See §3.3 "Key design: resetByClause" below.

resetByToken
    -- Any single token that is NOT in the sequenceOption-start set.
    -- Implemented as a long OR-alternation over every token type
    -- that can appear in arbitrary SQL SELECT expressions.

dependsOnOption
    DependsKw OnKw identifier

identifier
    Identifier | QuotedIdentifier
```

#### Key design: `resetByClause`

The `RESET BY SELECT ...` clause contains arbitrary SQL and cannot be given a fixed grammar. The parser must consume the clause without attempting semantic analysis or extraction. The implementation uses `MANY` with a `GATE` predicate that halts consumption when the next token signals the start of a new `sequenceOption` (or the end of input):

```typescript
private resetByClauseStartTokens = new Set([
    IncrementKw, StartKw, MinvalueKw, MaxvalueKw,
    NoKw, CycleKw, ResetKw, DependsKw, Semicolon
]);

resetByClause() {
    this.CONSUME(SelectKw);
    this.MANY({
        GATE: () => !this.resetByClauseStartTokens.has(this.LA(1).tokenType),
        DEF: () => this.SUBRULE(this.resetByToken)
    });
}
```

`resetByToken` is a long `OR` alternation that explicitly lists every non-skip token type the lexer can produce. This ensures the grammar can recover from any token seen inside a `RESET BY` body. Any token type not listed falls to Chevrotain's default error recovery rather than crashing.

#### Key design: `sequenceOption` ordering in the OR alternation

`resetByOption` must be placed **after** other options in the `sequenceOption` OR alternation so that `INCREMENT`, `START`, `MINVALUE`, `MAXVALUE`, `CYCLE`, and `DEPENDS` are matched first. If `resetByOption` were first, Chevrotain's single-token lookahead might reach into the `RESET BY` body.

The recommended ordering in the `OR` list is:

```
[ incrementByOption, startWithOption, minvalueOption, maxvalueOption,
  cycleOption, dependsOnOption, resetByOption ]
```

#### Key design: `NO` keyword disambiguation

`NoKw` is used in `NO MINVALUE`, `NO MAXVALUE`, and `NO CYCLE`. Chevrotain resolves which alternative to take based on a two-token lookahead (`LA(1) = NoKw`, `LA(2) = MinvalueKw | MaxvalueKw | CycleKw`). No explicit `BACKTRACK` is needed because the three alternatives have distinct second tokens.

#### Key design: `sequenceOption*` ordering independence

The grammar uses `sequenceOption*` (zero-or-more) without enforcing any particular order on the clauses. This means a file may declare `NO CYCLE` before `START WITH` or `RESET BY` before `INCREMENT BY` — all are equally valid. This matches HANA's own DDL flexibility.

#### Error recovery

Use Chevrotain's default single-token insertion/deletion recovery. Do **not** override recovery methods. The defaults ensure a partial CST is produced rather than an exception when encountering unexpected syntax (e.g., an unsupported sequence option keyword not in the grammar). If the `sequenceName` rule parsed successfully before any error occurs, the visitor will still extract the name.

#### Exported symbols

```typescript
export class HdbSequenceParser extends CstParser { ... }
export const hdbSequenceParser: HdbSequenceParser; // singleton
```

---

### 3.4 `src/parsers/hdbsequence/visitor.ts`

#### Responsibility

Walk the CST produced by `HdbSequenceParser` and emit exactly one `{ type: 'sequenceName', name }` entry from the `sequenceName` node. The visitor performs no extraction in any other grammar rule.

#### Design

The visitor extends `BaseCstVisitorWithDefaults` (obtained via `hdbSequenceParser.getBaseCstVisitorConstructorWithDefaults()`). This variant auto-visits all child nodes for any method not explicitly overridden. Only two methods need to be implemented explicitly:

1. `sequenceName` — extracts the local name from the CST node.
2. `resetByClause` — overridden as a no-op to prevent any accidental auto-traversal into RESET BY body tokens.

All other grammar rule methods are left to default auto-traversal, which is safe because none of the other rules contain identifier tokens that should be extracted.

#### Extraction logic: `sequenceName`

```typescript
sequenceName(ctx: CstChildrenDictionary): void {
    // ctx['identifier'] contains 1 or 2 identifier sub-rule nodes:
    //   [0] = schema qualifier (if schema-qualified form is used)
    //   [1] = local sequence name  (only element when unqualified)
    //
    // We always want the LAST identifier node, which is the local name
    // regardless of whether a schema qualifier is present.
    const identifierNodes = ctx['identifier'] as CstNode[] | undefined;
    if (!identifierNodes?.length) return;

    const localNameNode = identifierNodes[identifierNodes.length - 1];
    const name = this.extractIdentifierName(localNameNode);
    if (!name) return;

    this.subjects.push({ type: 'sequenceName', name });
}
```

#### Blocking extraction in `resetByClause`

Override `resetByClause` with an explicit no-op to prevent `BaseCstVisitorWithDefaults` from traversing into the `resetByToken` OR-alternatives and accidentally surfacing identifiers as if they were from the outer grammar scope:

```typescript
resetByClause(_ctx: CstChildrenDictionary): void {
    // Intentionally empty — all tokens inside the RESET BY SELECT body
    // are consumed structurally but must NOT be extracted as subjects.
}
```

#### Identifier normalisation

A private helper strips surrounding double-quotes from `QuotedIdentifier` image strings and returns the raw image for plain `Identifier` tokens:

```typescript
private extractIdentifierName(node: CstNode): string | undefined {
    if (!node.children) return undefined;
    const token =
        (node.children['QuotedIdentifier']?.[0] as IToken | undefined) ??
        (node.children['Identifier']?.[0] as IToken | undefined);
    if (!token) return undefined;
    const raw = token.image;
    return raw.startsWith('"') ? raw.slice(1, -1) : raw;
}
```

#### Exported symbols

```typescript
export class HdbSequenceNameVisitor {
    readonly subjects: ExtractedSubject[] = [];
    visit(cst: CstNode): void { ... }
}
```

---

### 3.5 `src/parsers/hdbsequence/index.ts`

#### Responsibility

Public API boundary. Orchestrates tokenise → parse → visit. The single exported function is what `content-lint.ts` calls.

#### Implementation

```typescript
import type { ExtractedSubject } from '../../types/issues';
import { HdbSequenceLexer } from './lexer';
import { hdbSequenceParser } from './parser';
import { HdbSequenceNameVisitor } from './visitor';

export function extractSequenceName(fileContent: string): ExtractedSubject[] {
    const lexResult = HdbSequenceLexer.tokenize(fileContent);

    hdbSequenceParser.input = lexResult.tokens;

    const cst = hdbSequenceParser.sequenceStatement();

    if (!cst) {
        return [];
    }

    const visitor = new HdbSequenceNameVisitor();
    visitor.visit(cst);
    return visitor.subjects;
}
```

Lex and parse errors are intentionally not re-thrown. The CST visitor returns whatever could be extracted from the partial tree. Callers in `content-lint.ts` must not crash on bad input.

---

### 3.6 Changes to `src/types/rules.ts`

Add `'sequenceName'` to the `ContentTarget` union:

```typescript
// Before
export type ContentTarget = 'field' | 'inputParameter' | 'outputParameter' | 'roleName' | 'grantedRoleName';

// After
export type ContentTarget = 'field' | 'inputParameter' | 'outputParameter' | 'roleName' | 'grantedRoleName' | 'sequenceName';
```

This is a purely additive change. No existing usages of `ContentTarget` are affected; the new value is only referenced by the new parser.

---

### 3.7 Changes to `src/types/issues.ts`

Add `'sequenceName'` to the `subjectType` union in `LintIssue`:

```typescript
// Before
readonly subjectType?: 'artifact' | 'field' | 'inputParameter' | 'outputParameter' | 'roleName' | 'grantedRoleName';

// After
readonly subjectType?: 'artifact' | 'field' | 'inputParameter' | 'outputParameter' | 'roleName' | 'grantedRoleName' | 'sequenceName';
```

`ExtractedSubject.type` is typed as `ContentTarget`, so it picks up `'sequenceName'` automatically once `ContentTarget` is extended. No further change to `ExtractedSubject` itself is required.

---

### 3.8 Changes to `src/content-lint.ts`

Two changes only:

1. **Add import** at the top of the file alongside the existing parser imports:

    ```typescript
    import { extractSequenceName } from './parsers/hdbsequence/index';
    ```

2. **Add branch** in `extractSubjects()` before the `return []` catch-all:

    ```typescript
    // Before (abbreviated)
    function extractSubjects(extension: string, fileContent: string): ExtractedSubject[] {
        if (extension === '.hdbtable') return extractTableColumns(fileContent);
        if (extension === '.hdbview') return extractViewColumns(fileContent);
        if (extension === '.hdbprocedure') return extractProcedureParameters(fileContent);
        if (extension === '.hdbfunction') return extractFunctionParameters(fileContent);
        if (extension === '.hdbtabletype') return extractTableTypeColumns(fileContent);
        if (extension === '.hdbrole') return extractRoleNames(fileContent);
        if (extension === '.hdbcalculationview') return extractCalculationViewOutputs(fileContent);
        return [];
    }

    // After
    function extractSubjects(extension: string, fileContent: string): ExtractedSubject[] {
        if (extension === '.hdbtable') return extractTableColumns(fileContent);
        if (extension === '.hdbview') return extractViewColumns(fileContent);
        if (extension === '.hdbprocedure') return extractProcedureParameters(fileContent);
        if (extension === '.hdbfunction') return extractFunctionParameters(fileContent);
        if (extension === '.hdbtabletype') return extractTableTypeColumns(fileContent);
        if (extension === '.hdbrole') return extractRoleNames(fileContent);
        if (extension === '.hdbcalculationview') return extractCalculationViewOutputs(fileContent);
        if (extension === '.hdbsequence') return extractSequenceName(fileContent);
        return [];
    }
    ```

No other changes to `content-lint.ts`. `lintFileContent()`, `evaluateAllRules()`, `evaluateAnyRules()`, and `LintIssue` are untouched beyond the `'sequenceName'` addition to `subjectType`.

---

## 4. Data Models

No new persistent data models. The only types crossing the parser boundary are the existing `ExtractedSubject` and `ContentTarget`, extended additively:

```typescript
// src/types/issues.ts — ExtractedSubject uses ContentTarget directly
type ExtractedSubject = {
    readonly type: ContentTarget; // 'sequenceName' for .hdbsequence
    readonly name: string; // normalised identifier (double-quotes stripped)
    readonly lineNumber?: number; // not populated by this parser
};

// src/types/rules.ts — extended with 'sequenceName'
type ContentTarget = 'field' | 'inputParameter' | 'outputParameter' | 'roleName' | 'grantedRoleName' | 'sequenceName'; // NEW
```

The `.hdbsequence` extractor returns at most **one** entry (a single sequence is defined per file). A `contentRuleSet` targeting `'field'` or any other existing target against `.hdbsequence` will match zero subjects — this is not an error.

---

## 5. API Specifications

### Public function

```typescript
/**
 * Extract the sequence name from the content of a `.hdbsequence` DDL file.
 *
 * Uses a Chevrotain lexer and CstParser. The parser recognises the
 * `SEQUENCE <name> [<options>]` statement and produces a CST from which
 * a visitor extracts the local sequence name as a single `sequenceName`
 * subject.
 *
 * For schema-qualified names (`"SCHEMA"."SEQ_NAME"`), only the local name
 * (the part after the dot) is returned; the schema prefix is consumed
 * structurally and excluded from the result.
 *
 * The `RESET BY SELECT` clause is consumed as an opaque token stream;
 * no identifiers within it are extracted.
 *
 * Handles block/line comments, quoted and unquoted sequence names,
 * schema-qualified names, and all standard sequence options including
 * NO MINVALUE, NO MAXVALUE, NO CYCLE, DEPENDS ON, and RESET BY SELECT.
 *
 * Gracefully returns a partial or empty result on invalid input — does
 * not throw.
 *
 * @param fileContent - Raw UTF-8 file content (LF or CRLF).
 * @returns Array containing at most one ExtractedSubject with type 'sequenceName'.
 */
export function extractSequenceName(fileContent: string): ExtractedSubject[];
```

### Internal module exports (not part of public API)

| Symbol                                   | Module       | Visibility       |
| ---------------------------------------- | ------------ | ---------------- |
| `allTokens`, `HdbSequenceLexer`          | `lexer.ts`   | Package-internal |
| `HdbSequenceParser`, `hdbSequenceParser` | `parser.ts`  | Package-internal |
| `HdbSequenceNameVisitor`                 | `visitor.ts` | Package-internal |

---

## 6. Unit Test Design

Test file: `src/parsers/hdbsequence/__tests__/extractSequenceName.test.ts`

The test file follows the same structure as the existing `.hdb*` parser tests: one `describe` block per acceptance criterion, typed helper functions for brevity.

```typescript
import { describe, it, expect } from 'vitest';
import { extractSequenceName } from '../index';

function names(ddl: string): string[] {
    return extractSequenceName(ddl)
        .filter((s) => s.type === 'sequenceName')
        .map((s) => s.name);
}
```

### Test cases by acceptance criterion

**AC-1 — Standard sequence name extraction (unquoted)**

```typescript
describe('AC-1: unquoted sequence name', () => {
    it('extracts the sequence name as a sequenceName subject', () => {
        const ddl = `SEQUENCE MY_SEQUENCE INCREMENT BY 1 START WITH 1`;
        expect(extractSequenceName(ddl)).toEqual([{ type: 'sequenceName', name: 'MY_SEQUENCE' }]);
    });

    it('handles minimal file with no options', () => {
        const ddl = `SEQUENCE MY_SEQ`;
        expect(names(ddl)).toEqual(['MY_SEQ']);
    });
});
```

**AC-2 — Standard sequence name extraction (quoted)**

```typescript
describe('AC-2: quoted sequence name', () => {
    it('strips double-quotes from the sequence name', () => {
        const ddl = `SEQUENCE "MY_SEQUENCE" INCREMENT BY 1 START WITH 1`;
        expect(extractSequenceName(ddl)).toEqual([{ type: 'sequenceName', name: 'MY_SEQUENCE' }]);
    });
});
```

**AC-3 — Schema-qualified name — local name extracted**

```typescript
describe('AC-3: schema-qualified sequence name', () => {
    it('extracts only the local name (after the dot)', () => {
        const ddl = `SEQUENCE "MY_SCHEMA"."MY_SEQUENCE" INCREMENT BY 1`;
        expect(extractSequenceName(ddl)).toEqual([{ type: 'sequenceName', name: 'MY_SEQUENCE' }]);
    });

    it('does not include the schema prefix as a subject', () => {
        const ddl = `SEQUENCE "MY_SCHEMA"."MY_SEQUENCE" START WITH 100`;
        expect(names(ddl)).not.toContain('MY_SCHEMA');
    });
});
```

**AC-4 — Block comment exclusion**

```typescript
describe('AC-4: block comment exclusion', () => {
    it('does not extract tokens inside /* … */ comments', () => {
        const ddl = `
            /* SEQUENCE OLD_SEQUENCE START WITH 1 */
            SEQUENCE MY_SEQUENCE INCREMENT BY 1
        `;
        expect(names(ddl)).not.toContain('OLD_SEQUENCE');
        expect(names(ddl)).toContain('MY_SEQUENCE');
    });

    it('handles a block comment wrapping sequence options', () => {
        const ddl = `
            SEQUENCE MY_SEQUENCE
            /* INCREMENT BY 5
               START WITH 100 */
            START WITH 1
        `;
        expect(names(ddl)).toEqual(['MY_SEQUENCE']);
    });
});
```

**AC-5 — Line comment exclusion**

```typescript
describe('AC-5: line comment exclusion', () => {
    it('does not extract an identifier on a -- comment line', () => {
        const ddl = `
            -- SEQUENCE OLD_SEQUENCE START WITH 1
            SEQUENCE MY_SEQUENCE INCREMENT BY 1
        `;
        expect(names(ddl)).not.toContain('OLD_SEQUENCE');
        expect(names(ddl)).toContain('MY_SEQUENCE');
    });
});
```

**AC-6 — `RESET BY SELECT` clause is ignored**

```typescript
describe('AC-6: RESET BY SELECT body not extracted', () => {
    it('does not include identifiers from the RESET BY SELECT body', () => {
        const ddl = `
            SEQUENCE "ORDER_SEQ"
              START WITH 1
              INCREMENT BY 1
              RESET BY SELECT IFNULL(MAX("ORDER_ID"), 0) + 1 FROM "ORDERS"
        `;
        const result = extractSequenceName(ddl);
        expect(result).toEqual([{ type: 'sequenceName', name: 'ORDER_SEQ' }]);
        expect(names(ddl)).not.toContain('ORDER_ID');
        expect(names(ddl)).not.toContain('ORDERS');
    });

    it('correctly extracts the name when RESET BY comes before other options', () => {
        const ddl = `
            SEQUENCE "SEQ_A"
              RESET BY SELECT IFNULL(MAX("ID"), 0) + 1 FROM "T"
              INCREMENT BY 1
              START WITH 1
        `;
        expect(names(ddl)).toEqual(['SEQ_A']);
    });
});
```

**AC-7 — All standard options consumed without error**

```typescript
describe('AC-7: all sequence options parsed without error', () => {
    it('handles all options in a single file', () => {
        const ddl = `
            SEQUENCE "FULL_SEQ"
              INCREMENT BY 5
              START WITH 100
              MINVALUE 1
              MAXVALUE 9999999
              NO CYCLE
              DEPENDS ON "MY_TABLE";
        `;
        expect(extractSequenceName(ddl)).toEqual([{ type: 'sequenceName', name: 'FULL_SEQ' }]);
    });
});
```

**AC-8 — Optional semicolon terminator**

```typescript
describe('AC-8: optional semicolon', () => {
    it('produces the same result with and without a trailing semicolon', () => {
        const withSemicolon = `SEQUENCE MY_SEQ INCREMENT BY 1;`;
        const withoutSemicolon = `SEQUENCE MY_SEQ INCREMENT BY 1`;
        expect(names(withSemicolon)).toEqual(names(withoutSemicolon));
    });
});
```

**AC-9 — `NO MINVALUE` / `NO MAXVALUE` variants**

```typescript
describe('AC-9: NO MINVALUE and NO MAXVALUE', () => {
    it('parses NO MINVALUE and NO MAXVALUE without error', () => {
        const ddl = `
            SEQUENCE "RANGE_SEQ"
              START WITH 1
              INCREMENT BY 1
              NO MINVALUE
              NO MAXVALUE
              NO CYCLE;
        `;
        expect(extractSequenceName(ddl)).toEqual([{ type: 'sequenceName', name: 'RANGE_SEQ' }]);
    });
});
```

**AC-10 — Graceful error on unparseable file**

```typescript
describe('AC-10: graceful error handling', () => {
    it('does not throw on completely invalid input', () => {
        expect(() => extractSequenceName('THIS IS NOT VALID DDL !!!')).not.toThrow();
    });

    it('does not throw on an empty string', () => {
        expect(() => extractSequenceName('')).not.toThrow();
        expect(extractSequenceName('')).toEqual([]);
    });

    it('returns empty array when SEQUENCE keyword is missing', () => {
        expect(extractSequenceName('START WITH 1 INCREMENT BY 1')).toEqual([]);
    });
});
```

**AC-11 — Integration with `lintFileContent` pipeline**

```typescript
describe('AC-11: integration with lintFileContent pipeline', () => {
    it('raises a LintIssue when the sequence name violates a sequenceName rule', async () => {
        // This test requires setting up a mock file and config.
        // It validates that subjectType === 'sequenceName' appears in the issue.
        // Full integration test implementation follows the pattern used in
        // the existing lintFileContent integration test suite.
    });
});
```

**AC-12 — Build integrity** is verified by running `npm run build` in CI; no unit-test case required.

---

## 7. Security and Performance Considerations

### Security

- **ReDoS** — The `BlockComment` pattern (`/\/\*[\s\S]*?\*\//`) uses a non-greedy quantifier and has no nested quantifiers; it is safe from catastrophic backtracking. The `StringLiteral` pattern (`/'(?:[^'\\]|\\.)*'/`) uses an atomic alternation over non-quote/non-backslash characters and a two-character escape sequence; no nested quantifiers exist. Both patterns are consistent with the patterns used in every other parser in the project.
- **Input size** — `.hdbsequence` files are small by nature (typically < 50 lines); the 100 ms performance budget (NFR-4) is not at risk even for pathological inputs up to 500 lines.
- **Injection** — The parser only produces `ExtractedSubject` values containing string names from the token stream. It does not evaluate, execute, or persist anything from the file content. No injection vectors exist.

### Performance

- Chevrotain lexer and parser instances are singletons (instantiated once at module load) per NFR-3. There is no per-file grammar compilation.
- The `resetByClause` GATE predicate performs a `Set.has()` lookup on a small fixed set of token types — O(1) per token.
- No async I/O or blocking operations occur inside the parser. File I/O is handled exclusively by `lintFileContent()` before `extractSequenceName()` is called.

---

## 8. Implementation Milestones

| #   | Deliverable                                    | Files changed                                                   |
| --- | ---------------------------------------------- | --------------------------------------------------------------- |
| 1   | Extend `ContentTarget` and `LintIssue` types   | `src/types/rules.ts`, `src/types/issues.ts`                     |
| 2   | Implement `lexer.ts`                           | `src/parsers/hdbsequence/lexer.ts`                              |
| 3   | Implement `parser.ts`                          | `src/parsers/hdbsequence/parser.ts`                             |
| 4   | Implement `visitor.ts`                         | `src/parsers/hdbsequence/visitor.ts`                            |
| 5   | Implement `index.ts`                           | `src/parsers/hdbsequence/index.ts`                              |
| 6   | Wire into `content-lint.ts`                    | `src/content-lint.ts`                                           |
| 7   | Write unit tests                               | `src/parsers/hdbsequence/__tests__/extractSequenceName.test.ts` |
| 8   | Run `npm run build` and confirm zero TS errors | —                                                               |
| 9   | Run `npm test` and confirm all tests pass      | —                                                               |

Milestones 1–6 may be done in parallel; milestone 7 may be developed alongside milestones 2–5 (TDD style). Milestones 8 and 9 are verification steps after all prior milestones are complete.

---

## 9. Risk Assessment

| Risk                                                             | Likelihood | Impact | Mitigation                                                                                                                                                             |
| ---------------------------------------------------------------- | ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RESET BY SELECT` body contains an unrecognised token type       | Medium     | Low    | `resetByToken` exhaustively lists all tokens the lexer can produce. Chevrotain error recovery handles any remainder.                                                   |
| Future `.hdbsequence` syntax additions not covered               | Low        | Low    | The `sequenceOption*` rule with error recovery degrades gracefully; new options simply fall to recovery and do not crash.                                              |
| `NoKw` ambiguity in `NO MINVALUE` vs `NO MAXVALUE` vs `NO CYCLE` | Low        | Low    | Chevrotain two-token lookahead on the second token (`MinvalueKw`, `MaxvalueKw`, `CycleKw`) cleanly disambiguates.                                                      |
| Token prefix conflict between SQL keywords and user identifiers  | Medium     | Low    | All keyword tokens declare `longer_alt: Identifier`; identifiers like `SEQUENCE_ID`, `NO_WAIT` tokenise correctly.                                                     |
| Schema-qualified name extraction returns wrong identifier        | Low        | Medium | Visitor always takes the **last** `identifier` child node from `sequenceName`, which is the local name in both qualified and unqualified forms. Test AC-3 covers this. |
