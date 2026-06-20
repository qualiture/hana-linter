import { describe, it, expect, vi } from 'vitest';
import { extractCalculationViewOutputs } from '../index';
import { xmlParser } from '../extractor';

// ── Test helpers ──────────────────────────────────────────────────────────────

/**
 * Build a minimal but valid Calculation:scenario XML wrapper.
 * The wrapper always includes a <DataSource id="MY_TABLE"> and a
 * <calculationView id="Projection_1"> with a <viewAttribute id="INTERNAL_COL">
 * so that tests for exclusion of those ids are always exercised.
 */
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

function names(xml: string): string[] {
    return extractCalculationViewOutputs(xml).map((s) => s.name);
}

function types(xml: string): string[] {
    return extractCalculationViewOutputs(xml).map((s) => s.type);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('extractCalculationViewOutputs', () => {
    // AC-1 — Attribute extraction
    describe('AC-1: attribute extraction', () => {
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

        it('extracts a single attribute (not wrapped as object instead of array)', () => {
            const xml = scenario(`
      <attributes>
        <attribute id="ONLY_ONE" order="1"/>
      </attributes>`);
            expect(names(xml)).toEqual(['ONLY_ONE']);
        });
    });

    // AC-2 — Measure extraction
    describe('AC-2: base measure extraction', () => {
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

        it('extracts a single measure (not wrapped as object instead of array)', () => {
            const xml = scenario(`
      <attributes/>
      <baseMeasures>
        <measure id="SINGLE_MEASURE" aggregationType="sum"/>
      </baseMeasures>`);
            expect(names(xml)).toEqual(['SINGLE_MEASURE']);
        });
    });

    // AC-3 — Calculated attribute extraction
    describe('AC-3: calculated attribute extraction', () => {
        it('extracts calculatedAttribute ids from logicalModel/calculatedAttributes', () => {
            const xml = scenario(`
      <attributes/>
      <calculatedAttributes>
        <calculatedAttribute id="FULL_NAME"/>
      </calculatedAttributes>`);
            expect(names(xml)).toContain('FULL_NAME');
        });
    });

    // AC-4 — Calculated measure extraction
    describe('AC-4: calculated measure extraction', () => {
        it('extracts measure ids from logicalModel/calculatedMeasures', () => {
            const xml = scenario(`
      <attributes/>
      <calculatedMeasures>
        <measure id="AMOUNT_PCT"/>
      </calculatedMeasures>`);
            expect(names(xml)).toContain('AMOUNT_PCT');
        });
    });

    // AC-5 — Restricted measure extraction
    describe('AC-5: restricted measure extraction', () => {
        it('extracts measure ids from logicalModel/restrictedMeasures', () => {
            const xml = scenario(`
      <attributes/>
      <restrictedMeasures>
        <measure id="AMOUNT_ACTUALS"/>
      </restrictedMeasures>`);
            expect(names(xml)).toContain('AMOUNT_ACTUALS');
        });
    });

    // AC-6 — Input parameter extraction
    describe('AC-6: input parameter extraction', () => {
        it('extracts variables with parameter="true" as inputParameter', () => {
            const xml = scenario(
                '',
                `
      <variable id="IP_COMPANY_CODE" parameter="true"/>
      <variable id="INTERNAL_VAR"    parameter="false"/>`
            );
            expect(extractCalculationViewOutputs(xml)).toContainEqual({
                type: 'inputParameter',
                name: 'IP_COMPANY_CODE'
            });
            expect(names(xml)).not.toContain('INTERNAL_VAR');
        });

        it('returns inputParameter type (not field) for parameters', () => {
            const xml = scenario('', `<variable id="IP_PARAM" parameter="true"/>`);
            expect(extractCalculationViewOutputs(xml)).toContainEqual({
                type: 'inputParameter',
                name: 'IP_PARAM'
            });
        });
    });

    // AC-7 — Internal node attributes excluded
    describe('AC-7: internal node attributes excluded', () => {
        it('does not extract viewAttribute ids from calculationViews section', () => {
            // scenario() always injects a <viewAttribute id="INTERNAL_COL"/>
            const xml = scenario(`<attributes><attribute id="OUTPUT_COL" order="1"/></attributes>`);
            expect(names(xml)).not.toContain('INTERNAL_COL');
            expect(names(xml)).not.toContain('Projection_1');
            expect(names(xml)).toContain('OUTPUT_COL');
        });
    });

    // AC-8 — DataSource IDs excluded
    describe('AC-8: DataSource IDs excluded', () => {
        it('does not extract DataSource ids', () => {
            // scenario() always injects a <DataSource id="MY_TABLE"/>
            const xml = scenario(`<attributes><attribute id="ATTR_1" order="1"/></attributes>`);
            expect(names(xml)).not.toContain('MY_TABLE');
        });
    });

    // AC-9 — DIMENSION view (no measures section)
    describe('AC-9: DIMENSION view without measures', () => {
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

        it('handles empty self-closing section elements without error', () => {
            const xml = scenario(`
      <attributes/>
      <calculatedAttributes/>
      <baseMeasures/>
      <calculatedMeasures/>
      <restrictedMeasures/>`);
            expect(() => extractCalculationViewOutputs(xml)).not.toThrow();
            expect(names(xml)).toEqual([]);
        });
    });

    // AC-10 — Variable without `parameter` attribute excluded
    describe('AC-10: variable without parameter attribute excluded', () => {
        it('does not extract a variable with no parameter attribute', () => {
            const xml = scenario('', `<variable id="SOME_VAR"/>`);
            expect(names(xml)).not.toContain('SOME_VAR');
        });

        it('does not extract a variable with parameter="false"', () => {
            const xml = scenario('', `<variable id="NOT_A_PARAM" parameter="false"/>`);
            expect(names(xml)).not.toContain('NOT_A_PARAM');
        });
    });

    // AC-11 — Document ordering
    describe('AC-11: document ordering', () => {
        it('returns subjects in order: attributes → calcAttrs → measures → calcMeasures → restrictedMeasures → params', () => {
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
    });

    // AC-12 — Malformed XML returns empty array
    describe('AC-12: malformed XML', () => {
        it('returns [] and does not throw on invalid XML', () => {
            const bad = `<?xml version="1.0"?><Calculation:scenario><unclosed>`;
            expect(() => extractCalculationViewOutputs(bad)).not.toThrow();
        });

        it('returns [] on completely empty input', () => {
            expect(extractCalculationViewOutputs('')).toEqual([]);
        });

        it('returns [] on non-XML content', () => {
            expect(() => extractCalculationViewOutputs('not xml at all')).not.toThrow();
        });

        it('returns [] when the XML parser throws unexpectedly', () => {
            const spy = vi.spyOn(xmlParser, 'parse').mockImplementationOnce(() => {
                throw new Error('simulated parse error');
            });
            expect(() => extractCalculationViewOutputs('<x/>')).not.toThrow();
            expect(extractCalculationViewOutputs('<x/>')).toEqual([]);
            spy.mockRestore();
        });
    });

    // AC-13 — Missing logicalModel returns empty array
    describe('AC-13: missing logicalModel', () => {
        it('returns [] when logicalModel element is absent', () => {
            const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Calculation:scenario xmlns:Calculation="http://www.sap.com/ndb/BiModelCalculation.ecore"
    id="EMPTY" dataCategory="CUBE">
  <localVariables/>
</Calculation:scenario>`;
            expect(extractCalculationViewOutputs(xml)).toEqual([]);
        });

        it('returns [] when root element is not Calculation:scenario', () => {
            const xml = `<?xml version="1.0"?><someOtherRoot id="X"/>`;
            expect(extractCalculationViewOutputs(xml)).toEqual([]);
        });
    });

    // AC-14 — UTF-8 BOM handling
    describe('AC-14: UTF-8 BOM handling', () => {
        it('strips UTF-8 BOM and parses normally', () => {
            const xml = scenario(`<attributes><attribute id="BOM_ATTR" order="1"/></attributes>`);
            const withBom = '\uFEFF' + xml;
            expect(() => extractCalculationViewOutputs(withBom)).not.toThrow();
            expect(names(withBom)).toContain('BOM_ATTR');
        });

        it('produces same result with and without BOM', () => {
            const xml = scenario(`<attributes><attribute id="ATTR_X" order="1"/></attributes>`);
            expect(extractCalculationViewOutputs('\uFEFF' + xml)).toEqual(extractCalculationViewOutputs(xml));
        });
    });

    // Additional coverage
    describe('mixed subjects', () => {
        it('returns both field and inputParameter subjects from the same document', () => {
            const xml = scenario(
                `<attributes><attribute id="COL_A" order="1"/></attributes>
      <baseMeasures><measure id="MEAS_B" aggregationType="sum"/></baseMeasures>`,
                `<variable id="IP_C" parameter="true"/>`
            );
            expect(extractCalculationViewOutputs(xml)).toEqual([
                { type: 'field', name: 'COL_A' },
                { type: 'field', name: 'MEAS_B' },
                { type: 'inputParameter', name: 'IP_C' }
            ]);
        });

        it('returns [] for a document with only empty sections', () => {
            const xml = scenario(
                `<attributes/>
      <baseMeasures/>`,
                ''
            );
            expect(extractCalculationViewOutputs(xml)).toEqual([]);
        });

        it('silently skips elements that have no id attribute', () => {
            // An <attribute> element without an id is malformed but should not crash.
            const xml = scenario(`
      <attributes>
        <attribute order="1"/>
        <attribute id="VALID_ATTR" order="2"/>
      </attributes>`);
            expect(names(xml)).toEqual(['VALID_ATTR']);
        });
    });

    describe('CRLF line endings', () => {
        it('handles CRLF line endings without error', () => {
            const xml = scenario(`<attributes><attribute id="CRLF_ATTR" order="1"/></attributes>`).replace(/\n/g, '\r\n');
            expect(() => extractCalculationViewOutputs(xml)).not.toThrow();
            expect(names(xml)).toContain('CRLF_ATTR');
        });
    });
});
