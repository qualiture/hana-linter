# Technical Design Specification: Chevrotain Lexer/Parser for `.hdbtrigger`

**PRD**: [prd.md](./prd.md)  
**Feature**: Chevrotain `.hdbtrigger` Trigger Name Extractor  
**Status**: Ready for Implementation

---

## 1. System Architecture Overview

### Current state

`extractSubjects()` in `src/content-lint.ts` has no handler for `.hdbtrigger` files. When a file with that extension is processed, the function falls through to the `return []` catch-all, silently yielding no subjects and no lint output.

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
        ├── '.hdbschedulerjob'    → extractSchedulerJobAction()
        ├── '.hdbindex'           → extractIndexName()
        └── (default)             → []   ← .hdbtrigger silently falls here
```

In addition, the `ContentTarget` union type in `src/types/rules.ts` and the `subjectType` union in `LintIssue` in `src/types/issues.ts` do not include `'triggerName'`, so even if a user configures a `contentRuleSet` for `.hdbtrigger` the target value would be unresolvable at the type level.

### Target state

A new `src/parsers/hdbtrigger/` sub-module mirrors the structure of all existing `.hdb*` parser modules. `extractSubjects()` gains a dedicated `.hdbtrigger` branch. The two type unions are extended additively with `'triggerName'`.

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
        ├── '.hdbschedulerjob'    → extractSchedulerJobAction()
        ├── '.hdbindex'           → extractIndexName()
        └── '.hdbtrigger'         → extractTriggerName()   ← NEW

src/parsers/hdbtrigger/
  ├── lexer.ts      Token definitions + singleton Lexer instance
  ├── parser.ts     CstParser subclass + grammar rules
  ├── visitor.ts    CST visitor that collects the trigger name
  └── index.ts      Public API: extractTriggerName()
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
    hdbtrigger/
      lexer.ts
      parser.ts
      visitor.ts
      index.ts
      __tests__/
        extractTriggerName.test.ts
```

### 3.2 `src/parsers/hdbtrigger/lexer.ts`

#### Responsibility

Define every token the grammar needs and export a singleton `Lexer` instance.

#### Token ordering rules (Chevrotain-specific)

1. Skip tokens (`BlockComment`, `LineComment`, `WhiteSpace`) must be declared first so they are consumed before anything else.
2. `Identifier` must be declared **before** keyword tokens in the `allTokens` array so that keyword tokens can reference it via `longer_alt`. Every keyword token must declare `longer_alt: Identifier` to prevent identifiers whose names begin with a keyword prefix (e.g., `TRIGGER_NAME`, `BEFORE_DATE`, `INSERT_FLAG`, `ON_CHANGE`, `INSTEAD_OF_LOOKUP`, `REFERENCING_TABLE`, `STATEMENT_ID`) from being incorrectly tokenised as the keyword.
3. `QuotedIdentifier` must appear **before** `Identifier` in the `allTokens` array.
4. The two custom opaque-block tokens (`TriggerBody`, `WhenBody`) must appear **before** `Identifier` and all keyword tokens so the lexer matches them greedily before attempting keyword or identifier tokenisation. `TriggerBody` in particular must appear before any keyword that could appear as a bare word inside the body.

#### Prefix-conflict pairs requiring explicit ordering

The `.hdbtrigger` grammar has no multi-character comparison operator tokens at the grammar level (the `WHEN` condition body is consumed as an opaque `WhenBody` token). The only ordering constraints beyond the skip-first rule are:

1. `TriggerBody` and `WhenBody` before all keyword/identifier tokens.
2. `Identifier` before all keyword tokens (for `longer_alt` references).
3. `QuotedIdentifier` before `Identifier`.

#### Special opaque-block tokens

Two custom pattern functions produce opaque-block tokens that prevent internal keywords and identifiers from being presented to the grammar as individual tokens.

##### `TriggerBody`

**Purpose**: Match the entire `BEGIN … END` block — including any nested `BEGIN/END` pairs from `IF/END IF`, `LOOP/END LOOP`, `CASE/END CASE`, and inner `BEGIN/END` blocks — as a single indivisible token.

