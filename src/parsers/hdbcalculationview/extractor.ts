import { XMLParser } from 'fast-xml-parser';
import type { ExtractedSubject } from '../../types/issues';

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

// ── Internal type interfaces ──────────────────────────────────────────────────
// These model only the portions of the document that the extractor navigates.

/** An element with at minimum an id XML attribute. */
interface IdNode {
    id: string;
}

/** A <variable> element. */
interface VariableNode extends IdNode {
    /** String "true" when the variable is an input parameter. */
    parameter?: string;
}

/**
 * Sections within <logicalModel> that contain a list of column-like elements.
 * fast-xml-parser represents a self-closing empty element (e.g. <restrictedMeasures/>)
 * as the empty string ''.  The '| string' union guards against this coercion.
 */
interface LogicalModelSection {
    attribute?: IdNode[];
    calculatedAttribute?: IdNode[];
    measure?: IdNode[];
}

/** The <logicalModel> element. */
interface LogicalModelNode {
    attributes?: LogicalModelSection | string;
    calculatedAttributes?: LogicalModelSection | string;
    baseMeasures?: LogicalModelSection | string;
    calculatedMeasures?: LogicalModelSection | string;
    restrictedMeasures?: LogicalModelSection | string;
}

/** The <localVariables> element. */
interface LocalVariablesNode {
    variable?: VariableNode[];
}

/** The root <Calculation:scenario> element (only the fields we navigate). */
interface ScenarioNode {
    logicalModel?: LogicalModelNode;
    localVariables?: LocalVariablesNode | string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Safely coerce an unknown value to an array.
 * - undefined / null / '' or any other non-array value → []
 * - already an array                                   → returned as-is
 *
 * All tags passed to this helper are declared in FORCE_ARRAY_TAGS, so
 * fast-xml-parser always returns them as arrays when present.  The non-array
 * fallback exists only as a defensive guard.
 */
function toArray<T>(value: T[] | undefined | null | string): T[] {
    if (!value || !Array.isArray(value)) return [];
    return value;
}

/**
 * Extract ExtractedSubject entries with type 'field' from a single
 * logical-model section (attributes / calculatedAttributes / baseMeasures /
 * calculatedMeasures / restrictedMeasures).
 *
 * @param section - The parsed section object (or '' for empty elements).
 * @param childTag - The XML child element tag to collect.
 */
function extractFields(section: LogicalModelSection | string | undefined, childTag: keyof LogicalModelSection): ExtractedSubject[] {
    if (!section || typeof section !== 'object') return [];
    return toArray(section[childTag]).flatMap((node) => (node.id ? [{ type: 'field' as const, name: node.id }] : []));
}

// ── Main traversal function ───────────────────────────────────────────────────

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
