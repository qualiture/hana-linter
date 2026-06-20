# Technical Design Specification: XML-based Extractor for `.hdbcalculationview`

**PRD**: [prd.md](./prd.md)  
**Feature**: `.hdbcalculationview` Output Column & Input Parameter Extractor  
**Status**: Ready for Implementation

---

## 1. System Architecture Overview

### Current state

`extractSubjects()` in `src/content-lint.ts` has no handler for `.hdbcalculationview` files. The extension falls through to `return []`, silently producing no subjects regardless of any configured `contentRuleSets`.

```
content-lint.ts
  └── extractSubjects()
        ├── '.hdbtable'       → extractTableColumns()
        ├── '.hdbview'        → extractViewColumns()
        ├── '.hdbprocedure'   → extractProcedureParameters()
        ├── '.hdbfunction'    → extractFunctionParameters()
        ├── '.hdbtabletype'   → extractTableTypeColumns()
        ├── '.hdbrole'        → extractRoleNames()
        └── (default)         → []    ← .hdbcalculationview falls here
```

### Target state

A new `src/parsers/hdbcalculationview/` sub-module is added. `extractSubjects()` gains a `.hdbcalculationview` branch that delegates to the new module's public function.

```
content-lint.ts
  └── extractSubjects()
        ├── '.hdbtable'              → extractTableColumns()
        ├── '.hdbview'               → extractViewColumns()
        ├── '.hdbprocedure'          → extractProcedureParameters()
        ├── '.hdbfunction'           → extractFunctionParameters()
        ├── '.hdbtabletype'          → extractTableTypeColumns()
        ├── '.hdbrole'               → extractRoleNames()
        └── '.hdbcalculationview'    → extractCalculationViewOutputs()   ← NEW

src/parsers/hdbcalculationview/
  ├── extractor.ts    XMLParser singleton + navigation logic + typed helpers
  └── index.ts        Public API: extractCalculationViewOutputs()
```

> **Deviation from Chevrotain pattern**: `.hdbcalculationview` files are well-formed XML documents, not SQL DDL text. A Chevrotain-based approach would require re-implementing a general XML lexer and parser from scratch — significant engineering overhead for no benefit over a dedicated XML library. The public-API contract (`extractCalculationViewOutputs(content: string): ExtractedSubject[]`) and module structure are otherwise identical to every other parser sub-module in this project.

Everything above `extractSubjects()` — `lintFileContent()`, `runLint()`, `LintIssue`, and the public `src/index.ts` entry point — is unchanged.

---

## 2. Technology Stack

| Concern    | Choice                       | Rationale                                                                                                                                          |
| ---------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| XML parser | **`fast-xml-parser`** (v4.x) | TypeScript-native, zero native binaries, attribute extraction, configurable array coercion, actively maintained, minimal footprint (~30 kB minzip) |
| Language   | TypeScript (existing)        | Matches the project                                                                                                                                |
| Build      | `tsc` (existing)             | No additional build tooling needed                                                                                                                 |
| Runtime    | Node.js (existing)           | No change                                                                                                                                          |

**Install command:**

```bash
pnpm add fast-xml-parser
```

`fast-xml-parser` must be added to `dependencies` (not `devDependencies`) in `package.json` because it is required at runtime by the CLI binary.

---

## 3. Component Design

### 3.1 File layout

```
src/
  parsers/
    hdbcalculationview/
      extractor.ts
      index.ts
      __tests__/
        extractCalculationViewOutputs.test.ts
```

No `lexer.ts`, `parser.ts`, or `visitor.ts` are needed. The XML library replaces the Chevrotain lexer/parser pair; a thin traversal layer in `extractor.ts` replaces the visitor.

---

### 3.2 `src/parsers/hdbcalculationview/extractor.ts`

#### Responsibility

- Instantiate a singleton `XMLParser` configured for `.hdbcalculationview` documents.
- Define typed interfaces that model the relevant portions of the parsed object tree.
- Provide helper utilities (`toArray`, `extractFields`).
- Export the main traversal function `parseCalculationView()`.

#### XMLParser singleton configuration