**Implementation**: A Chevrotain [custom token pattern](https://chevrotain.io/docs/guide/custom_token_patterns.html) function. The function:

1. Checks whether the next character sequence matches `BEGIN` (case-insensitive word boundary: the character immediately following must be a non-identifier character).
2. If not, returns `null`.
3. If yes, initialises a `depth` counter to `1` and scans forward character-by-character, incrementing `depth` on each subsequent `BEGIN` word and decrementing on each `END` word (where "word" means surrounded by non-identifier characters).
4. When `depth` reaches `0`, the function returns the substring from the opening `B` through the closing `D` of the final `END` as the matched image.
5. The match includes any trailing whitespace that is part of the matched range but is stripped from the image by Chevrotain's normal processing.

> **CASE/END disambiguation**: `CASE … END` inside SQLScript increments and decrements the same depth counter, which is correct — the `END` that closes a `CASE` block also signals a `depth--`. Because every such `END` is balanced by its corresponding `BEGIN` or `CASE`, the final `END` at depth `0` is always the trigger body closer.

> **Position tracking**: The custom pattern function receives the `offset` parameter from Chevrotain and must return both the matched text and the updated `offset`. Chevrotain handles line/column tracking automatically.

##### `WhenBody`

**Purpose**: Match the parenthesised predicate expression of the `WHEN (…)` clause — including any nested parentheses (e.g., function calls like `f(x, g(y))`) — as a single indivisible token.

**Implementation**: A Chevrotain custom token pattern function. The function:

1. Checks whether the next character is `(`.
2. If not, returns `null`.
3. If yes, initialises a `depth` counter to `1` and scans forward character-by-character, incrementing `depth` on each `(` and decrementing on each `)`.
4. When `depth` reaches `0`, the function returns the substring from the opening `(` through the closing `)` as the matched image.

The `WhenBody` token must appear in `allTokens` **before** `LParen` so that a `(` immediately following the `WHEN` keyword is matched as an opaque block rather than as a bare `LParen` token. At the grammar level, the `whenClause` rule consumes `WhenKw` followed by a single `WhenBody` token; the `LParen` token is never consumed as part of a `whenClause` production.

#### Token catalogue

**Skip tokens** (declared first):

| Token name     | Pattern              | Mode                       |
| -------------- | -------------------- | -------------------------- |
| `BlockComment` | `/\/\*[\s\S]*?\*\//` | `{ group: Lexer.SKIPPED }` |
| `LineComment`  | `/--[^\r\n]*/`       | `{ group: Lexer.SKIPPED }` |
| `WhiteSpace`   | `/\s+/`              | `{ group: Lexer.SKIPPED }` |

**Opaque-block tokens** (declared after skip tokens, before all other tokens):

| Token name    | Pattern                                   | Notes                                               |
| ------------- | ----------------------------------------- | --------------------------------------------------- |
| `TriggerBody` | Custom function (nested `BEGIN…END` scan) | Consumes the entire trigger body as one token       |
| `WhenBody`    | Custom function (balanced `(…)` scan)     | Consumes the entire WHEN predicate including parens |

**Identifier tokens** (declared before keywords so `longer_alt` can reference them):

| Token name         | Pattern                    | Notes                                          |
| ------------------ | -------------------------- | ---------------------------------------------- |
| `Identifier`       | `/[A-Za-z_][A-Za-z0-9_]*/` | Catch-all; all keyword tokens use `longer_alt` |
| `QuotedIdentifier` | `/"[^"]*"/`                | Declared before `Identifier` in `allTokens`    |

**Trigger DDL keyword tokens** (all declare `longer_alt: Identifier`):

| Token name      | Pattern          | Notes                                                                                   |
| --------------- | ---------------- | --------------------------------------------------------------------------------------- |
| `CreateKw`      | `/CREATE/i`      | Optional leading keyword; `longer_alt: Identifier`                                      |
| `TriggerKw`     | `/TRIGGER/i`     | Mandatory statement keyword; `longer_alt: Identifier`                                   |
| `BeforeKw`      | `/BEFORE/i`      | Timing option; `longer_alt: Identifier`; `BEFORE_DATE` → `Identifier`                   |
| `AfterKw`       | `/AFTER/i`       | Timing option; `longer_alt: Identifier`; `AFTER_UPDATE` → `Identifier`                  |
| `InsteadKw`     | `/INSTEAD/i`     | First token of `INSTEAD OF` timing; `longer_alt: Identifier`                            |
| `OfKw`          | `/OF/i`          | Second token of `INSTEAD OF`; also used in `UPDATE OF`; `longer_alt: Identifier`        |
| `InsertKw`      | `/INSERT/i`      | Event keyword; `longer_alt: Identifier`; `INSERT_FLAG` → `Identifier`                   |
| `UpdateKw`      | `/UPDATE/i`      | Event keyword; `longer_alt: Identifier`; `UPDATE_COUNT` → `Identifier`                  |
| `DeleteKw`      | `/DELETE/i`      | Event keyword; `longer_alt: Identifier`; `DELETE_FLAG` → `Identifier`                   |
| `OnKw`          | `/ON/i`          | Separates event from table name; `longer_alt: Identifier`; `ON_CHANGE` → `Identifier`   |
| `ReferencingKw` | `/REFERENCING/i` | Introduces the REFERENCING clause; `longer_alt: Identifier`                             |
| `OldKw`         | `/OLD/i`         | OLD ROW / OLD TABLE in REFERENCING clause; `longer_alt: Identifier`                     |
| `NewKw`         | `/NEW/i`         | NEW ROW / NEW TABLE in REFERENCING clause; `longer_alt: Identifier`                     |
| `RowKw`         | `/ROW/i`         | Used in REFERENCING and FOR EACH clauses; `longer_alt: Identifier`                      |
| `TableKw`       | `/TABLE/i`       | Used in REFERENCING clause; `longer_alt: Identifier`                                    |
| `AsKw`          | `/AS/i`          | Introduces alias in REFERENCING clause; `longer_alt: Identifier`                        |
| `ForKw`         | `/FOR/i`         | Introduces FOR EACH clause; `longer_alt: Identifier`; `FOREIGN_KEY` → `Identifier`      |
| `EachKw`        | `/EACH/i`        | Part of FOR EACH clause; `longer_alt: Identifier`                                       |
| `StatementKw`   | `/STATEMENT/i`   | FOR EACH STATEMENT granularity; `longer_alt: Identifier`; `STATEMENT_ID` → `Identifier` |
| `WhenKw`        | `/WHEN/i`        | Introduces the WHEN clause; `longer_alt: Identifier`                                    |

**Punctuation tokens**:

| Token name  | Pattern | Notes                                   |
| ----------- | ------- | --------------------------------------- |
| `LParen`    | `\(`    | Used outside the WHEN clause (reserved) |
| `RParen`    | `\)`    | Closing paren outside WHEN clause       |
| `Comma`     | `,`     | Separates column names in UPDATE OF     |
| `Semicolon` | `;`     | Optional statement terminator           |
| `Dot`       | `\.`    | Schema qualifier separator              |

> **Note on `LParen`/`RParen`**: Because `WhenBody` is declared before `LParen` in `allTokens`, the lexer always matches a `(` immediately following `WHEN` as a `WhenBody`. The `LParen`/`RParen` tokens are therefore only produced in positions where the grammar context would otherwise expect them (e.g., future grammar extensions). They are included in the token catalogue for completeness and to allow Chevrotain's error recovery to function.

#### `allTokens` array ordering (summary)

```
[
  // Skip
  BlockComment, LineComment, WhiteSpace,
  // Opaque block tokens (before identifiers and keywords)
  TriggerBody, WhenBody,
  // Identifiers (declared before keywords for longer_alt references)
  Identifier, QuotedIdentifier,
  // Trigger DDL keywords
  CreateKw, TriggerKw,
  BeforeKw, AfterKw, InsteadKw, OfKw,
  InsertKw, UpdateKw, DeleteKw,
  OnKw,
  ReferencingKw, OldKw, NewKw, RowKw, TableKw, AsKw,
  ForKw, EachKw, StatementKw,
  WhenKw,
  // Punctuation
  LParen, RParen, Comma, Semicolon, Dot
]
```

#### Exported symbols

```typescript
export const allTokens: TokenType[];
export const HdbTriggerLexer: Lexer; // singleton — instantiated at module load
```

---

### 3.3 `src/parsers/hdbtrigger/parser.ts`

#### Responsibility

Define the grammar as a `CstParser` subclass and expose a singleton parser instance.

#### Grammar notation

> `?` = optional, `*` = zero-or-more, `+` = one-or-more, `|` = alternation, `()` = grouping.

#### Grammar rules

```
triggerStatement
    CreateKw? TriggerKw triggerName triggerTiming triggerEvent
    OnKw tableName
    referencingClause? forEachClause? whenClause?
    TriggerBody Semicolon?
    -- Top-level rule.
    -- CREATE is optional; TriggerKw is the mandatory anchor.
    -- Trigger body is consumed as a single opaque TriggerBody token.
    -- Trailing semicolon is optional.

triggerName
    identifier (Dot identifier)?
    -- identifier = Identifier | QuotedIdentifier
    -- Handles plain TRG_AI_T and schema-qualified "MY_SCHEMA"."TRG_AI_T".
    -- The schema qualifier (before Dot), if present, is consumed structurally
    -- but NOT included in the extracted subject name.

triggerTiming
    BeforeKw
    | AfterKw
    | InsteadKw OfKw
    -- BEFORE and AFTER are single-token alternatives.
    -- INSTEAD OF is a two-token sequence; Chevrotain resolves on LA(1) = InsteadKw.

triggerEvent
    InsertKw
    | DeleteKw
    | UpdateKw (OfKw updateColumnList)?
    -- INSERT and DELETE are single-token alternatives.
    -- UPDATE is followed by an optional OF <columnList> modifier.
    -- The column list is consumed and not extracted.

updateColumnList
    identifier (Comma identifier)*
    -- One or more comma-separated column identifiers.
    -- Consumed without extraction.

tableName
    identifier (Dot identifier)?
    -- Same schema-qualified structure as triggerName; consumed but not extracted.

referencingClause
    ReferencingKw referencingItem+
    -- The REFERENCING keyword followed by one or more correlation-name bindings.

referencingItem
    (OldKw | NewKw) (RowKw | TableKw) AsKw identifier
    -- Each item binds OLD or NEW to ROW or TABLE and assigns a correlation name.
    -- Example: OLD ROW AS OLD_ROW  |  NEW TABLE AS NEW_TBL
    -- The correlation-name identifier is consumed but not extracted.

forEachClause
    ForKw EachKw (RowKw | StatementKw)
    -- FOR EACH ROW or FOR EACH STATEMENT.
    -- Consumed without extraction.

whenClause
    WhenKw WhenBody
    -- WhenBody is a lexer-level opaque-block token matching (condition).
    -- The entire predicate (including its wrapping parentheses) is consumed
    -- as a single token; no grammar-level analysis of the condition is performed.

identifier
    QuotedIdentifier | Identifier
    -- Shared leaf rule used by triggerName, tableName, updateColumnList,
    -- and referencingItem.
```

#### Key design: `TriggerBody` as a lexer-level token

The trigger body is consumed at the **lexer** level, not the grammar level. When the lexer encounters the word `BEGIN` in the input stream, the `TriggerBody` custom pattern function activates, scans forward counting `BEGIN`/`END` word boundaries until the depth counter reaches zero, and emits a single `TriggerBody` token whose image is the full `BEGIN … END` text.

Because `TriggerBody` appears before all keyword and identifier tokens in `allTokens`, the lexer always chooses this pattern when `BEGIN` is the next word. The grammar rule `triggerStatement` then simply consumes this token:

```typescript
this.CONSUME(TriggerBody);
```

This design means:

- No SQLScript keywords inside the body appear in the token stream.
- No grammar-level lookahead is needed to delimit the body.
- The parser never needs to recursively parse body statements.
- Chevrotain's error recovery is never invoked inside the body — from the parser's perspective, the body is a leaf token.

#### Key design: `WhenBody` as a lexer-level token

The `WHEN` predicate expression is consumed at the **lexer** level by the `WhenBody` custom pattern function. The function matches a balanced parenthesised expression starting from `(`. Because `WhenBody` is declared before `LParen` in `allTokens`, a `(` immediately following `WHEN` is always consumed as `WhenBody`.

The grammar rule `whenClause` consumes exactly two tokens:

```typescript
this.RULE('whenClause', () => {
    this.CONSUME(WhenKw);
    this.CONSUME(WhenBody);
});
```

This means function calls like `WHEN (f(x) > 0 AND g(y) IS NOT NULL)` are handled correctly — nested parentheses are balanced by the `WhenBody` scanner, so the outer `)` is the one that closes the top-level match.

#### Key design: `triggerTiming` — `INSTEAD OF` two-token sequence

`INSTEAD OF` is a two-word timing keyword. Chevrotain resolves the outer OR on LA(1):

```typescript
this.RULE('triggerTiming', () => {
    this.OR([
        { ALT: () => this.CONSUME(BeforeKw) },
        { ALT: () => this.CONSUME(AfterKw) },
        {
            ALT: () => {
                this.CONSUME(InsteadKw);
                this.CONSUME(OfKw);
            }
        }
    ]);
});
```

- LA(1) = `BeforeKw` → first alternative.
- LA(1) = `AfterKw` → second alternative.
- LA(1) = `InsteadKw` → third alternative; then `OfKw` is consumed as LA(2).

No `BACKTRACK` or `MAX_LOOKAHEAD` override is needed.

#### Key design: `triggerEvent` — `UPDATE OF` with optional column list

`OfKw` is shared between `triggerTiming` (`INSTEAD OF`) and `triggerEvent` (`UPDATE OF`). There is no ambiguity because:

- In `triggerTiming`, `OfKw` always follows `InsteadKw`.
- In `triggerEvent`, `OfKw` follows `UpdateKw`.

The grammar uses `OPTION` for the `OF <columnList>` modifier:

```typescript
this.RULE('triggerEvent', () => {
    this.OR([
        { ALT: () => this.CONSUME(InsertKw) },
        { ALT: () => this.CONSUME(DeleteKw) },
        {
            ALT: () => {
                this.CONSUME(UpdateKw);
                this.OPTION(() => {
                    this.CONSUME(OfKw);
                    this.SUBRULE(this.updateColumnList);
                });
            }
        }
    ]);
});
```

#### Key design: `referencingClause` — multiple `referencingItem` productions

The `REFERENCING` clause may bind any combination of `OLD ROW`, `NEW ROW`, `OLD TABLE`, and `NEW TABLE`. The grammar uses `AT_LEAST_ONE` to require at least one binding and handles the inner alternation per item:

```typescript
this.RULE('referencingClause', () => {
    this.CONSUME(ReferencingKw);
    this.AT_LEAST_ONE(() => this.SUBRULE(this.referencingItem));
});

this.RULE('referencingItem', () => {
    this.OR([{ ALT: () => this.CONSUME(OldKw) }, { ALT: () => this.CONSUME(NewKw) }]);
    this.OR2([{ ALT: () => this.CONSUME(RowKw) }, { ALT: () => this.CONSUME(TableKw) }]);
    this.CONSUME(AsKw);
    this.SUBRULE(this.identifier);
});
```

The parser uses LA(1) to choose between `OldKw` and `NewKw`, and LA(1) again to choose between `RowKw` and `TableKw`. No ambiguity exists.

#### Key design: optional prefix clauses with distinct lookahead tokens

The three optional clauses (`referencingClause`, `forEachClause`, `whenClause`) all have distinct LA(1) tokens (`ReferencingKw`, `ForKw`, `WhenKw`). Chevrotain's `OPTION` resolves each independently without any lookahead conflict:

```typescript
this.RULE('triggerStatement', () => {
    this.OPTION(() => this.CONSUME(CreateKw));
    this.CONSUME(TriggerKw);
    this.SUBRULE(this.triggerName);
    this.SUBRULE(this.triggerTiming);
    this.SUBRULE(this.triggerEvent);
    this.CONSUME(OnKw);
    this.SUBRULE(this.tableName);
    this.OPTION2(() => this.SUBRULE(this.referencingClause));
    this.OPTION3(() => this.SUBRULE(this.forEachClause));
    this.OPTION4(() => this.SUBRULE(this.whenClause));
    this.CONSUME(TriggerBody);
    this.OPTION5(() => this.CONSUME(Semicolon));
});
```

#### Key design: schema-qualified names in `triggerName`

`triggerName` uses an `OPTION` for the `Dot identifier` suffix to handle both qualified and unqualified forms. The visitor always extracts the **last** `identifier` child (the local name), regardless of whether a schema qualifier is present:

```typescript
this.RULE('triggerName', () => {
    this.SUBRULE(this.identifier);
    this.OPTION(() => {
        this.CONSUME(Dot);
        this.SUBRULE2(this.identifier);
    });
});
```

The same `Dot identifier?` pattern is used for `tableName` (consumed but not extracted).

#### Error recovery

Use Chevrotain's default single-token insertion/deletion recovery. Do **not** override recovery methods. The defaults ensure a partial CST is produced rather than an exception when encountering unexpected syntax. Because `triggerName` is parsed immediately after `TriggerKw` — the mandatory anchor — any error that occurs after the name has been consumed will still allow the visitor to extract the trigger name successfully.

#### Exported symbols

```typescript
export class HdbTriggerParser extends CstParser { ... }
export const hdbTriggerParser: HdbTriggerParser; // singleton
```

---

### 3.4 `src/parsers/hdbtrigger/visitor.ts`

#### Responsibility

Walk the CST produced by `HdbTriggerParser` and emit exactly one `{ type: 'triggerName', name }` entry from the `triggerName` node. The visitor performs no extraction from `tableName`, `updateColumnList`, `referencingClause`, `referencingItem`, `forEachClause`, `whenClause`, or `triggerTiming`/`triggerEvent`.

#### Design

The visitor extends `BaseCstVisitorWithDefaults` (obtained via `hdbTriggerParser.getBaseCstVisitorConstructorWithDefaults()`). This variant auto-visits all child nodes for any method not explicitly overridden. Only three methods need to be implemented explicitly:

1. `triggerName` — extracts the local trigger name from the CST node.
2. `referencingItem` — overridden as a no-op to prevent auto-traversal into the correlation-name `identifier` child.
3. `updateColumnList` — overridden as a no-op to prevent auto-traversal into the column-name `identifier` children.

All other grammar rule methods (`triggerStatement`, `triggerTiming`, `triggerEvent`, `tableName`, `forEachClause`, `whenClause`) are left to default auto-traversal, which is safe because:

- `tableName` delegates to `identifier` but is not a child of `triggerName` in the CST. The visitor only overrides `triggerName`, so it never processes the `identifier` children of `tableName`.
- `forEachClause` and `whenClause` contain no `identifier` children — they consume keyword tokens and the opaque `WhenBody` token respectively.
- `triggerTiming` and `triggerEvent` consume keyword tokens; the `OfKw` token and `updateColumnList` children of `triggerEvent` are handled by the explicit `updateColumnList` no-op override.
- `referencingItem`'s correlation-name `identifier` child is suppressed by the explicit no-op override.

#### Extraction logic: `triggerName`

```typescript
triggerName(ctx: CstChildrenDictionary): void {
    // ctx['identifier'] contains 1 or 2 identifier sub-rule result nodes:
    //   [0] = schema qualifier (when schema-qualified form is used)
    //   [1] = local trigger name  (only element when unqualified)
    //
    // Always take the LAST identifier node — this is the local name
    // regardless of whether a schema qualifier is present.
    const identifierNodes = ctx['identifier'] as CstNode[] | undefined;
    if (!identifierNodes?.length) return;

    const localNameNode = identifierNodes[identifierNodes.length - 1];
    const name = this.extractIdentifierName(localNameNode);
    if (!name) return;

    this.subjects.push({ type: 'triggerName', name });
}
```

#### Suppressing extraction in `referencingItem` and `updateColumnList`

Override both methods with explicit no-ops to prevent `BaseCstVisitorWithDefaults` from traversing into their `identifier` children:

```typescript
referencingItem(_ctx: CstChildrenDictionary): void {
    // Intentionally empty — the correlation-name alias assigned by
    // OLD/NEW ROW/TABLE AS <alias> must NOT be extracted as a subject.
}

updateColumnList(_ctx: CstChildrenDictionary): void {
    // Intentionally empty — column names in the UPDATE OF clause must
    // NOT be extracted as subjects.
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

#### Trigger name uniqueness

A well-formed `.hdbtrigger` file contains exactly one trigger definition. The visitor emits at most one `ExtractedSubject`. If the CST contains multiple `triggerName` nodes due to Chevrotain error recovery producing extra nodes, only the first successfully-extracted name is included (the grammar's `triggerStatement` rule has exactly one `triggerName` production per file).

#### Exported symbols

```typescript
export class HdbTriggerNameVisitor {
    readonly subjects: ExtractedSubject[] = [];
    visit(cst: CstNode): void { ... }
}
```

---

### 3.5 `src/parsers/hdbtrigger/index.ts`

#### Responsibility

Public API boundary. Orchestrates tokenise → parse → visit. The single exported function is what `content-lint.ts` calls.

#### Implementation

```typescript
import type { ExtractedSubject } from '../../types/issues';
import { HdbTriggerLexer } from './lexer';
import { hdbTriggerParser } from './parser';
import { HdbTriggerNameVisitor } from './visitor';

export function extractTriggerName(fileContent: string): ExtractedSubject[] {
    const lexResult = HdbTriggerLexer.tokenize(fileContent);

    hdbTriggerParser.input = lexResult.tokens;

    const cst = hdbTriggerParser.triggerStatement();

    if (!cst) {
        return [];
    }

    const visitor = new HdbTriggerNameVisitor();
    visitor.visit(cst);
    return visitor.subjects;
}
```

Lex and parse errors are intentionally not re-thrown. The CST visitor returns whatever could be extracted from the partial tree. Callers in `content-lint.ts` must not crash on bad input.

---

### 3.6 Changes to `src/types/rules.ts`

Add `'triggerName'` to the `ContentTarget` union:

```typescript
// Before
export type ContentTarget =
    | 'field'
    | 'inputParameter'
    | 'outputParameter'
    | 'roleName'
    | 'grantedRoleName'
    | 'sequenceName'
    | 'jobAction'
    | 'indexName';

// After
export type ContentTarget =
    | 'field'
    | 'inputParameter'
    | 'outputParameter'
    | 'roleName'
    | 'grantedRoleName'
    | 'sequenceName'
    | 'jobAction'
    | 'indexName'
    | 'triggerName';
```

This is a purely additive change. No existing usages of `ContentTarget` are affected.

---

### 3.7 Changes to `src/types/issues.ts`

Add `'triggerName'` to the `subjectType` union in `LintIssue`:

```typescript
// Before
readonly subjectType?:
    | 'artifact'
    | 'field'
    | 'inputParameter'
    | 'outputParameter'
    | 'roleName'
    | 'grantedRoleName'
    | 'sequenceName'
    | 'jobAction'
    | 'indexName';

// After
readonly subjectType?:
    | 'artifact'
    | 'field'
    | 'inputParameter'
    | 'outputParameter'
    | 'roleName'
    | 'grantedRoleName'
    | 'sequenceName'
    | 'jobAction'
    | 'indexName'
    | 'triggerName';
```

`ExtractedSubject.type` is typed as `ContentTarget`, so it picks up `'triggerName'` automatically once `ContentTarget` is extended. No further change to `ExtractedSubject` itself is required.

---

### 3.8 Changes to `src/content-lint.ts`

Two changes only:

1. **Add import** at the top of the file alongside the existing parser imports:

    ```typescript
    import { extractTriggerName } from './parsers/hdbtrigger/index';
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
        if (extension === '.hdbschedulerjob') return extractSchedulerJobAction(fileContent);
        if (extension === '.hdbindex') return extractIndexName(fileContent);
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
        if (extension === '.hdbindex') return extractIndexName(fileContent);
        if (extension === '.hdbtrigger') return extractTriggerName(fileContent);
        return [];
    }
    ```

No other changes to `content-lint.ts`. `lintFileContent()`, `evaluateAllRules()`, `evaluateAnyRules()`, and `LintIssue` are untouched beyond the `'triggerName'` addition to `subjectType`.

---

## 4. Data Models

No new persistent data models. The only types crossing the parser boundary are the existing `ExtractedSubject` and `ContentTarget`, extended additively:

```typescript
// src/types/issues.ts — ExtractedSubject uses ContentTarget directly
type ExtractedSubject = {
    readonly type: ContentTarget; // 'triggerName' for .hdbtrigger
    readonly name: string; // normalised identifier (double-quotes stripped)
    readonly lineNumber?: number; // not populated by this parser
};

