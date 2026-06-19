import type { CstChildrenDictionary, CstNode, IToken } from 'chevrotain';
import type { ExtractedSubject } from '../../types/issues';
import { hdbTableParser } from './parser';

const BaseCstVisitorWithDefaults = hdbTableParser.getBaseCstVisitorConstructorWithDefaults();

/**
 * CST visitor that walks the parse tree produced by HdbTableParser and
 * collects the name of every column defined in the table.
 *
 * Only `columnDefinition` nodes are visited; constraint and table-option
 * sub-trees are auto-skipped by the with-defaults base class.
 *
 * Usage:
 *   const visitor = new HdbTableColumnVisitor();
 *   visitor.visit(cst);
 *   return visitor.columns;
 */
export class HdbTableColumnVisitor extends BaseCstVisitorWithDefaults {
    public columns: ExtractedSubject[] = [];

    constructor() {
        super();
        // Throws at construction if a visitor method name doesn't correspond
        // to an actual grammar rule — catches typos early.
        this.validateVisitor();
    }

    /**
     * Called for every `columnDefinition` node in the CST.
     * Extracts the first `identifier` child and normalises its image
     * (stripping surrounding double-quotes from quoted identifiers).
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

        // The `identifier` rule consumes either an Identifier or a QuotedIdentifier token.
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
