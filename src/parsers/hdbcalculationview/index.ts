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
