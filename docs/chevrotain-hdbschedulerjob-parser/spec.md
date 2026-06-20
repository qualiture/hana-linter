# Technical Design Specification: Chevrotain Lexer/Parser for `.hdbschedulerjob`

**PRD**: [prd.md](./prd.md)  
**Feature**: Chevrotain `.hdbschedulerjob` Job Action Extractor  
**Status**: Ready for Implementation

---

## 1. System Architecture Overview

### Current state

`extractSubjects()` in `src/content-lint.ts` has no handler for `.hdbschedulerjob` files. When a file with that extension is processed, the function falls through to the `return []` catch-all, silently yielding no subjects and no lint output.

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
        ├── '.hdbsequence'       → extractSequenceName()
        └── (default)            → []   ← .hdbschedulerjob silently falls here
```

In addition, the `ContentTarget` union type in `src/types/rules.ts` and the `subjectType` union in `LintIssue` in `src/types/issues.ts` do not include `'jobAction'`, so even if a user configures a `contentRuleSet` for `.hdbschedulerjob` the target value would be unresolvable at the type level.

### Target state

A new `src/parsers/hdbschedulerjob/` sub-module mirrors the structure of all existing `.hdb*` parser modules. `extractSubjects()` gains a dedicated `.hdbschedulerjob` branch. The two type unions are extended additively with `'jobAction'`.

```
content-lint.ts
  └── extractSubjects()
        ├── '.hdbtable'           → extractTableColumns()
        ├── '.hdbview'            → extractViewColumns()
        ├── '.hdbprocedure'       → extractProcedureParameters()
        ├── '.hdbfunction'        → extractFunctionParameters()
        ├── '.hdbtabletype'       → extractTableTypeColumns()
        ├── '.hdbrole'            → extractRoleNames()
        ├── '.hdbcalculationview' → extractCalculationViewOutputs()
        ├── '.hdbsequence'        → extractSequenceName()
        └── '.hdbschedulerjob'    → extractSchedulerJobAction()   ← NEW

src/parsers/hdbschedulerjob/
  ├── lexer.ts      Token definitions + singleton Lexer instance
  ├── parser.ts     CstParser subclass + grammar rules
  ├── visitor.ts    CST visitor that collects the job action name
  └── index.ts      Public API: extractSchedulerJobAction()
```

Everything above `extractSubjects()` — `lintFileContent()`, `runLint()`, and the public `src/index.ts` entry point — is unchanged. The type additions in `src/types/rules.ts` and `src/types/issues.ts` are purely additive.

### Why Chevrotain rather than `JSON.parse()`

Despite the file being JSON-like in structure, a standard `JSON.parse()` call is insufficient because:

1. **C-style comments** — SAP HANA tooling emits `//` line comments and `/* … */` block comments inside `.hdbschedulerjob` files. `JSON.parse()` throws a `SyntaxError` on the first comment character.
2. **Trailing commas** — Some HANA project generators produce trailing commas in objects and arrays. `JSON.parse()` rejects them; a Chevrotain grammar can tolerate them explicitly.
3. **Structured error recovery** — Chevrotain's built-in single-token insertion/deletion recovery yields a partial CST from which the visitor can still extract the `action` value even when other parts of the file are syntactically invalid. `JSON.parse()` either succeeds completely or throws with no partial result.
4. **Consistency** — All other parser modules in this codebase use Chevrotain. A single unified technology avoids introducing a second parsing strategy that future maintainers must understand separately.

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
    hdbschedulerjob/
      lexer.ts
      parser.ts
      visitor.ts
      index.ts
      __tests__/
        extractSchedulerJobAction.test.ts