// src/types/rules.ts — extended with 'triggerName'
type ContentTarget =
    | 'field'
    | 'inputParameter'
    | 'outputParameter'
    | 'roleName'
    | 'grantedRoleName'
    | 'sequenceName'
    | 'jobAction'
    | 'indexName'
    | 'triggerName'; // NEW
```

The `.hdbtrigger` extractor returns at most **one** entry per file (a single trigger definition per file). A `contentRuleSet` targeting any other `ContentTarget` value against `.hdbtrigger` will match zero subjects — this is not an error.

---

## 5. API Specifications

### Public function

```typescript
/**
 * Extract the trigger name from the content of an `.hdbtrigger` DDL file.
 *
 * Uses a Chevrotain lexer and CstParser to correctly handle all SAP HANA
 * trigger DDL variants:
 *   - `[CREATE] TRIGGER <name> BEFORE|AFTER INSERT|UPDATE|DELETE ON <table> ...`
 *   - `[CREATE] TRIGGER <name> INSTEAD OF INSERT|UPDATE|DELETE ON <table> ...`
 *   - Optional `UPDATE OF <column_list>` event modifier
 *   - Optional `REFERENCING OLD|NEW ROW|TABLE AS <alias>` clause
 *   - Optional `FOR EACH ROW | FOR EACH STATEMENT` granularity clause
 *   - Optional `WHEN (<condition>)` predicate clause
 *
 * The trigger body (`BEGIN … END`) is consumed as a single opaque token so
 * that SQLScript keywords inside the body are never presented to the grammar
 * as individual tokens and cannot contaminate extraction.
 *
 * The parser handles block/line comments, quoted and unquoted trigger names,
 * schema-qualified trigger names (schema prefix excluded from result), and
 * optional trailing semicolons.
 *
 * Gracefully returns a partial or empty result on invalid input — does
 * not throw.
 *
 * @param fileContent - Raw UTF-8 file content (LF or CRLF).
 * @returns Array containing at most one ExtractedSubject with type 'triggerName'.
 */