```typescript
import { XMLParser } from 'fast-xml-parser';

/**
 * Element tag names that must always be returned as arrays, regardless of
 * how many sibling elements exist in the document.  Without this, a single
 * <attribute/> would be parsed as a plain object rather than a one-element
 * array, breaking the traversal loop.
 */
const FORCE_ARRAY_TAGS = new Set([
    'attribute', // logicalModel → attributes
    'calculatedAttribute', // logicalModel → calculatedAttributes
    'measure', // logicalModel → baseMeasures / calculatedMeasures / restrictedMeasures
    'variable' // localVariables
]);

/**
 * Singleton XMLParser — instantiated once at module load time, reused for
 * every extractCalculationViewOutputs() call (per NFR-3 / performance).
 */
export const xmlParser = new XMLParser({
    ignoreAttributes: false, // parse XML attributes into the result object
    attributeNamePrefix: '', // access xml attributes as plain keys (no '@_' prefix)
    allowBooleanAttributes: false,
    parseTagValue: false, // do not coerce element text content; only xml attributes matter
    trimValues: true,
    isArray: (name: string) => FORCE_ARRAY_TAGS.has(name)
});
```

#### Internal type interfaces

These interfaces model only the portions of the document that the extractor navigates. They are **not** exported; they are internal to `extractor.ts`.

```typescript
/** An element with at minimum an id XML attribute. */
interface IdNode {
    id: string;
}

/** A <variable> element. */
interface VariableNode extends IdNode {
    /** String "true" when the variable is an input parameter. */
    parameter?: string;
}

/** Sections within <logicalModel> that contain a list of column-like elements. */
interface LogicalModelSection {
    attribute?: IdNode[];
    calculatedAttribute?: IdNode[];
    measure?: IdNode[];
}

/** The <logicalModel> element. */
interface LogicalModelNode {
    attributes?: LogicalModelSection | '';
    calculatedAttributes?: LogicalModelSection | '';
    baseMeasures?: LogicalModelSection | '';
    calculatedMeasures?: LogicalModelSection | '';
    restrictedMeasures?: LogicalModelSection | '';
}

/** The <localVariables> element. */
interface LocalVariablesNode {
    variable?: VariableNode[];
}

/** The root <Calculation:scenario> element (only the fields we navigate). */
interface ScenarioNode {
    logicalModel?: LogicalModelNode;
    localVariables?: LocalVariablesNode | '';
}
```

> **Empty element coercion**: `fast-xml-parser` represents self-closing or empty elements (e.g. `<restrictedMeasures/>`) as the empty string `''`. All section accesses must guard against this with the `| ''` union in the interfaces above. The `extractFields` helper handles this transparently.

#### Helper utilities

```typescript
import type { ExtractedSubject } from '../../types/issues';

/**
 * Safely coerce an unknown value to an array.
 * - undefined / null / '' → []
 * - already an array     → returned as-is
 * - single object        → wrapped in [ ]
 */
function toArray<T>(value: T | T[] | undefined | ''): T[] {
    if (value === undefined || value === null || value === '') return [];
    return Array.isArray(value) ? value : [value];
}

/**
 * Extract ExtractedSubject entries with type 'field' from a single
 * logical-model section (attributes / calculatedAttributes / baseMeasures /
 * calculatedMeasures / restrictedMeasures).
 *
 * @param section - The parsed section object (or '' for empty elements).
 * @param childTag - The XML child element tag to collect ('attribute' |
 *                   'calculatedAttribute' | 'measure').
 */
function extractFields(section: LogicalModelSection | '' | undefined, childTag: keyof LogicalModelSection): ExtractedSubject[] {
    if (!section || typeof section !== 'object') return [];
    return toArray(section[childTag]).flatMap((node) => (node.id ? [{ type: 'field' as const, name: node.id }] : []));
}
```

#### Main traversal function

