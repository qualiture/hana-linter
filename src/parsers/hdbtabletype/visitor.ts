import type { CstChildrenDictionary, CstNode, IToken } from 'chevrotain';
import type { ExtractedSubject } from '../../types/issues';
import { hdbTableTypeParser } from './parser';

const BaseCstVisitorWithDefaults = hdbTableTypeParser.getBaseCstVisitorConstructorWithDefaults();

/**
 * CST visitor that walks the parse tree produced by HdbTableTypeParser and
 * collects the name of every column defined in the table type body.
 *
 * Only `columnDefinition` nodes are visited for extraction.
 * The `typeName` sub-tree is overridden with a no-op so that the schema name
 * and type name are never emitted as field subjects.
 * All other grammar nodes (dataType, dataTypeKeyword, etc.) are traversed by
 * the default base class implementation but produce no output.
 *
 * Usage:
 *   const visitor = new HdbTableTypeColumnVisitor();
 *   visitor.visit(cst);
 *   return visitor.columns;
 */
export class HdbTableTypeColumnVisitor extends BaseCstVisitorWithDefaults {
    public columns: ExtractedSubject[] = [];

    constructor() {
        super();
        // Throws at construction if a visitor method name does not correspond
        // to an actual grammar rule — catches typos early.
        this.validateVisitor();
    }

    /**
     * Called for every `typeName` node in the CST.
     * Overridden as a no-op so the schema identifier and type name identifier
     * are never emitted as `field` subjects.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    typeName(_ctx: CstChildrenDictionary): void {
        // Intentionally empty — the type name and optional schema prefix are
        // NOT extracted as column field subjects.
    }

    /**
     * Called for every `columnDefinition` node in the CST.
     * Extracts the first `identifier` child (the column name) and normalises
     * its image (stripping surrounding double-quotes from quoted identifiers).
     */
    columnDefinition(ctx: CstChildrenDictionary): void {
        const identifierElements = ctx['identifier'];
        if (!identifierElements || identifierElements.length === 0) {
            return;
        }

        // The first element is the CstNode produced by the `identifier` rule.
        const identifierNode = identifierElements[0] as CstNode;
        if (!identifierNode.children) {
            return;
        }

        // The `identifier` rule consumes either an Identifier or a QuotedIdentifier.
        const tokenElement = identifierNode.children['Identifier']?.[0] ?? identifierNode.children['QuotedIdentifier']?.[0];

        if (!tokenElement) {
            return;
        }

        const token = tokenElement as IToken;
        const raw = token.image;
        // Strip surrounding double-quotes from quoted identifiers ("MY_COL" → MY_COL).
        const name = raw.startsWith('"') ? raw.slice(1, -1) : raw;

        this.columns.push({ type: 'field', name, lineNumber: token.startLine });
    }
}