export function extractTriggerName(fileContent: string): ExtractedSubject[];
```

### Internal module exports (not part of public API)

| Symbol                                 | Module       | Visibility       |
| -------------------------------------- | ------------ | ---------------- |
| `allTokens`, `HdbTriggerLexer`         | `lexer.ts`   | Package-internal |
| `HdbTriggerParser`, `hdbTriggerParser` | `parser.ts`  | Package-internal |
| `HdbTriggerNameVisitor`                | `visitor.ts` | Package-internal |

---

## 6. Unit Test Design

Test file: `src/parsers/hdbtrigger/__tests__/extractTriggerName.test.ts`

The test file follows the same structure as the existing `.hdb*` parser tests: one `describe` block per acceptance criterion, typed helper functions for brevity.

```typescript
import { describe, it, expect } from 'vitest';
import { extractTriggerName } from '../index';

function names(ddl: string): string[] {
    return extractTriggerName(ddl)
        .filter((s) => s.type === 'triggerName')
        .map((s) => s.name);
}
```

### Test cases by acceptance criterion

**AC-1 — Basic trigger name extraction (unquoted)**

```typescript
describe('AC-1: basic trigger name extraction', () => {
    it('extracts the trigger name as a triggerName subject', () => {
        const ddl = `CREATE TRIGGER TRG_AI_MY_TABLE AFTER INSERT ON MY_TABLE FOR EACH ROW BEGIN END`;
        expect(extractTriggerName(ddl)).toEqual([{ type: 'triggerName', name: 'TRG_AI_MY_TABLE' }]);
    });

    it('handles a file without a trailing semicolon', () => {
        const ddl = `CREATE TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH ROW BEGIN END`;
        expect(names(ddl)).toEqual(['TRG_AI_T']);
    });

    it('handles a file with a trailing semicolon', () => {
        const ddl = `CREATE TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH ROW BEGIN END;`;
        expect(names(ddl)).toEqual(['TRG_AI_T']);
    });
});
```

**AC-2 — Quoted trigger name normalisation**

```typescript
describe('AC-2: quoted trigger name normalisation', () => {
    it('strips double-quotes from the trigger name', () => {
        const ddl = `CREATE TRIGGER "TRG_AI_MY_TABLE" AFTER INSERT ON "MY_TABLE" FOR EACH ROW BEGIN END`;
        expect(extractTriggerName(ddl)).toEqual([{ type: 'triggerName', name: 'TRG_AI_MY_TABLE' }]);
    });

    it('handles a mixed-quote file (quoted trigger name, unquoted table)', () => {
        const ddl = `CREATE TRIGGER "TRG_AI_T" AFTER INSERT ON MY_TABLE FOR EACH ROW BEGIN END`;
        expect(names(ddl)).toEqual(['TRG_AI_T']);
    });
});
```

**AC-3 — Schema-qualified trigger name — local name extracted**

```typescript
describe('AC-3: schema-qualified trigger name', () => {
    it('extracts only the local name (after the dot)', () => {
        const ddl = `CREATE TRIGGER "MY_SCHEMA"."TRG_AI_MY_TABLE" AFTER INSERT ON "MY_TABLE" FOR EACH ROW BEGIN END`;
        expect(extractTriggerName(ddl)).toEqual([{ type: 'triggerName', name: 'TRG_AI_MY_TABLE' }]);
    });

    it('does not include the schema prefix as a subject', () => {
        const ddl = `CREATE TRIGGER "MY_SCHEMA"."TRG_AI_T" AFTER INSERT ON "MY_TABLE" FOR EACH ROW BEGIN END`;
        expect(names(ddl)).not.toContain('MY_SCHEMA');
    });
});
```

**AC-4 — Optional `CREATE` keyword absent**

```typescript
describe('AC-4: optional CREATE keyword absent', () => {
    it('extracts the trigger name when CREATE is omitted', () => {
        const ddl = `TRIGGER TRG_AI_MY_TABLE AFTER INSERT ON MY_TABLE FOR EACH ROW BEGIN END`;
        expect(extractTriggerName(ddl)).toEqual([{ type: 'triggerName', name: 'TRG_AI_MY_TABLE' }]);
    });

    it('produces the same result with and without CREATE', () => {
        const withCreate = `CREATE TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH ROW BEGIN END`;
        const withoutCreate = `TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH ROW BEGIN END`;
        expect(names(withCreate)).toEqual(names(withoutCreate));
    });
});
```

**AC-5 — `BEFORE` timing keyword**

```typescript
describe('AC-5: BEFORE timing keyword', () => {
    it('extracts the trigger name for a BEFORE INSERT trigger', () => {
        const ddl = `CREATE TRIGGER TRG_BI_T BEFORE INSERT ON T FOR EACH ROW BEGIN END`;
        expect(extractTriggerName(ddl)).toEqual([{ type: 'triggerName', name: 'TRG_BI_T' }]);
    });

    it('extracts the trigger name for a BEFORE UPDATE trigger', () => {
        const ddl = `CREATE TRIGGER TRG_BU_T BEFORE UPDATE ON T FOR EACH ROW BEGIN END`;
        expect(names(ddl)).toEqual(['TRG_BU_T']);
    });

    it('extracts the trigger name for a BEFORE DELETE trigger', () => {
        const ddl = `CREATE TRIGGER TRG_BD_T BEFORE DELETE ON T FOR EACH ROW BEGIN END`;
        expect(names(ddl)).toEqual(['TRG_BD_T']);
    });
});
```

**AC-6 — `INSTEAD OF` timing keyword**

```typescript
describe('AC-6: INSTEAD OF timing keyword', () => {
    it('extracts the trigger name for an INSTEAD OF INSERT trigger', () => {
        const ddl = `CREATE TRIGGER TRG_IO_V INSTEAD OF INSERT ON V FOR EACH ROW BEGIN END`;
        expect(extractTriggerName(ddl)).toEqual([{ type: 'triggerName', name: 'TRG_IO_V' }]);
    });

    it('extracts the trigger name for an INSTEAD OF UPDATE trigger', () => {
        const ddl = `CREATE TRIGGER TRG_IO_V INSTEAD OF UPDATE ON V FOR EACH ROW BEGIN END`;
        expect(names(ddl)).toEqual(['TRG_IO_V']);
    });
});
```

**AC-7 — `UPDATE OF` column list excluded**

```typescript
describe('AC-7: UPDATE OF column list excluded', () => {
    it('does not include UPDATE OF column names in the result', () => {
        const ddl = `CREATE TRIGGER TRG_AU_T AFTER UPDATE OF COL1, COL2, COL3 ON T FOR EACH ROW BEGIN END`;
        expect(extractTriggerName(ddl)).toEqual([{ type: 'triggerName', name: 'TRG_AU_T' }]);
    });

    it('does not include column names from UPDATE OF as subjects', () => {
        const ddl = `CREATE TRIGGER TRG_AU_T AFTER UPDATE OF COL1, COL2 ON T FOR EACH ROW BEGIN END`;
        expect(names(ddl)).not.toContain('COL1');
        expect(names(ddl)).not.toContain('COL2');
    });

    it('handles quoted column names in UPDATE OF without error', () => {
        const ddl = `CREATE TRIGGER TRG_AU_T AFTER UPDATE OF "COL1", "COL2" ON "T" FOR EACH ROW BEGIN END`;
        expect(names(ddl)).toEqual(['TRG_AU_T']);
    });
});
```

**AC-8 — `REFERENCING` clause excluded**

```typescript
describe('AC-8: REFERENCING clause excluded', () => {
    it('does not include NEW ROW alias in the result', () => {
        const ddl = `CREATE TRIGGER TRG_AI_T AFTER INSERT ON T REFERENCING NEW ROW AS NEW_ROW FOR EACH ROW BEGIN END`;
        expect(extractTriggerName(ddl)).toEqual([{ type: 'triggerName', name: 'TRG_AI_T' }]);
        expect(names(ddl)).not.toContain('NEW_ROW');
    });

    it('does not include OLD ROW alias in the result', () => {
        const ddl = `CREATE TRIGGER TRG_AU_T AFTER UPDATE ON T REFERENCING OLD ROW AS OLD_ROW NEW ROW AS NEW_ROW FOR EACH ROW BEGIN END`;
        expect(names(ddl)).not.toContain('OLD_ROW');
        expect(names(ddl)).not.toContain('NEW_ROW');
        expect(names(ddl)).toEqual(['TRG_AU_T']);
    });

    it('handles NEW TABLE AS alias without error', () => {
        const ddl = `CREATE TRIGGER TRG_AI_T AFTER INSERT ON T REFERENCING NEW TABLE AS NEW_TABLE FOR EACH STATEMENT BEGIN END`;
        expect(names(ddl)).toEqual(['TRG_AI_T']);
        expect(names(ddl)).not.toContain('NEW_TABLE');
    });
});
```

**AC-9 — `WHEN` clause excluded**

```typescript
describe('AC-9: WHEN clause excluded', () => {
    it('extracts the trigger name without error when a WHEN clause is present', () => {
        const ddl = `CREATE TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH ROW WHEN (NEW."STATUS" = 'ACTIVE') BEGIN END`;
        expect(extractTriggerName(ddl)).toEqual([{ type: 'triggerName', name: 'TRG_AI_T' }]);
    });

    it('does not extract identifiers from the WHEN predicate', () => {
        const ddl = `CREATE TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH ROW WHEN (STATUS_COL > 0) BEGIN END`;
        expect(names(ddl)).not.toContain('STATUS_COL');
    });

    it('handles nested function calls in the WHEN predicate without error', () => {
        const ddl = `CREATE TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH ROW WHEN (NVL(NEW."VAL", 0) > 0 AND LENGTH(NEW."NAME") > 2) BEGIN END`;
        expect(names(ddl)).toEqual(['TRG_AI_T']);
    });
});
```

**AC-10 — Trigger body excluded**

```typescript
describe('AC-10: trigger body excluded', () => {
    it('does not extract identifiers from the body', () => {
        const ddl = `
            CREATE TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH ROW
            BEGIN
                INSERT INTO AUDIT_LOG (EVENT, TS) VALUES ('INSERT triggered on T', NOW());
            END
        `;
        expect(extractTriggerName(ddl)).toEqual([{ type: 'triggerName', name: 'TRG_AI_T' }]);
        expect(names(ddl)).not.toContain('AUDIT_LOG');
        expect(names(ddl)).not.toContain('EVENT');
    });

    it('handles a body containing TRIGGER and ON keywords without confusion', () => {
        const ddl = `
            CREATE TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH ROW
            BEGIN
                DECLARE lv_trigger NVARCHAR(100);
                SELECT * FROM T WHERE ID = NEW.ID;
            END
        `;
        expect(names(ddl)).toEqual(['TRG_AI_T']);
    });

    it('handles a body with nested BEGIN/END blocks', () => {
        const ddl = `
            CREATE TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH ROW
            BEGIN
                IF NEW."STATUS" = 1 THEN
                    BEGIN
                        INSERT INTO LOG VALUES (1);
                    END;
                END IF;
            END
        `;
        expect(names(ddl)).toEqual(['TRG_AI_T']);
    });
});
```

**AC-11 — Block comment exclusion**

```typescript
describe('AC-11: block comment exclusion', () => {
    it('does not extract a trigger name inside a block comment', () => {
        const ddl = `
            /* CREATE TRIGGER OLD_TRIGGER AFTER INSERT ON T FOR EACH ROW BEGIN END; */
            CREATE TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH ROW BEGIN END
        `;
        expect(names(ddl)).not.toContain('OLD_TRIGGER');
        expect(names(ddl)).toContain('TRG_AI_T');
    });

    it('handles a multi-line block comment spanning declaration tokens', () => {
        const ddl = `
            CREATE TRIGGER /* ignored */ TRG_AI_T AFTER INSERT ON T FOR EACH ROW BEGIN END
        `;
        expect(names(ddl)).toEqual(['TRG_AI_T']);
    });
});
```

**AC-12 — Line comment exclusion**

```typescript
describe('AC-12: line comment exclusion', () => {
    it('does not extract a trigger name on a -- comment line', () => {
        const ddl = `
            -- CREATE TRIGGER OLD_TRIGGER AFTER INSERT ON T FOR EACH ROW BEGIN END;
            CREATE TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH ROW BEGIN END
        `;
        expect(names(ddl)).not.toContain('OLD_TRIGGER');
        expect(names(ddl)).toContain('TRG_AI_T');
    });
});
```

**AC-13 — `FOR EACH STATEMENT` granularity**

```typescript
describe('AC-13: FOR EACH STATEMENT granularity', () => {
    it('extracts the trigger name for a FOR EACH STATEMENT trigger', () => {
        const ddl = `CREATE TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH STATEMENT BEGIN END`;
        expect(extractTriggerName(ddl)).toEqual([{ type: 'triggerName', name: 'TRG_AI_T' }]);
    });
});
```

**AC-14 — Optional trailing semicolon**

```typescript
describe('AC-14: optional trailing semicolon', () => {
    it('produces the same result with and without a trailing semicolon', () => {
        const withSemicolon = `CREATE TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH ROW BEGIN END;`;
        const withoutSemicolon = `CREATE TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH ROW BEGIN END`;
        expect(names(withSemicolon)).toEqual(names(withoutSemicolon));
    });
});
```

**AC-15 — Graceful error on unparseable file**

```typescript
describe('AC-15: graceful error handling', () => {
    it('does not throw on completely invalid input', () => {
        expect(() => extractTriggerName('THIS IS NOT VALID DDL !!!')).not.toThrow();
    });

    it('does not throw on an empty string', () => {
        expect(() => extractTriggerName('')).not.toThrow();
        expect(extractTriggerName('')).toEqual([]);
    });

    it('does not throw when the TRIGGER keyword is missing', () => {
        expect(() => extractTriggerName('CREATE TRG_AI_T AFTER INSERT ON T FOR EACH ROW BEGIN END')).not.toThrow();
    });

    it('does not throw when the body is missing', () => {
        expect(() => extractTriggerName('CREATE TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH ROW')).not.toThrow();
    });
});
```

**AC-16 — Integration with `lintFileContent`** is verified through the wiring in `src/content-lint.ts`; no dedicated unit test is required for this spec. End-to-end integration tests are the responsibility of the integration test suite.

**AC-17 — Build integrity** is verified by running `npm run build` in CI; no unit-test case is required.

---

## 7. Security and Performance Considerations

### Security

- **ReDoS** — The `BlockComment` pattern (`/\/\*[\s\S]*?\*\//`) uses a non-greedy quantifier and has no nested quantifiers; it is safe from catastrophic backtracking. The `TriggerBody` and `WhenBody` custom pattern functions use linear character-by-character scanning with a depth counter — no regex backtracking occurs. All other token patterns are simple character-class or literal-match patterns. This token set is structurally identical to those used by every other parser in the project.
- **Input size** — `.hdbtrigger` files are typically small (10–200 lines for the declaration; the body may be longer for complex triggers). The custom `TriggerBody` scanner is O(n) in the body length; no backtracking. The 100 ms performance budget (NFR-4) is comfortably satisfied for files up to 2,000 lines.
- **No code execution** — The parser only produces `ExtractedSubject` values containing string names from the token stream. It does not evaluate, execute, or persist anything from the file content. No injection vectors exist.
- **No network access** — The parser operates entirely on the string passed in. No external resources are fetched.