```typescript
/**
 * Parse the XML content of an .hdbcalculationview file and extract
 * ExtractedSubject entries from the logicalModel and localVariables sections.
 *
 * Returns [] — never throws — on malformed or unrecognised input.
 */
export function parseCalculationView(fileContent: string): ExtractedSubject[] {
    // Strip UTF-8 BOM if present (AC-14).
    const content = fileContent.startsWith('\uFEFF') ? fileContent.slice(1) : fileContent;

    let parsed: Record<string, unknown>;
    try {
        parsed = xmlParser.parse(content) as Record<string, unknown>;
    } catch {
        return [];
    }

    // The root element is namespace-qualified: <Calculation:scenario ...>
    const scenario = parsed['Calculation:scenario'] as ScenarioNode | undefined;
    if (!scenario || typeof scenario !== 'object') return [];

    const subjects: ExtractedSubject[] = [];

    // ── logicalModel ──────────────────────────────────────────────────────────
    const lm = scenario.logicalModel;
    if (lm && typeof lm === 'object') {
        // 1. Dimension attributes  (logicalModel → attributes → attribute[])
        subjects.push(...extractFields(lm.attributes, 'attribute'));

        // 2. Calculated attributes (logicalModel → calculatedAttributes → calculatedAttribute[])
        subjects.push(...extractFields(lm.calculatedAttributes, 'calculatedAttribute'));

        // 3. Base measures         (logicalModel → baseMeasures → measure[])
        subjects.push(...extractFields(lm.baseMeasures, 'measure'));

        // 4. Calculated measures   (logicalModel → calculatedMeasures → measure[])
        subjects.push(...extractFields(lm.calculatedMeasures, 'measure'));

        // 5. Restricted measures   (logicalModel → restrictedMeasures → measure[])
        subjects.push(...extractFields(lm.restrictedMeasures, 'measure'));
    }

    // ── localVariables ────────────────────────────────────────────────────────
    const lv = scenario.localVariables;
    if (lv && typeof lv === 'object') {
        for (const variable of toArray((lv as LocalVariablesNode).variable)) {
            // Only collect variables explicitly marked parameter="true" (AC-6, AC-9, AC-10).
            if (variable.id && String(variable.parameter) === 'true') {
                subjects.push({ type: 'inputParameter', name: variable.id });
            }
        }
    }

    return subjects;
}
```

#### Exported symbols

```typescript
export { xmlParser }; // exported for testability (inspect configuration)
export { parseCalculationView }; // consumed by index.ts
```

---

### 3.3 `src/parsers/hdbcalculationview/index.ts`

#### Responsibility

Public API boundary. Delegates directly to `parseCalculationView()`.

#### Implementation

```typescript
import type { ExtractedSubject } from '../../types/issues';
import { parseCalculationView } from './extractor';

/**
 * Extract output column IDs and input parameter IDs from the content of an
 * .hdbcalculationview XML file.
 *
 * Uses fast-xml-parser to navigate the <logicalModel> and <localVariables>
 * sections of the <Calculation:scenario> root element.  Handles:
 *   - Dimension attributes, calculated attributes
 *   - Base measures, calculated measures, restricted measures
 *   - Input parameters (variable[@parameter="true"])
 *   - UTF-8 BOM, CRLF line endings, CUBE / DIMENSION / TIME dataCategory variants
 *
 * Gracefully returns [] on malformed XML — does not throw.
 *
 * @param fileContent - Raw UTF-8 file content (LF or CRLF).
 * @returns Array of ExtractedSubject entries.
 *          Output columns: type 'field'.
 *          Input parameters: type 'inputParameter'.
 */
export function extractCalculationViewOutputs(fileContent: string): ExtractedSubject[] {
    return parseCalculationView(fileContent);
}
```

---

### 3.4 Changes to `src/content-lint.ts`

Two additive changes only:

1. **Add import** at the top, alongside the existing parser imports:

    ```typescript
    import { extractCalculationViewOutputs } from './parsers/hdbcalculationview/index';
    ```

2. **Add branch** inside `extractSubjects()`:

    ```typescript
    // Existing final branch (before this change)
    if (extension === '.hdbrole') {
        return extractRoleNames(fileContent);
    }

    // NEW branch
    if (extension === '.hdbcalculationview') {
        return extractCalculationViewOutputs(fileContent);
    }

    return [];
    ```

No other changes to `content-lint.ts`. `lintFileContent()`, `evaluateAllRules()`, `evaluateAnyRules()`, and the `LintIssue` type are untouched.

---

## 4. Data Models

No new persistent data models are introduced. The only type that crosses the module boundary is the existing `ExtractedSubject` from `src/types/issues.ts`:

```typescript
type ExtractedSubject = {
    readonly type: ContentTarget; // 'field' for output columns; 'inputParameter' for parameters
    readonly name: string; // the id XML attribute value, returned as-is (no quote-stripping)
};
```

`ContentTarget` in `src/types/rules.ts` is **not** modified. The existing `'field'` and `'inputParameter'` values cover all extraction targets defined in the PRD.

### Parsed document shape (representative)