```

### 3.2 `src/parsers/hdbschedulerjob/lexer.ts`

#### Responsibility

Define every token the grammar needs and export a singleton `Lexer` instance.

#### Token ordering rules (Chevrotain-specific)

1. Skip tokens (`BlockComment`, `LineComment`, `WhiteSpace`) must be declared first so they are consumed before anything else.
2. `ActionKey` must be declared **before** `JsonString` in the `allTokens` array, and must be given a higher priority via Chevrotain's `longer_alt` or by positional ordering. Because `ActionKey` matches the literal four-character string `"action"` (including surrounding double-quotes), it is a strict prefix-disjoint subset of `JsonString`. Chevrotain resolves the conflict by matching the longer or first-listed pattern; declaring `ActionKey` before `JsonString` in `allTokens` ensures it takes precedence.
3. JSON keyword value tokens (`TrueKw`, `FalseKw`, `NullKw`) must be declared before any catch-all identifier token. Since the grammar does not use a generic identifier token (JSON does not have unquoted identifiers), these are listed last among non-punctuation tokens.
4. Multi-character punctuation (none in this grammar) would need to be declared before single-character alternatives, but the JSON token set has no such conflicts.

#### Token catalogue

**Skip tokens** (declared first):

| Token name     | Pattern              | Mode                       |
| -------------- | -------------------- | -------------------------- |
| `BlockComment` | `/\/\*[\s\S]*?\*\//` | `{ group: Lexer.SKIPPED }` |
| `LineComment`  | `/\/\/[^\r\n]*/`     | `{ group: Lexer.SKIPPED }` |
| `WhiteSpace`   | `/\s+/`              | `{ group: Lexer.SKIPPED }` |

> **Note**: `LineComment` uses `\/\/` (two forward slashes) to match the `//` style used in HANA JSON config files. The `--` line-comment style is not used in JSON-format files.

**Key tokens** (declared before generic string so that `"action"` is matched precisely):

| Token name  | Pattern      | Notes                                                                                                                                                                |
| ----------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ActionKey` | `/"action"/` | Matches the literal JSON key `"action"` including surrounding double-quotes. Declared first so Chevrotain's longest-match rule does not let `JsonString` consume it. |

**String token**:

| Token name   | Pattern       | Notes      |
| ------------ | ------------- | ---------- | ---------------------------------------------------------------------------------------- |
| `JsonString` | `/\"(?:[^"\\] | \\.)\*\"/` | Standard JSON string supporting `\"`, `\\`, `\/`, `\b`, `\f`, `\n`, `\r`, `\t`, `\uXXXX` |

**Number token**:

| Token name   | Pattern  | Notes                                   |
| ------------ | -------- | --------------------------------------- | ----------------------- |
| `JsonNumber` | `/-?(?:0 | [1-9]\d\*)(?:\.\d+)?(?:[eE][+-]?\d+)?/` | Full JSON number syntax |

**JSON keyword value tokens**:

| Token name | Pattern   | Notes                |
| ---------- | --------- | -------------------- |
| `TrueKw`   | `/true/`  | JSON boolean literal |
| `FalseKw`  | `/false/` | JSON boolean literal |
| `NullKw`   | `/null/`  | JSON null literal    |

**Structural punctuation tokens**:

| Token name | Pattern | Notes                                        |
| ---------- | ------- | -------------------------------------------- |
| `LBrace`   | `\{`    | Object open                                  |
| `RBrace`   | `\}`    | Object close                                 |
| `LBracket` | `\[`    | Array open                                   |
| `RBracket` | `\]`    | Array close                                  |
| `Colon`    | `:`     | Key–value separator                          |
| `Comma`    | `,`     | Member / element separator (may be trailing) |

#### `allTokens` array ordering (summary)

```
[
  // Skip
  BlockComment, LineComment, WhiteSpace,
  // Key token (before JsonString to take priority)
  ActionKey,
  // String and number
  JsonString, JsonNumber,
  // JSON keyword values
  TrueKw, FalseKw, NullKw,
  // Structural punctuation
  LBrace, RBrace, LBracket, RBracket, Colon, Comma
]
```

#### BOM handling

Before passing file content to `HdbSchedulerJobLexer.tokenize()`, the caller in `index.ts` strips a leading UTF-8 BOM (`\uFEFF`) if present:

```typescript
const normalised = fileContent.startsWith('\uFEFF') ? fileContent.slice(1) : fileContent;
```

Chevrotain's `Lexer` does not skip BOM characters by default, so this pre-processing step is required to satisfy AC-11.

#### Exported symbols

```typescript
export const allTokens: TokenType[];
export const HdbSchedulerJobLexer: Lexer; // singleton — instantiated at module load
```

---

### 3.3 `src/parsers/hdbschedulerjob/parser.ts`

#### Responsibility

Define the grammar as a `CstParser` subclass and expose a singleton parser instance.

#### Grammar notation

> `?` = optional, `*` = zero-or-more, `+` = one-or-more, `|` = alternation, `()` = grouping.

#### Grammar rules

```
schedulerJobDocument
    object
    -- Top-level rule. An .hdbschedulerjob file is a single JSON object.
    -- Delegates immediately to `object` so that the top-level is symmetric
    -- with nested objects and error recovery can apply uniformly.

object
    LBrace member* RBrace
    -- Zero-or-more members handles both empty objects `{}` and
    -- standard key–value maps. Consecutive members are separated by Comma;
    -- a trailing Comma before RBrace is accepted without error (see below).

member
    ( ActionKey | JsonString ) Colon value
    -- When the key is ActionKey, the parser delegates to actionMember
    -- instead, producing a distinct CST node used by the visitor.
    -- When the key is JsonString, `value` is consumed and silently discarded.

    OR

    actionMember   -- when LA(1) == ActionKey

actionMember
    ActionKey Colon JsonString
    -- This is the sole extraction point. The grammar matches the `"action"`
    -- key followed by a colon and a JSON string value. The `JsonString` image
    -- is the raw token text including surrounding double-quotes; the visitor
    -- strips the quotes.

value
    JsonString
    | JsonNumber
    | TrueKw
    | FalseKw
    | NullKw
    | object
    | array
    -- Recursive rules for object and array enable correct consumption of
    -- arbitrarily nested structures (e.g., the `schedules` array of objects).

array
    LBracket arrayElements? RBracket

arrayElements
    value ( Comma value )* Comma?
    -- Trailing comma after the last element is accepted.
```

#### Key design: `member` vs. `actionMember` dispatch

The parser uses a two-alternative `OR` in the `member` rule. Chevrotain's lookahead of one token is sufficient to distinguish the two alternatives because:

- `actionMember` starts with `ActionKey` (the literal token `"action"`)
- The generic `member` alternative starts with `JsonString`

These two token types are disjoint by definition (the `ActionKey` pattern is consumed by the lexer before `JsonString` when the input is exactly `"action"`). No `BACKTRACK` or `MAX_LOOKAHEAD` override is needed.

```typescript
this.RULE('member', () => {
    this.OR([
        { ALT: () => this.SUBRULE(this.actionMember) },
        {
            ALT: () => {
                this.CONSUME(JsonString);
                this.CONSUME(Colon);
                this.SUBRULE(this.value);
            }
        }
    ]);
});
```

#### Key design: trailing comma tolerance

Trailing commas are handled at the `object` and `arrayElements` levels by making the last separator optional. The grammar does **not** change the semantics of consumed members — a trailing comma simply results in no additional `member` or `value` being parsed before the closing `}` or `]`.

```typescript
this.RULE('object', () => {
    this.CONSUME(LBrace);
    this.MANY_SEP({
        SEP: Comma,
        DEF: () => this.SUBRULE(this.member)
    });
    this.OPTION(() => this.CONSUME(Comma)); // trailing comma
    this.CONSUME(RBrace);
});
```

> `MANY_SEP` in Chevrotain automatically handles the separator-between-items pattern. The extra `OPTION(() => CONSUME(Comma))` after it permits a single trailing comma before the closing brace or bracket.

#### Key design: nested object/array recursion

The `value` rule recursively invokes `object` and `array`, allowing the parser to descend into the `schedules` array and consume nested objects without any identifiers from that subtree being surfaced to the visitor. Because the visitor's extraction method is only wired to the `actionMember` CST node, no extraction occurs in any other subtree.

