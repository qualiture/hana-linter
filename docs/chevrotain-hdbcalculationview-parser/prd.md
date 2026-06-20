# PRD: XML-based Parser/Extractor for `.hdbcalculationview` Output Columns & Parameters

## 1. Feature Name

**`.hdbcalculationview` Output Column & Input Parameter Extractor**

---

## 2. Goal

### Problem

The current `extractSubjects()` function in `src/content-lint.ts` has no handler for `.hdbcalculationview` files. When a user configures `contentRuleSets` targeting `.hdbcalculationview` output columns or input parameters, the linter silently returns an empty result — no identifiers are extracted, no lint issues are raised, and the user receives no indication that content-level linting is unsupported for this artifact type.

Unlike all other supported `.hdb*` artifact types (`.hdbtable`, `.hdbview`, `.hdbprocedure`, `.hdbfunction`, `.hdbtabletype`, `.hdbrole`), which are SQL DDL text files parseable with Chevrotain, **`.hdbcalculationview` files are XML documents**. The file schema is defined by the SAP HANA `BiModelCalculation.ecore` namespace and uses a hierarchical element structure to describe the view's node graph, data sources, logical model, and output columns.

This structural difference introduces distinct challenges:

- **XML-specific parsing** — SQL DDL tokenisation with Chevrotain is not applicable; a proper XML parser is required to reliably navigate namespaced elements and attributes.
- **Dual column taxonomy** — A calculation view exposes two distinct column kinds in its `<logicalModel>`: dimension _attributes_ (including calculated attributes) and analytical _measures_ (including calculated and restricted measures). Both must be extracted and may need separate naming-convention rules.
- **Input parameters** — Some views declare input parameters in `<localVariables>` (where `parameter="true"`). These are distinct from output columns and map to the existing `inputParameter` content target.
- **Node graph vs. logical model** — The `<calculationViews>` section contains internal node-level `<viewAttribute>` elements that are **not** the view's final output columns; only the identifiers declared in `<logicalModel>` represent what consumers of the view actually see.
- **Namespace-qualified root element** — The root element is `<Calculation:scenario>` in the `http://www.sap.com/ndb/BiModelCalculation.ecore` namespace. A naive string search for attribute `id` values would collect IDs from every element in the document (data sources, node IDs, mappings), producing a large number of false-positive identifier matches.
- **`dataCategory` variants** — Calculation views are declared as `CUBE`, `DIMENSION`, or `TIME`. `CUBE` views have both attributes and measures; `DIMENSION` views have only attributes; `TIME` views follow the dimension structure. The extractor must work correctly for all three.

### Solution

Implement an XML-based parser sub-module at `src/parsers/hdbcalculationview/` that uses Node.js's built-in `DOMParser` (available since Node 18 via the `node:dom` global exposure, or a lightweight dependency such as `fast-xml-parser`) to parse the XML document and navigate to the correct elements. A thin visitor layer maps the parsed structure to `ExtractedSubject[]`, then wires the new extractor into `extractSubjects()` in `src/content-lint.ts`.

This module follows the same public-API contract as all existing parser sub-modules: one exported function per file (`extractCalculationViewOutputs(fileContent: string): ExtractedSubject[]`), isolated from `content-lint.ts` internals, and independently unit-testable.

> **Deviation from Chevrotain pattern**: Because `.hdbcalculationview` files are well-formed XML rather than SQL DDL text, using Chevrotain to tokenise them would require reimplementing a general XML lexer — significant engineering effort with no benefit over a battle-tested XML library. All other aspects of the architecture (sub-module structure, public interface, error-graceful returns, integration point) remain identical to the Chevrotain-based parsers.

### Impact

- Enables content-level naming-convention rules for `.hdbcalculationview` output columns (both attributes and measures) and input parameters — a previously unsupported artifact type.
- Eliminates the silent no-op that currently affects teams who configure `contentRuleSets` for `.hdbcalculationview`.
- Completes coverage for all primary SAP HANA XS Advanced artifact types managed by `hana-linter`.

---

## 3. User Personas

**HANA Developer / CAP Developer**
A developer who creates `.hdbcalculationview` files to model analytical or dimension views over HANA tables. They configure `hana-linter` to enforce naming conventions on output column IDs (e.g., all attribute IDs must be uppercase snake case; measures must be prefixed with `MEAS_`) and on input parameter IDs (e.g., must be prefixed with `IP_`). They expect the lint results for calculation views to be as reliable as those for tables and procedures.

**Tooling / Platform Engineer**
An engineer responsible for maintaining `hana-linter`. They need the `.hdbcalculationview` extractor to follow the same structural conventions as the existing parsers so that the codebase remains consistent, even though the underlying parsing technology differs from Chevrotain.

---

## 4. User Stories

### Primary path