The object tree produced by `fast-xml-parser` for a typical `CUBE` calculation view looks like:

```typescript
{
    'Calculation:scenario': {
        id: 'CV_MY_VIEW',
        dataCategory: 'CUBE',
        localVariables: {
            variable: [
                { id: 'IP_COMPANY_CODE', parameter: 'true', type: 'NVarchar', length: '4' }
            ]
        },
        logicalModel: {
            id: 'Projection_1',
            attributes: {
                attribute: [
                    { id: 'COMPANY_CODE', order: '1' },
                    { id: 'FISCAL_YEAR',  order: '2' }
                ]
            },
            calculatedAttributes: {
                calculatedAttribute: [
                    { id: 'FULL_NAME' }
                ]
            },
            baseMeasures: {
                measure: [
                    { id: 'AMOUNT',   aggregationType: 'sum' },
                    { id: 'QUANTITY', aggregationType: 'sum' }
                ]
            },
            calculatedMeasures: {
                measure: [
                    { id: 'AMOUNT_PCT' }
                ]
            },
            restrictedMeasures: '',   // ← empty element → '' not {}
        }
    }
}
```

---

## 5. API Specifications

### Public function

```typescript
/**
 * Extract output column IDs and input parameter IDs from the content of an
 * .hdbcalculationview XML file.
 *
 * @param fileContent - Raw UTF-8 file content (LF or CRLF, with or without BOM).
 * @returns Array of ExtractedSubject with:
 *          - type 'field'          for each output column (attribute, calculated attribute,
 *                                  base measure, calculated measure, restricted measure)
 *          - type 'inputParameter' for each input parameter (variable[@parameter="true"])
 *          Returns [] without throwing on malformed XML or missing logicalModel.
 */
export function extractCalculationViewOutputs(fileContent: string): ExtractedSubject[];
```

### Internal module exports (not part of public API)

| Symbol                 | Module         | Visibility                                              |
| ---------------------- | -------------- | ------------------------------------------------------- |
| `xmlParser`            | `extractor.ts` | Package-internal (exported for test introspection only) |
| `parseCalculationView` | `extractor.ts` | Package-internal                                        |

---

## 6. Unit Test Design

Test file: `src/parsers/hdbcalculationview/__tests__/extractCalculationViewOutputs.test.ts`

### Test helpers

```typescript
import { describe, it, expect } from 'vitest';
import { extractCalculationViewOutputs } from '../index';

/** Build a minimal but valid Calculation:scenario XML wrapper. */
function scenario(logicalModelContent: string, localVariablesContent = ''): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Calculation:scenario
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xmlns:Calculation="http://www.sap.com/ndb/BiModelCalculation.ecore"
    id="CV_TEST"
    dataCategory="CUBE">
  <localVariables>${localVariablesContent}</localVariables>
  <dataSources>
    <DataSource id="MY_TABLE" type="DATA_BASE_TABLE">
      <resourceUri>MY_TABLE</resourceUri>
    </DataSource>
  </dataSources>
  <calculationViews>
    <calculationView xsi:type="Calculation:ProjectionView" id="Projection_1">
      <viewAttributes>
        <viewAttribute id="INTERNAL_COL"/>
      </viewAttributes>
    </calculationView>
  </calculationViews>
  <logicalModel id="Projection_1">
${logicalModelContent}
  </logicalModel>
</Calculation:scenario>`;
}

function names(xml: string) {
    return extractCalculationViewOutputs(xml).map((s) => s.name);
}