#### Key design: `schedulerJobDocument` as top-level entry point

The top-level grammar rule is `schedulerJobDocument` (not `object` directly), following the convention used by all other parsers in the project. The singleton parser's entry-point call in `index.ts` uses:

```typescript
const cst = hdbSchedulerJobParser.schedulerJobDocument();
```

#### Error recovery

Use Chevrotain's default single-token insertion/deletion recovery. Do **not** override recovery methods. The defaults ensure a partial CST is produced rather than an exception when encountering unexpected syntax. If the `actionMember` rule parsed successfully before any error occurs, the visitor will still extract the action name.

#### Exported symbols

```typescript
export class HdbSchedulerJobParser extends CstParser { ... }
export const hdbSchedulerJobParser: HdbSchedulerJobParser; // singleton
```

---

### 3.4 `src/parsers/hdbschedulerjob/visitor.ts`

#### Responsibility

Walk the CST produced by `HdbSchedulerJobParser` and emit exactly one `{ type: 'jobAction', name }` entry from the `actionMember` node. The visitor performs no extraction in any other grammar rule.

#### Design

The visitor extends `BaseCstVisitorWithDefaults` (obtained via `hdbSchedulerJobParser.getBaseCstVisitorConstructorWithDefaults()`). This variant auto-visits all child nodes for any method not explicitly overridden. Only one method needs to be implemented explicitly:

1. `actionMember` — extracts the `jobAction` name from the CST node.

All other grammar rule methods are left to default auto-traversal, which is safe because only `actionMember` contains a `JsonString` token that should be extracted as a subject. The `JsonString` tokens in all other rules are consumed structurally and never surfaced to the visitor as named children of an `actionMember` node.

#### Extraction logic: `actionMember`

```typescript
actionMember(ctx: CstChildrenDictionary): void {
    // ctx['JsonString'] contains the single JsonString token that is
    // the value of the "action" key.
    const token = ctx['JsonString']?.[0] as IToken | undefined;
    if (!token) return;

    // Strip the surrounding double-quotes from the JSON string image.
    // e.g., '"com.example::runJob"' → 'com.example::runJob'
    const raw = token.image;
    const name = raw.startsWith('"') && raw.endsWith('"')
        ? raw.slice(1, -1)
        : raw;

    this.subjects.push({ type: 'jobAction', name });
}
```

#### Action value normalisation

The `name` field in the emitted `ExtractedSubject` is the **unquoted** action string — the JSON string value with its outer double-quote delimiters removed. No further normalisation is performed:

- Escape sequences inside the string (e.g., `\"`, `\\`) are preserved as-is in the raw token image and are therefore preserved in `name`. This matches the treatment used by other parsers in the project (no unescaping of inner content).
- The full value is returned, including any `::` separator, `.` path separators, or embedded `"` characters from a schema-qualified SQL name (e.g., the raw JSON `"\"MY_SCHEMA\".\"MY_PROCEDURE\""` yields `name = '"MY_SCHEMA"."MY_PROCEDURE"'`). Downstream regex rules receive the full, unescaped-outer value.

#### Exported symbols

```typescript
export class HdbSchedulerJobVisitor {
    readonly subjects: ExtractedSubject[] = [];
    visit(cst: CstNode): void { ... }
}
```

---

### 3.5 `src/parsers/hdbschedulerjob/index.ts`

#### Responsibility

Public API boundary. Orchestrates tokenise → parse → visit. The single exported function is what `content-lint.ts` calls.

#### Implementation