- **US-1**: As a HANA Developer, I want the linter to extract all output attribute IDs from the `<logicalModel>/<attributes>` section of an `.hdbcalculationview` file so that naming-convention checks are applied to every dimension attribute the view exposes.

- **US-2**: As a HANA Developer, I want the linter to extract all base and calculated measure IDs from the `<logicalModel>/<baseMeasures>` and `<logicalModel>/<calculatedMeasures>` sections of an `.hdbcalculationview` file so that naming conventions for analytical measures are enforced.

- **US-3**: As a HANA Developer, I want calculated attribute IDs from `<logicalModel>/<calculatedAttributes>` to be extracted alongside regular attributes so that all non-measure output columns of a DIMENSION or CUBE view are validated.

- **US-4**: As a HANA Developer, I want input parameter IDs from `<localVariables>/<variable parameter="true">` to be extracted as `inputParameter` subjects so that I can enforce a naming convention (e.g., `IP_` prefix) on all view input parameters.

### Edge cases

- **US-5**: As a HANA Developer, I want internal node-level `<viewAttribute>` elements inside `<calculationViews>` to be excluded from extraction so that intermediate pipeline column IDs never surface as lint targets.

- **US-6**: As a HANA Developer, I want restricted measures from `<logicalModel>/<restrictedMeasures>` to be extracted as `field` subjects alongside base and calculated measures so that all measure variants in a CUBE view are uniformly validated.

- **US-7**: As a HANA Developer, I want `<DataSource id="...">` identifiers and `<calculationView id="...">` node IDs to be excluded from extraction so that internal graph identifiers do not appear in the lint output.

- **US-8**: As a HANA Developer, I want the extractor to handle both `CUBE` and `DIMENSION` (and `TIME`) `dataCategory` values without errors so that all calculation view types in my project are linted.

- **US-9**: As a HANA Developer, I want a `<localVariables>/<variable>` element that has `parameter="false"` (or no `parameter` attribute) to be excluded from extraction, so that only true input parameters trigger `inputParameter` rules.

- **US-10**: As a Tooling Engineer, I want the extractor to return an empty array (not throw) when the file content is not valid XML or is missing the `<logicalModel>` element, so that corrupt or partially written files do not crash the linter process.

- **US-11**: As a Tooling Engineer, I want the parser module to expose a stable TypeScript interface (`extractCalculationViewOutputs(fileContent: string): ExtractedSubject[]`) so that `content-lint.ts` is not coupled to the XML library internals and future parser upgrades are isolated.

---

## 5. Requirements

### Functional Requirements

- **FR-1** Create a dedicated parser sub-module at `src/parsers/hdbcalculationview/` containing the following files, mirroring the layout of the other parser sub-modules:
    - `extractor.ts` — XML traversal and `ExtractedSubject` population logic (analogous to `visitor.ts` in Chevrotain modules)
    - `index.ts` — Public entry point exporting `extractCalculationViewOutputs`
    - `__tests__/extractCalculationViewOutputs.test.ts` — Unit tests

- **FR-2** Select and adopt a single XML parsing strategy in `extractor.ts`. Acceptable approaches (in preference order):
    1. **`fast-xml-parser`** (npm package): fast, TypeScript-native, no native binaries, supports attribute extraction. Add as a production dependency.
    2. **Node.js built-in `DOMParser`** (available in Node 18+ via `globalThis`): zero additional dependency, but requires care around namespace handling for the `Calculation:` prefix.
       The chosen approach must be noted in the technical specification. Only one approach may be implemented; no fallback/dual-parser logic.

- **FR-3** The `extractor.ts` module must extract identifiers from the following XML locations within a valid `.hdbcalculationview` document:

    | Source element path                                                  | Extraction condition                             | `ExtractedSubject.type` |
    | -------------------------------------------------------------------- | ------------------------------------------------ | ----------------------- |
    | `<logicalModel>/<attributes>/<attribute id="…">`                     | always                                           | `'field'`               |
    | `<logicalModel>/<calculatedAttributes>/<calculatedAttribute id="…">` | always                                           | `'field'`               |
    | `<logicalModel>/<baseMeasures>/<measure id="…">`                     | always                                           | `'field'`               |
    | `<logicalModel>/<calculatedMeasures>/<measure id="…">`               | always                                           | `'field'`               |
    | `<logicalModel>/<restrictedMeasures>/<measure id="…">`               | always                                           | `'field'`               |
    | `<localVariables>/<variable id="…" parameter="true">`                | `parameter` attribute equals the string `"true"` | `'inputParameter'`      |

    All other elements (including `<DataSource>`, `<calculationView>`, `<viewAttribute>`, `<mapping>`) must be ignored.

- **FR-4** Identifiers extracted from `id` XML attributes must be returned as-is (no quote stripping, since XML attribute values do not carry HANA double-quote delimiters).