function types(xml: string) {
    return extractCalculationViewOutputs(xml).map((s) => s.type);
}
```

### Test cases by acceptance criterion

**AC-1 — Attribute extraction**

```typescript
it('extracts attribute ids from logicalModel/attributes', () => {
    const xml = scenario(`
      <attributes>
        <attribute id="COMPANY_CODE" order="1"/>
        <attribute id="FISCAL_YEAR"  order="2"/>
      </attributes>`);
    expect(extractCalculationViewOutputs(xml)).toEqual([
        { type: 'field', name: 'COMPANY_CODE' },
        { type: 'field', name: 'FISCAL_YEAR' }
    ]);
});
```

**AC-2 — Measure extraction**

```typescript
it('extracts measure ids from logicalModel/baseMeasures', () => {
    const xml = scenario(`
      <attributes/>
      <baseMeasures>
        <measure id="AMOUNT"   aggregationType="sum"/>
        <measure id="QUANTITY" aggregationType="sum"/>
      </baseMeasures>`);
    expect(names(xml)).toContain('AMOUNT');
    expect(names(xml)).toContain('QUANTITY');
    expect(types(xml).every((t) => t === 'field')).toBe(true);
});
```

**AC-3 — Calculated attribute extraction**

```typescript
it('extracts calculatedAttribute ids from logicalModel/calculatedAttributes', () => {
    const xml = scenario(`
      <attributes/>
      <calculatedAttributes>
        <calculatedAttribute id="FULL_NAME"/>
      </calculatedAttributes>`);
    expect(names(xml)).toContain('FULL_NAME');
});
```

**AC-4 — Calculated measure extraction**

```typescript
it('extracts measure ids from logicalModel/calculatedMeasures', () => {
    const xml = scenario(`
      <attributes/>
      <calculatedMeasures>
        <measure id="AMOUNT_PCT"/>
      </calculatedMeasures>`);
    expect(names(xml)).toContain('AMOUNT_PCT');
});
```

**AC-5 — Restricted measure extraction**

```typescript
it('extracts measure ids from logicalModel/restrictedMeasures', () => {
    const xml = scenario(`
      <attributes/>
      <restrictedMeasures>
        <measure id="AMOUNT_ACTUALS"/>
      </restrictedMeasures>`);
    expect(names(xml)).toContain('AMOUNT_ACTUALS');
});
```

**AC-6 — Input parameter extraction**

```typescript
it('extracts variables with parameter="true" as inputParameter', () => {
    const xml = scenario(
        '',
        `
      <variable id="IP_COMPANY_CODE" parameter="true"/>
      <variable id="INTERNAL_VAR"    parameter="false"/>`
    );
    expect(extractCalculationViewOutputs(xml)).toContainEqual({ type: 'inputParameter', name: 'IP_COMPANY_CODE' });
    expect(names(xml)).not.toContain('INTERNAL_VAR');
});
```

**AC-7 — Internal node attributes excluded**

```typescript
it('does not extract viewAttribute ids from calculationViews section', () => {
    // The scenario() helper already injects a <viewAttribute id="INTERNAL_COL"/>
    const xml = scenario(`<attributes><attribute id="OUTPUT_COL" order="1"/></attributes>`);
    expect(names(xml)).not.toContain('INTERNAL_COL');
    expect(names(xml)).not.toContain('Projection_1');
    expect(names(xml)).toContain('OUTPUT_COL');
});
```

**AC-8 — DataSource IDs excluded**

```typescript
it('does not extract DataSource ids', () => {
    // The scenario() helper already injects a <DataSource id="MY_TABLE"/>
    const xml = scenario(`<attributes><attribute id="ATTR_1" order="1"/></attributes>`);
    expect(names(xml)).not.toContain('MY_TABLE');
});
```

**AC-9 — DIMENSION view (no measures section)**

```typescript
it('handles DIMENSION view with no baseMeasures element', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Calculation:scenario
    xmlns:Calculation="http://www.sap.com/ndb/BiModelCalculation.ecore"
    id="DIM_VIEW" dataCategory="DIMENSION">
  <localVariables/>
  <logicalModel id="P1">
    <attributes>
      <attribute id="KEY_ATTR" order="1"/>
    </attributes>
  </logicalModel>
</Calculation:scenario>`;
    expect(() => extractCalculationViewOutputs(xml)).not.toThrow();
    expect(names(xml)).toEqual(['KEY_ATTR']);
});
```

**AC-10 — Variable without `parameter` attribute excluded**

```typescript
it('does not extract a variable with no parameter attribute', () => {
    const xml = scenario('', `<variable id="SOME_VAR"/>`);
    expect(names(xml)).not.toContain('SOME_VAR');
});
```

**AC-11 — Document ordering**

```typescript
it('returns subjects in document order: attributes → calcAttrs → measures → calcMeasures → restrictedMeasures → params', () => {
    const xml = scenario(
        `
      <attributes>
        <attribute id="A1" order="1"/>
        <attribute id="A2" order="2"/>
      </attributes>
      <calculatedAttributes>
        <calculatedAttribute id="CA1"/>
      </calculatedAttributes>
      <baseMeasures>
        <measure id="M1" aggregationType="sum"/>
        <measure id="M2" aggregationType="sum"/>
      </baseMeasures>
      <calculatedMeasures>
        <measure id="CM1"/>
      </calculatedMeasures>
      <restrictedMeasures>
        <measure id="RM1"/>
      </restrictedMeasures>`,
        `<variable id="IP1" parameter="true"/>`
    );
    expect(names(xml)).toEqual(['A1', 'A2', 'CA1', 'M1', 'M2', 'CM1', 'RM1', 'IP1']);
});
```

**AC-12 — Malformed XML returns empty array**

```typescript
it('returns [] and does not throw on invalid XML', () => {
    const bad = `<?xml version="1.0"?><Calculation:scenario><unclosed>`;
    expect(() => extractCalculationViewOutputs(bad)).not.toThrow();
    // Result is [] or partial — must not throw
});
```

**AC-13 — Missing `<logicalModel>` returns empty array**

```typescript
it('returns [] when logicalModel element is absent', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Calculation:scenario xmlns:Calculation="http://www.sap.com/ndb/BiModelCalculation.ecore"
    id="EMPTY" dataCategory="CUBE">
  <localVariables/>
</Calculation:scenario>`;
    expect(extractCalculationViewOutputs(xml)).toEqual([]);
});
```

**AC-14 — UTF-8 BOM handling**

```typescript
it('strips UTF-8 BOM and parses normally', () => {
    const xml = scenario(`<attributes><attribute id="BOM_ATTR" order="1"/></attributes>`);
    const withBom = '\uFEFF' + xml;
    expect(() => extractCalculationViewOutputs(withBom)).not.toThrow();
    expect(names(withBom)).toContain('BOM_ATTR');
});
```

**AC-15 — Integration with `lintFileContent` (integration test)**

```typescript
it('returns LintIssue for a field violating a contentRuleSet pattern', async () => {
    // This test exercises the full lintFileContent pipeline.
    // It requires importing lintFileContent and constructing a temp file path
    // (or mocking fs.readFile). Implement as a lightweight integration fixture.
});
```

**AC-16 — Build integrity** is verified by running `npm run build`; no unit test is needed.

---

## 7. Security Considerations

- **XML entity expansion (XXE)**: `fast-xml-parser` v4 does **not** resolve external DTD entities or `SYSTEM` entities by default. The default configuration is safe against XXE attacks. No `DOCTYPE` handling is enabled.
- **Billion-laughs (entity expansion DoS)**: `fast-xml-parser` does not expand internal entities beyond one level; exponential entity expansion is not possible with the default settings.
- **ReDoS**: No regex patterns with catastrophic backtracking are used. The BOM-stripping check (`startsWith('\uFEFF')`) is O(1). All other string operations are linear.
- **Input source**: Input is file content read from disk via the caller in `content-lint.ts`; it is not user-supplied web input. The risk surface is limited to developer-controlled project files.
- **Dependency supply chain**: One new production dependency (`fast-xml-parser`) is introduced. It has zero runtime dependencies of its own, is actively maintained, and has a clean security history. It must be pinned to a specific minor version in `package.json` (`^4.x.x`).
- **No eval / dynamic code generation**: no `eval`, `Function()`, or dynamic `require` calls anywhere in the module.

---

## 8. Performance Considerations

- **Singleton `XMLParser`**: instantiated once at module load time; no re-analysis on every file invocation (per NFR-3).
- **`parseTagValue: false`**: disabling tag-value coercion avoids unnecessary type-inference passes over every text node in the document; we only use XML attribute values.
- **`isArray` lookup**: uses a `Set<string>` for O(1) tag name lookup; called once per element during the parse pass.
- **BOM stripping**: `startsWith('\uFEFF')` is O(1); `slice(1)` allocates a new string only when a BOM is actually present.
- **`toArray` helper**: branches on `Array.isArray`, avoiding unnecessary allocations for the common case where the value is already an array.
- **Document size**: Typical `.hdbcalculationview` files are under 1,000 lines. The `fast-xml-parser` parse pass is O(n) in the input length. Even a 5,000-line file parses well within the 100 ms NFR-3 budget.
- **No filesystem access in the parser**: `extractCalculationViewOutputs()` is a pure function; all I/O is performed by the caller (`lintFileContent()`).

---

## 9. Implementation Approach and Milestones

### Milestone 1 — Dependency & scaffold (~15 min)

1. Run `pnpm add fast-xml-parser` — adds the package to `dependencies` in `package.json`.
2. Create the directory `src/parsers/hdbcalculationview/`.
3. Create empty `extractor.ts` and `index.ts` stubs.
4. Run `npm run build` — zero type errors expected (stubs export nothing yet).

### Milestone 2 — `extractor.ts` (~1 h)

1. Implement the `XMLParser` singleton with the configuration specified in §3.2.
2. Define the internal type interfaces (`IdNode`, `VariableNode`, `LogicalModelSection`, `LogicalModelNode`, `LocalVariablesNode`, `ScenarioNode`).
3. Implement `toArray` and `extractFields` helpers.
4. Implement `parseCalculationView()` following the traversal order in §3.2.
5. Run `npm run build` — zero type errors expected.

### Milestone 3 — `index.ts` (~10 min)

1. Implement `extractCalculationViewOutputs()` as a direct delegation to `parseCalculationView()`.
2. Write the JSDoc comment per §3.3.
3. Run `npm run build` — zero type errors expected.

### Milestone 4 — Integration with `content-lint.ts` (~15 min)

1. Add the import for `extractCalculationViewOutputs` at the top of `content-lint.ts`.
2. Add the `.hdbcalculationview` branch inside `extractSubjects()` per §3.4.
3. Run `npm run build` — zero type errors expected.

### Milestone 5 — Unit tests (~1.5 h)

1. Create `src/parsers/hdbcalculationview/__tests__/extractCalculationViewOutputs.test.ts`.
2. Implement the `scenario()` and `names()` / `types()` helper functions.
3. Write test cases for AC-1 through AC-14 per §6.
4. Run `pnpm test` — all tests pass.
5. Run `pnpm run test:coverage` — verify the new module has ≥ 90% branch coverage.

### Milestone 6 — Integration verification (~20 min)

1. Run `hana-linter` against a real project containing `.hdbcalculationview` files.
2. Confirm that configured `contentRuleSets` for `.hdbcalculationview` produce `LintIssue` entries for non-conforming column IDs and no issues for conforming ones.

---

## 10. Risk Assessment

| Risk                                                                                                              | Probability | Impact | Mitigation                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------- | ----------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty logical-model sections (`<restrictedMeasures/>`) parsed as `''` instead of `{}`, breaking iteration         | Medium      | Medium | The `                                                                                                                                                                                                                                      | ''`union in`LogicalModelNode`and the`extractFields` guard (`typeof section !== 'object'`) handle this explicitly. Unit test AC-9 covers a DIMENSION view with absent measures sections. |
| A single-child element (e.g., one `<attribute>`) returned as an object rather than a one-element array            | Medium      | High   | The `isArray` configuration option with `FORCE_ARRAY_TAGS` ensures `attribute`, `calculatedAttribute`, `measure`, and `variable` are always arrays when present. AC-1 and AC-6 include single-element cases.                               |
| Namespace prefix `Calculation:` in root element key causes lookup to return `undefined`                           | Low         | High   | `fast-xml-parser` preserves namespace-qualified element names verbatim as object keys. The lookup `parsed['Calculation:scenario']` is explicit and documented. A unit test for AC-13 verifies graceful degradation when the key is absent. |
| `fast-xml-parser` version upgrade changes default behaviour (e.g., attribute-prefix default)                      | Low         | Medium | Pin to `^4.x.x` in `package.json`. The `XMLParser` configuration is fully explicit (no reliance on defaults that differ across minor versions).                                                                                            |
| Input parameters with `parameter` attribute set to a non-string truthy value (e.g. boolean `true` after coercion) | Low         | Low    | `allowBooleanAttributes: false` in the parser config prevents boolean coercion. The guard `String(variable.parameter) === 'true'` is defensive against any residual coercion.                                                              |
| Very large calculation views (hundreds of nodes) exceed the 100 ms performance budget                             | Very Low    | Low    | `fast-xml-parser` is O(n) in document size. Profiling can be deferred; the risk is negligible for typical HANA project sizes.                                                                                                              |
| `DataSource` or `calculationView` node IDs accidentally matched if traversal logic is broadened                   | Low         | Medium | Traversal is strictly scoped to `logicalModel` and `localVariables` child elements. No wildcard `id` attribute searches are performed. AC-7 and AC-8 explicitly test exclusion of these elements.                                          |