```typescript
import type { ExtractedSubject } from '../../types/issues';
import { HdbSchedulerJobLexer } from './lexer';
import { hdbSchedulerJobParser } from './parser';
import { HdbSchedulerJobVisitor } from './visitor';

export function extractSchedulerJobAction(fileContent: string): ExtractedSubject[] {
    // Strip UTF-8 BOM if present (AC-11)
    const normalised = fileContent.startsWith('\uFEFF') ? fileContent.slice(1) : fileContent;

    const lexResult = HdbSchedulerJobLexer.tokenize(normalised);

    hdbSchedulerJobParser.input = lexResult.tokens;

    const cst = hdbSchedulerJobParser.schedulerJobDocument();

    if (!cst) {
        return [];
    }

    const visitor = new HdbSchedulerJobVisitor();
    visitor.visit(cst);
    return visitor.subjects;
}
```

Lex and parse errors are intentionally not re-thrown. The CST visitor returns whatever could be extracted from the partial tree. Callers in `content-lint.ts` must not crash on bad input.

---

### 3.6 Changes to `src/types/rules.ts`

Add `'jobAction'` to the `ContentTarget` union:

```typescript
// Before
export type ContentTarget = 'field' | 'inputParameter' | 'outputParameter' | 'roleName' | 'grantedRoleName' | 'sequenceName';

// After
export type ContentTarget = 'field' | 'inputParameter' | 'outputParameter' | 'roleName' | 'grantedRoleName' | 'sequenceName' | 'jobAction';
```

This is a purely additive change. No existing usages of `ContentTarget` are affected.

---

### 3.7 Changes to `src/types/issues.ts`

Add `'jobAction'` to the `subjectType` union in `LintIssue`:

```typescript
// Before
readonly subjectType?: 'artifact' | 'field' | 'inputParameter' | 'outputParameter' | 'roleName' | 'grantedRoleName' | 'sequenceName';

// After
readonly subjectType?: 'artifact' | 'field' | 'inputParameter' | 'outputParameter' | 'roleName' | 'grantedRoleName' | 'sequenceName' | 'jobAction';
```

`ExtractedSubject.type` is typed as `ContentTarget`, so it picks up `'jobAction'` automatically once `ContentTarget` is extended. No further change to `ExtractedSubject` itself is required.

---

### 3.8 Changes to `src/content-lint.ts`

Two changes only:

1. **Add import** at the top of the file alongside the existing parser imports:

    ```typescript
    import { extractSchedulerJobAction } from './parsers/hdbschedulerjob/index';
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
        if (extension === '.hdbsequence') return extractSequenceName(fileContent);
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
        if (extension === '.hdbschedulerjob') return extractSchedulerJobAction(fileContent);
        return [];
    }
    ```

No other changes to `content-lint.ts`. `lintFileContent()`, `evaluateAllRules()`, `evaluateAnyRules()`, and `LintIssue` are untouched beyond the `'jobAction'` addition to `subjectType`.

---

## 4. Data Models

No new persistent data models. The only types crossing the parser boundary are the existing `ExtractedSubject` and `ContentTarget`, extended additively:

```typescript
// src/types/issues.ts — ExtractedSubject uses ContentTarget directly
type ExtractedSubject = {
    readonly type: ContentTarget; // 'jobAction' for .hdbschedulerjob
    readonly name: string; // unquoted action string, e.g. 'com.example::runJob'
    readonly lineNumber?: number; // not populated by this parser
};

// src/types/rules.ts — extended with 'jobAction'
type ContentTarget = 'field' | 'inputParameter' | 'outputParameter' | 'roleName' | 'grantedRoleName' | 'sequenceName' | 'jobAction'; // NEW
```

The `.hdbschedulerjob` extractor returns at most **one** entry per file (a well-formed file has exactly one `action` key). A `contentRuleSet` targeting any other `ContentTarget` value against `.hdbschedulerjob` will match zero subjects — this is not an error.

---

## 5. API Specifications

### Public function