### Performance

- **Singleton pattern**: Both `HdbTriggerLexer` and `hdbTriggerParser` are instantiated **once** at module load time. Repeated calls to `extractTriggerName()` reuse the same lexer and parser instances, satisfying NFR-3.
- **Parser input reset**: Before each parse, `hdbTriggerParser.input = lexResult.tokens` resets the token stream. This is the standard Chevrotain pattern for reusing a singleton parser across multiple files.
- **Opaque body token**: By consuming the entire trigger body as a single `TriggerBody` lexer token, the Chevrotain lexer avoids tokenising potentially thousands of lines of SQLScript. The grammar only ever sees one token for the body, making the parse step for the declaration header O(1) with respect to body length.
- **Expected throughput**: Declaration headers in `.hdbtrigger` files are 5–15 lines; the lexer overhead for this portion is negligible. For files with large bodies, the `TriggerBody` custom scanner is the dominant cost but remains linear — well under 1 ms per KB on commodity hardware.

---

## 8. Implementation Milestones

| #   | Deliverable                                    | Files changed                                                 |
| --- | ---------------------------------------------- | ------------------------------------------------------------- |
| 1   | Extend `ContentTarget` and `LintIssue` types   | `src/types/rules.ts`, `src/types/issues.ts`                   |
| 2   | Implement `lexer.ts`                           | `src/parsers/hdbtrigger/lexer.ts`                             |
| 3   | Implement `parser.ts`                          | `src/parsers/hdbtrigger/parser.ts`                            |
| 4   | Implement `visitor.ts`                         | `src/parsers/hdbtrigger/visitor.ts`                           |
| 5   | Implement `index.ts`                           | `src/parsers/hdbtrigger/index.ts`                             |
| 6   | Wire into `content-lint.ts`                    | `src/content-lint.ts`                                         |
| 7   | Write unit tests                               | `src/parsers/hdbtrigger/__tests__/extractTriggerName.test.ts` |
| 8   | Run `npm run build` and confirm zero TS errors | —                                                             |
| 9   | Run `npm test` and confirm all tests pass      | —                                                             |