- **FR-5** Implement a public extractor function `extractCalculationViewOutputs(fileContent: string): ExtractedSubject[]` in `src/parsers/hdbcalculationview/index.ts`. This function:
    - Parses the input string as XML.
    - Navigates to the `<logicalModel>` and `<localVariables>` elements.
    - Collects all identifiers per **FR-3**.
    - Returns the resulting `ExtractedSubject[]` array.
    - If the XML is malformed or the document root is unrecognised, returns `[]` without throwing.

- **FR-6** Extend `extractSubjects()` in `src/content-lint.ts` to handle `.hdbcalculationview` files: add a branch `if (extension === '.hdbcalculationview') return extractCalculationViewOutputs(fileContent)`.

- **FR-7** The existing `ExtractedSubject` type and the rest of the `lintFileContent` pipeline must remain unchanged; the new sub-module is additive only.

- **FR-8** The `extractCalculationViewOutputs` function must handle both CRLF and LF line endings and UTF-8 encoded files with and without a BOM (`\uFEFF`).

- **FR-9** The ordering of returned `ExtractedSubject` entries must follow document order (top-to-bottom within `<logicalModel>`: attributes → calculated attributes → base measures → calculated measures → restricted measures, then parameters from `<localVariables>`).

### Non-Functional Requirements

- **NFR-1** Exactly one new production dependency is permitted: the chosen XML parser (see **FR-2**). If the Node.js built-in `DOMParser` approach is selected, no new dependency is added.

- **NFR-2** No native binaries or build-step code generation. All code compiles with `npm run build` (`tsc`).

- **NFR-3** Parsing a single `.hdbcalculationview` file must complete in under 100 ms on commodity hardware for files up to 5,000 lines.

- **NFR-4** The introduction of the `.hdbcalculationview` extractor must not alter the public API of `src/index.ts`, `src/lint.ts`, or the `LintIssue` type.

- **NFR-5** The extractor module must be independently unit-testable: given a string of XML content, `extractCalculationViewOutputs()` returns the expected `ExtractedSubject[]` array without any filesystem access.

- **NFR-6** The `ContentTarget` type in `src/types/rules.ts` must **not** be extended in this feature. Attributes, calculated attributes, and all measure variants are all exposed as `type: 'field'`; input parameters as `type: 'inputParameter'`. Distinguishing attributes from measures at the type level is explicitly deferred to a future feature.

---

## 6. Acceptance Criteria

### AC-1 — Attribute extraction

**Given** an `.hdbcalculationview` XML file containing:

```xml
<logicalModel id="Projection_1">
  <attributes>
    <attribute id="COMPANY_CODE" order="1"/>
    <attribute id="FISCAL_YEAR" order="2"/>
  </attributes>
  ...
</logicalModel>
```

**When** `extractCalculationViewOutputs()` is called,  
**Then** it returns at least `[{ type: 'field', name: 'COMPANY_CODE' }, { type: 'field', name: 'FISCAL_YEAR' }]`.

---

### AC-2 — Measure extraction

**Given** an `.hdbcalculationview` XML file with a `CUBE` data category containing:

```xml
<logicalModel id="Projection_1">
  <attributes>...</attributes>
  <baseMeasures>
    <measure id="AMOUNT" order="3" aggregationType="sum"/>
    <measure id="QUANTITY" order="4" aggregationType="sum"/>
  </baseMeasures>
  ...
</logicalModel>
```

**When** `extractCalculationViewOutputs()` is called,  
**Then** the result contains `{ type: 'field', name: 'AMOUNT' }` and `{ type: 'field', name: 'QUANTITY' }`.

---

### AC-3 — Calculated attribute extraction

**Given** an `.hdbcalculationview` file with a `<calculatedAttributes>` section containing a `<calculatedAttribute id="FULL_NAME">` element,  
**When** `extractCalculationViewOutputs()` is called,  
**Then** the result contains `{ type: 'field', name: 'FULL_NAME' }`.

---

### AC-4 — Calculated measure extraction

**Given** an `.hdbcalculationview` file with a `<calculatedMeasures>` section containing a `<measure id="AMOUNT_PCT">` element,  
**When** `extractCalculationViewOutputs()` is called,  
**Then** the result contains `{ type: 'field', name: 'AMOUNT_PCT' }`.

---

### AC-5 — Restricted measure extraction

**Given** an `.hdbcalculationview` file with a `<restrictedMeasures>` section containing a `<measure id="AMOUNT_ACTUALS">` element,  
**When** `extractCalculationViewOutputs()` is called,  
**Then** the result contains `{ type: 'field', name: 'AMOUNT_ACTUALS' }`.

---

### AC-6 — Input parameter extraction

**Given** an `.hdbcalculationview` file with:

```xml
<localVariables>
  <variable id="IP_COMPANY_CODE" parameter="true"/>
  <variable id="INTERNAL_VAR" parameter="false"/>
</localVariables>
```

**When** `extractCalculationViewOutputs()` is called,  
**Then** the result contains `{ type: 'inputParameter', name: 'IP_COMPANY_CODE' }` and does **not** contain any entry for `INTERNAL_VAR`.

---

### AC-7 — Internal node attributes excluded

**Given** an `.hdbcalculationview` file where the `<calculationViews>` section contains:

```xml
<calculationView xsi:type="Calculation:ProjectionView" id="Projection_1">
  <viewAttributes>
    <viewAttribute id="COMPANY_CODE"/>
  </viewAttributes>
</calculationView>
```

**When** `extractCalculationViewOutputs()` is called,  
**Then** neither `Projection_1` nor any `viewAttribute id` appears in the result (only the `<logicalModel>` attributes appear).

---

### AC-8 — DataSource IDs excluded

**Given** an `.hdbcalculationview` file containing `<DataSource id="MY_TABLE">`,  
**When** `extractCalculationViewOutputs()` is called,  
**Then** `MY_TABLE` is **not** present in the result.

---

### AC-9 — DIMENSION view (no measures section)

**Given** an `.hdbcalculationview` file with `dataCategory="DIMENSION"` containing only `<attributes>` in `<logicalModel>` and no `<baseMeasures>` element,  
**When** `extractCalculationViewOutputs()` is called,  
**Then** only the attribute IDs are returned with no error.

---

### AC-10 — Variable without `parameter` attribute treated as non-parameter

**Given** an `.hdbcalculationview` file with `<variable id="SOME_VAR">` (no `parameter` attribute),  
**When** `extractCalculationViewOutputs()` is called,  
**Then** `SOME_VAR` is **not** present in the result.

---

### AC-11 — Document ordering

**Given** an `.hdbcalculationview` file with attributes `A1`, `A2`, calculated attribute `CA1`, measures `M1`, `M2`, calculated measure `CM1`, restricted measure `RM1`, and input parameter `IP1`,  
**When** `extractCalculationViewOutputs()` is called,  
**Then** the result array follows this order: `A1`, `A2`, `CA1`, `M1`, `M2`, `CM1`, `RM1`, `IP1`.

---

### AC-12 — Malformed XML returns empty array

**Given** an `.hdbcalculationview` file with invalid XML (e.g., unclosed tags),  
**When** `extractCalculationViewOutputs()` is called,  
**Then** it does **not** throw an exception and returns `[]`.

---

### AC-13 — Missing `<logicalModel>` returns empty array

**Given** an `.hdbcalculationview` XML file that is valid XML but contains no `<logicalModel>` element,  
**When** `extractCalculationViewOutputs()` is called,  
**Then** it returns `[]` without throwing.

---

### AC-14 — UTF-8 BOM handling

**Given** an `.hdbcalculationview` file that begins with a UTF-8 BOM (`\uFEFF`),  
**When** `extractCalculationViewOutputs()` is called,  
**Then** the BOM does not cause a parse error and identifiers are extracted correctly.

---

### AC-15 — Integration with `lintFileContent`

**Given** an `.hdbcalculationview` file whose output column IDs violate a configured `contentRuleSet` rule (e.g., `target: 'field'`),  
**When** `lintFileContent()` is called,  
**Then** one `LintIssue` per violating identifier is returned with `subjectType: 'field'` and the correct `subjectName`.

---

### AC-16 — Build integrity

**Given** the updated codebase,  
**When** `npm run build` is executed,  
**Then** it completes with zero TypeScript compilation errors.

---

## 7. Out of Scope

- Parsers for any other `.hdb*` artifact type not already covered by existing sub-modules.
- Full XML schema validation against the `BiModelCalculation.ecore` schema — the extractor navigates to known element paths only.
- Extraction of column names from `<dataSources>`, `<calculationViews>` node graphs, `<input>` mappings, or `<layout>` elements — only `<logicalModel>` and `<localVariables>` are in scope.
- Distinguishing `type: 'field'` attributes from `type: 'measure'` measures — this would require extending `ContentTarget` in `src/types/rules.ts` and is deferred to a future feature.
- Extraction of hierarchy definitions, level IDs, or localDimension elements within `<logicalModel>`.
- Support for the `.hdbcds` (CDS / Core Data Services) format — structurally different from calculation view XML.
- Support for legacy XS Classic `.analyticview` or `.attributeview` XML formats — different root elements and schemas.
- Auto-fix / code-rewriting capabilities.
- Semantic validation of the calculation view graph (e.g., verifying that mapped columns exist in the referenced data source).
- Extraction of `<descriptions defaultDescription="…">` human-readable labels — only the machine `id` attribute is extracted.