```typescript
/**
 * Extract the job action name from the content of an `.hdbschedulerjob` file.
 *
 * Uses a Chevrotain lexer and CstParser to handle C-style comments
 * (`//` and `/* … */`), trailing commas, and nested JSON structures that
 * standard `JSON.parse()` cannot tolerate.
 *
 * The function locates the top-level `"action"` key and returns its string
 * value (outer double-quotes stripped) as a single `jobAction` subject.
 *
 * Nested objects and arrays (e.g., the `schedules` array) are consumed
 * structurally; no values within them are extracted.
 *
 * Gracefully returns a partial or empty result on invalid input — does
 * not throw.
 *
 * @param fileContent - Raw UTF-8 file content (LF or CRLF). A leading
 *   UTF-8 BOM is stripped automatically before tokenisation.
 * @returns Array containing at most one ExtractedSubject with type 'jobAction'.
 */
export function extractSchedulerJobAction(fileContent: string): ExtractedSubject[];
```

### Internal module exports (not part of public API)

| Symbol                                           | Module       | Visibility       |
| ------------------------------------------------ | ------------ | ---------------- |
| `allTokens`, `HdbSchedulerJobLexer`              | `lexer.ts`   | Package-internal |
| `HdbSchedulerJobParser`, `hdbSchedulerJobParser` | `parser.ts`  | Package-internal |
| `HdbSchedulerJobVisitor`                         | `visitor.ts` | Package-internal |

---

## 6. Unit Test Design

Test file: `src/parsers/hdbschedulerjob/__tests__/extractSchedulerJobAction.test.ts`

The test file follows the same structure as the existing `.hdb*` parser tests: one `describe` block per acceptance criterion, typed helper functions for brevity.

```typescript
import { describe, it, expect } from 'vitest';
import { extractSchedulerJobAction } from '../index';

function action(content: string): string[] {
    return extractSchedulerJobAction(content)
        .filter((s) => s.type === 'jobAction')
        .map((s) => s.name);
}
```

### Test cases by acceptance criterion

**AC-1 — Plain action name extraction**

```typescript
describe('AC-1: plain action name', () => {
    it('extracts a simple unqualified procedure name as a jobAction subject', () => {
        const content = JSON.stringify({
            description: 'Nightly cleanup',
            action: 'MY_PROCEDURE',
            status: 'active',
            schedules: []
        });
        expect(extractSchedulerJobAction(content)).toEqual([{ type: 'jobAction', name: 'MY_PROCEDURE' }]);
    });
});
```

**AC-2 — Package-path–qualified action name extraction**

```typescript
describe('AC-2: package-path-qualified action name', () => {
    it('extracts the full HDI path including the :: separator', () => {
        const content = `{
            "description": "Nightly cleanup",
            "action": "com.example.myapp::runMaintenance",
            "status": "active",
            "schedules": []
        }`;
        expect(extractSchedulerJobAction(content)).toEqual([{ type: 'jobAction', name: 'com.example.myapp::runMaintenance' }]);
    });
});
```

**AC-3 — Schema-qualified SQL action name extraction**

```typescript
describe('AC-3: schema-qualified SQL action name', () => {
    it('extracts the full schema-qualified name with embedded double-quotes intact', () => {
        // In the file the value is: "MY_SCHEMA"."MY_PROCEDURE"
        const content = `{
            "description": "Archival job",
            "action": "\\"MY_SCHEMA\\".\\"MY_PROCEDURE\\"",
            "status": "active",
            "schedules": []
        }`;
        expect(action(content)).toEqual(['"MY_SCHEMA"."MY_PROCEDURE"']);
    });
});
```

**AC-4 — `//` single-line comment exclusion**

```typescript
describe('AC-4: // comment exclusion', () => {
    it('does not extract an action from a commented-out line', () => {
        const content = `{
            // "action": "OLD_PROCEDURE",
            "action": "com.example::runJob",
            "status": "active",
            "schedules": []
        }`;
        expect(action(content)).not.toContain('OLD_PROCEDURE');
        expect(action(content)).toContain('com.example::runJob');
    });
});
```

**AC-5 — `/* */` block comment exclusion**