Milestones 1–6 may be done in parallel; milestone 7 may be developed alongside milestones 2–5 (TDD style). Milestones 8 and 9 are verification steps after all prior milestones are complete.

---

## 9. Risk Assessment

| Risk                                                                                             | Likelihood | Impact | Mitigation                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------ | ---------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TriggerBody` custom scanner misidentifies `CASE/END` as the closing `END` of the trigger body   | Low        | High   | The depth counter is incremented for every `BEGIN` **and** every `CASE`/`IF`/`LOOP` that uses a matching `END`. As long as the scanner tracks depth uniformly for all `BEGIN`-equivalent openers, the closing `END` at depth 0 is always the body closer.            |
| `TriggerBody` scanner does not fire when `BEGIN` is preceded by non-space characters             | Low        | Medium | The custom pattern checks for a word boundary immediately before `BEGIN` (e.g., whitespace or newline), matching HANA DDL formatting conventions. Test AC-10 includes multi-line bodies that exercise this.                                                          |
| `WhenBody` scanner fails on deeply nested function calls in the WHEN predicate                   | Very low   | Low    | The balanced-parenthesis scanner is purely character-by-character with a depth counter; nesting depth is unlimited. Test AC-9 includes a multi-function predicate to exercise this.                                                                                  |
| `OfKw` ambiguity between `INSTEAD OF` and `UPDATE OF`                                            | Very low   | Medium | The grammar places `OfKw` in two structurally distinct positions: after `InsteadKw` in `triggerTiming`, and after `UpdateKw` in `triggerEvent`. Chevrotain never sees `OfKw` in an ambiguous position; the preceding token always resolves which production applies. |
| `ReferencingItem` alias identifier auto-traversed by the visitor and extracted as a trigger name | Low        | High   | `referencingItem` is explicitly overridden as a no-op in the visitor. Test AC-8 includes multi-item REFERENCING clauses with both OLD and NEW aliases to verify no alias is extracted.                                                                               |
| Column names from `UPDATE OF` auto-traversed by the visitor                                      | Low        | High   | `updateColumnList` is explicitly overridden as a no-op in the visitor. Test AC-7 includes a three-column `UPDATE OF` list to verify no column name is extracted.                                                                                                     |
| Schema-qualified `triggerName` visitor returns the schema prefix instead of the local name       | Low        | Medium | Visitor always takes the **last** `identifier` child of `triggerName`. `SUBRULE` and `SUBRULE2` produce distinct children in the CST `ctx` array; the last entry is always the local name. Test AC-3 covers both quoted and unquoted schema-qualified names.         |
| `tableName` identifier auto-traversed by the visitor and extracted as a trigger name             | Very low   | Medium | `tableName` is a child of `triggerStatement`, not of `triggerName`. The visitor only overrides `triggerName`; auto-traversal for all other rules never surfaces tokens under the `triggerName` CST node. No override is required for `tableName`.                    |
| Future HANA trigger syntax variants not covered (e.g., compound events `INSERT OR UPDATE`)       | Low        | Low    | Chevrotain error recovery allows the parser to consume unknown tokens gracefully without crashing. The `triggerName` portion of the CST is produced immediately after `TriggerKw` — before any trailing unknown clauses are encountered.                             |
| Parser singleton state pollution between test runs                                               | Low        | Medium | Resetting `hdbTriggerParser.input` before each `triggerStatement()` call fully resets internal state. This is the standard Chevrotain pattern confirmed by all existing parser implementations in the project.                                                       |
| Chevrotain version upgrade changes `BaseCstVisitorWithDefaults` API                              | Very low   | Low    | Chevrotain's visitor API has been stable since v6. The project pins a specific major version (`v11.x`).                                                                                                                                                              |
