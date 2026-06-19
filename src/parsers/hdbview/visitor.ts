import type { CstChildrenDictionary, CstNode, IToken } from 'chevrotain';
import type { ExtractedSubject } from '../../types/issues';
import { hdbViewParser } from './parser';

const BaseCstVisitorWithDefaults = hdbViewParser.getBaseCstVisitorConstructorWithDefaults();

/**
 * CST visitor that walks the parse tree produced by HdbViewParser and
 * collects the column aliases exposed by the view.
 *
 * Two extraction modes — selected at visit time based on the CST shape:
 *
 *  Mode 1 — explicitColumnList present:
 *    The view header declares its column names: VIEW V ("A", "B") AS SELECT ...
 *    Only the identifiers in the explicit list are extracted. The selectStatement
 *    subtree is NOT visited, so AS aliases in the SELECT are ignored.
 *
 *  Mode 2 — no explicitColumnList:
 *    The view exposes whatever aliases the top-level SELECT defines.
 *    AS aliases from selectItem nodes are extracted. The selectStatement
 *    subtree IS visited (for selectItem nodes), but:
 *      - subquery nodes are overridden to no-op, blocking recursion into
 *        derived-table SELECT bodies (AC-3).
 *      - unionClause nodes are overridden to no-op, so UNION/INTERSECT/EXCEPT
 *        secondary SELECT bodies are not extracted.
 *
 * Usage:
 *   const visitor = new HdbViewColumnVisitor();
 *   visitor.visit(cst);
 *   return visitor.columns;
 */
export class HdbViewColumnVisitor extends BaseCstVisitorWithDefaults {
    public columns: ExtractedSubject[] = [];

    constructor() {
        super();
        // Throws at construction if a visitor method name doesn't correspond
        // to an actual grammar rule — catches typos early.
        this.validateVisitor();
    }

    // -----------------------------------------------------------------------
    // createViewStatement — two-mode entry point.
    //
    // Overriding this prevents the default auto-visit from descending into
    // both explicitColumnList AND selectStatement simultaneously.
    // -----------------------------------------------------------------------

    createViewStatement(ctx: CstChildrenDictionary): void {
        if (ctx['explicitColumnList']) {
            // Mode 1: column names are declared in the explicit list.
            // Do NOT visit selectStatement — AS aliases in SELECT are irrelevant.
            this.visit(ctx['explicitColumnList'] as CstNode[]);
        } else {
            // Mode 2: column names come from top-level AS aliases in SELECT.
            if (ctx['selectStatement']) {
                this.visit(ctx['selectStatement'] as CstNode[]);
            }
        }
    }

    // -----------------------------------------------------------------------
    // explicitColumnList — Mode 1 extraction.
    // Collect every identifier in the declared column list.
    // -----------------------------------------------------------------------

    explicitColumnList(ctx: CstChildrenDictionary): void {
        const identifiers = ctx['identifier'] as CstNode[] | undefined;
        if (!identifiers) return;
        for (const node of identifiers) {
            this.extractIdentifier(node);
        }
    }

    // -----------------------------------------------------------------------
    // selectItem — Mode 2 extraction.
    // Extract only the AS alias identifier, not the expression.
    // Items without an AS alias are silently skipped (per AC-9 / US-8).
    // -----------------------------------------------------------------------

    selectItem(ctx: CstChildrenDictionary): void {
        // ctx['identifier'] holds the alias CstNode from "AS identifier".
        // It is absent when there is no AS clause in the selectItem.
        const aliasNodes = ctx['identifier'] as CstNode[] | undefined;
        if (!aliasNodes || aliasNodes.length === 0) {
            return;
        }
        const aliasNode = aliasNodes[0];
        if (!aliasNode) return;
        this.extractIdentifier(aliasNode);
    }

    // -----------------------------------------------------------------------
    // subquery — no-op: prevents extraction of aliases from derived-table
    // SELECT bodies nested in the FROM clause (AC-3).
    // The default auto-visit would recurse into the inner selectStatement
    // and call selectItem for its items; this override blocks that.
    // -----------------------------------------------------------------------

    subquery(_ctx: CstChildrenDictionary): void {
        // Intentionally empty — do not recurse into derived-table SELECT bodies.
    }

    // -----------------------------------------------------------------------
    // unionClause — no-op: prevents extraction from UNION / INTERSECT / EXCEPT
    // secondary SELECT bodies (out-of-scope per PRD §7).
    // -----------------------------------------------------------------------

    unionClause(_ctx: CstChildrenDictionary): void {
        // Intentionally empty — only the first SELECT branch defines view columns.
    }

    // -----------------------------------------------------------------------
    // Private helper: normalise and push a single identifier node.
    // -----------------------------------------------------------------------

    private extractIdentifier(node: CstNode): void {
        if (!node.children) return;

        // The `identifier` rule consumes either an Identifier or a QuotedIdentifier.
        const token = (node.children['Identifier']?.[0] as IToken | undefined) ?? (node.children['QuotedIdentifier']?.[0] as IToken | undefined);

        if (!token) return;

        const raw = token.image;
        // Strip surrounding double-quotes: "MY_COL" → MY_COL.
        const name = raw.startsWith('"') ? raw.slice(1, -1) : raw;
        this.columns.push({ type: 'field', name });
    }
}