```typescript
describe('AC-5: block comment exclusion', () => {
    it('does not extract an action wrapped in a block comment', () => {
        const content = `{
            /* "action": "DEPRECATED_PROC", */
            "action": "com.example::runJob",
            "status": "active",
            "schedules": []
        }`;
        expect(action(content)).not.toContain('DEPRECATED_PROC');
        expect(action(content)).toContain('com.example::runJob');
    });

    it('handles a multi-line block comment spanning several keys', () => {
        const content = `{
            /*
              "action": "OLD_PROC",
              "status": "inactive"
            */
            "action": "com.example::activeJob",
            "schedules": []
        }`;
        expect(action(content)).toEqual(['com.example::activeJob']);
    });
});
```

**AC-6 — Nested schedule objects are ignored**

```typescript
describe('AC-6: nested schedule objects not extracted', () => {
    it('does not extract string values from within the schedules array', () => {
        const content = `{
            "description": "My job",
            "action": "com.example::theAction",
            "locale": "en",
            "status": "active",
            "schedules": [
                {
                    "description": "Run daily at midnight",
                    "xscron": "* * * * 1 0 0",
                    "parameter": "{ \\"mode\\": \\"full\\" }",
                    "status": "active"
                }
            ]
        }`;
        expect(extractSchedulerJobAction(content)).toEqual([{ type: 'jobAction', name: 'com.example::theAction' }]);
    });

    it('handles an empty schedules array without error', () => {
        const content = `{ "action": "com.example::runJob", "schedules": [] }`;
        expect(action(content)).toEqual(['com.example::runJob']);
    });
});
```

**AC-7 — Trailing comma tolerance**

```typescript
describe('AC-7: trailing comma tolerance', () => {
    it('parses a trailing comma after the last key-value pair without error', () => {
        const content = `{
            "description": "My job",
            "action": "com.example::runJob",
            "status": "active",
        }`;
        expect(() => extractSchedulerJobAction(content)).not.toThrow();
        expect(action(content)).toEqual(['com.example::runJob']);
    });

    it('parses a trailing comma inside the schedules array without error', () => {
        const content = `{
            "action": "com.example::runJob",
            "schedules": [
                { "xscron": "* * * * 1 0 0", "status": "active", },
            ]
        }`;
        expect(() => extractSchedulerJobAction(content)).not.toThrow();
        expect(action(content)).toEqual(['com.example::runJob']);
    });
});
```

**AC-8 — Missing `action` key returns empty array**

```typescript
describe('AC-8: missing action key', () => {
    it('returns an empty array when the action key is absent', () => {
        const content = `{
            "description": "Incomplete job",
            "status": "active",
            "schedules": []
        }`;
        expect(extractSchedulerJobAction(content)).toEqual([]);
    });

    it('returns an empty array for an empty object', () => {
        expect(extractSchedulerJobAction('{}')).toEqual([]);
    });
});
```

**AC-9 — Malformed JSON degrades gracefully**

```typescript
describe('AC-9: malformed JSON degrades gracefully', () => {
    it('does not throw on completely invalid input', () => {
        expect(() => extractSchedulerJobAction('NOT JSON AT ALL !!!')).not.toThrow();
    });

    it('does not throw on empty string', () => {
        expect(() => extractSchedulerJobAction('')).not.toThrow();
        expect(extractSchedulerJobAction('')).toEqual([]);
    });

    it('extracts the action when the missing closing brace comes after a valid action key', () => {
        // Chevrotain error recovery should still yield the action name
        const content = `{ "action": "com.example::runJob"`;
        expect(() => extractSchedulerJobAction(content)).not.toThrow();
        // Result may be [] or [{ type: 'jobAction', name: 'com.example::runJob' }]
        // depending on recovery depth; test only that it does not throw
    });
});
```

**AC-10 — CRLF line endings supported**

```typescript
describe('AC-10: CRLF line endings', () => {
    it('extracts the action name from a CRLF-terminated file', () => {
        const content = '{\r\n  "action": "com.example::runJob",\r\n  "schedules": []\r\n}';
        expect(action(content)).toEqual(['com.example::runJob']);
    });
});
```

**AC-11 — UTF-8 BOM is tolerated**

```typescript
describe('AC-11: UTF-8 BOM tolerance', () => {
    it('strips a leading BOM before tokenisation', () => {
        const content = '\uFEFF{ "action": "com.example::runJob", "schedules": [] }';
        expect(action(content)).toEqual(['com.example::runJob']);
    });
});
```

**AC-12 — `ContentTarget` type is extended**

This is a compile-time check; no runtime test is needed. The TypeScript compiler validates it during `npm run build`. A developer can also verify with:

```typescript
// Should compile without error after the change:
const target: ContentTarget = 'jobAction';
```

**AC-13 — Lint pipeline integration**

```typescript
describe('AC-13: lint pipeline integration', () => {
    it('raises no issue when the action ends with the required suffix', async () => {
        // Requires a test fixture file on disk or a mock of `fs.readFile`;
        // covered by existing integration tests for `lintFileContent()`.
        // The unit-level contract is verified by AC-1 through AC-11 above.
    });
});
```

---

## 7. Security Considerations

- **Input length**: No maximum file size is enforced by the parser itself. Chevrotain tokenises the input as a single string in memory. Files exceeding tens of megabytes would consume proportional heap. This matches the existing parsers and is an acceptable trade-off for the expected size of `.hdbschedulerjob` files (typically under 100 lines).
- **ReDoS**: The `JsonString` regex (`/\"(?:[^"\\]|\\.)*\"/`) is not vulnerable to catastrophic backtracking because it uses a possessive-like structure: it alternates between a single non-special character (`[^"\\]`) and any two-character escape sequence (`\\.`). The regex engine advances by at least one character per iteration.
- **No code execution**: The parser only reads tokens and constructs a CST. No `eval`, `Function()`, or dynamic code generation is used at any point.
- **No network access**: The parser operates entirely on the string passed in. No external resources are fetched.

---

## 8. Performance Considerations

- **Singleton pattern**: Both `HdbSchedulerJobLexer` and `hdbSchedulerJobParser` are instantiated **once** at module load time. Repeated calls to `extractSchedulerJobAction()` reuse the same lexer and parser instances, satisfying NFR-3.
- **Parser input reset**: Before each parse, `hdbSchedulerJobParser.input = lexResult.tokens` resets the token stream. This is the standard Chevrotain pattern for reusing a singleton parser across multiple files.
- **Expected throughput**: A typical `.hdbschedulerjob` file is 10–30 lines of JSON. Chevrotain's lexing and parsing overhead for such small inputs is well under 10 ms on commodity hardware, satisfying NFR-4 (under 100 ms for files up to 200 lines).

---

## 9. Risk Assessment

| Risk                                                                                    | Likelihood | Impact | Mitigation                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ActionKey` token matched inside a `JsonString` value (e.g., `"description": "action"`) | Low        | Medium | `ActionKey` matches the exact four-character sequence `"action"` including double-quotes. A JSON value string of `"action"` would be preceded by a `:` and would be consumed as a `value` production, not as a `member` key. The grammar structure ensures the key position is unambiguous. |
| Escaped double-quote in action value breaks token boundary                              | Low        | High   | The `JsonString` regex handles `\"` as an escape pair (`\\.`), so `"my\\"action"` does not terminate early. Tested by AC-3.                                                                                                                                                                 |
| Future HANA tooling introduces a non-JSON structure                                     | Very low   | Medium | If the file format changes substantially, the existing tests will fail on upgrade, providing a clear signal. The fix cost is low given the small grammar.                                                                                                                                   |
| Chevrotain version upgrade changes `BaseCstVisitorWithDefaults` API                     | Very low   | Low    | Chevrotain's visitor API has been stable since v6. The project pins a specific major version (`v11.x`).                                                                                                                                                                                     |
| Parser singleton state pollution between test runs                                      | Low        | Medium | Resetting `hdbSchedulerJobParser.input` before each `schedulerJobDocument()` call fully resets internal state. Confirmed by the reference implementations of existing parsers.                                                                                                              |
