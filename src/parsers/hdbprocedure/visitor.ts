import type { CstChildrenDictionary, CstNode, IToken } from 'chevrotain';
import type { ExtractedSubject } from '../../types/issues';
import { hdbProcedureParser } from './parser';

const BaseCstVisitorWithDefaults = hdbProcedureParser.getBaseCstVisitorConstructorWithDefaults();

/**
 * CST visitor that walks the parse tree produced by HdbProcedureParser and
 * collects the name and mode of every formal parameter declared in the
 * procedure's parameter list.
 *
 * Subject type mapping:
 *  - IN   parameter  → { type: 'inputParameter',  name }
 *  - OUT  parameter  → { type: 'outputParameter', name }
 *  - INOUT parameter → both entries (inputParameter AND outputParameter)
 *
 * Blocked subtrees (visitor no-ops prevent extraction from):
 *  - tableColumnDefinition — column names inside TABLE-type parameters are
 *    NOT emitted as parameter subjects (AC-4).
 *  - procedureBody — the entire BEGIN…END block is opaque; IN/OUT/INOUT
 *    tokens inside SQL body statements are never reached (AC-5).
 *
 * Usage:
 *   const visitor = new HdbProcedureParameterVisitor();
 *   visitor.visit(cst);
 *   return visitor.parameters;
 */
export class HdbProcedureParameterVisitor extends BaseCstVisitorWithDefaults {
    public parameters: ExtractedSubject[] = [];

    constructor() {
        super();
        // Throws at construction if a visitor method name doesn't correspond
        // to an actual grammar rule — catches typos early.
        this.validateVisitor();
    }

    // -----------------------------------------------------------------------
    // parameterDeclaration — primary extraction point.
    //
    // Reads which mode token is present in the parameterMode child, then
    // extracts the name from the parameterName child.
    // -----------------------------------------------------------------------

    parameterDeclaration(ctx: CstChildrenDictionary): void {
        // Determine mode from which token the parameterMode rule consumed.
        const modeNodes = ctx['parameterMode'] as CstNode[] | undefined;
        if (!modeNodes?.length) return;

        const modeCtx = modeNodes[0]?.children as CstChildrenDictionary | undefined;
        if (!modeCtx) return;

        const isIn = Boolean(modeCtx['In']?.[0]);
        const isOut = Boolean(modeCtx['Out']?.[0]);
        const isInout = Boolean(modeCtx['Inout']?.[0]);

        // Extract the parameter name.
        const nameNodes = ctx['parameterName'] as CstNode[] | undefined;
        if (!nameNodes?.length || !nameNodes[0]) return;

        const extracted = this.extractName(nameNodes[0]);
        if (!extracted) return;

        if (isIn || isInout) {
            this.parameters.push({ type: 'inputParameter', name: extracted.name, lineNumber: extracted.lineNumber });
        }
        if (isOut || isInout) {
            this.parameters.push({ type: 'outputParameter', name: extracted.name, lineNumber: extracted.lineNumber });
        }
    }

    // -----------------------------------------------------------------------
    // tableColumnDefinition — no-op.
    //
    // Prevents the default auto-visit from descending into TABLE-type parameter
    // column definitions and treating inner column names as parameter names.
    // -----------------------------------------------------------------------

    tableColumnDefinition(_ctx: CstChildrenDictionary): void {
        // Intentionally empty — inner column names of TABLE-type parameters
        // are NOT extracted as parameter subjects (AC-4).
    }

    // -----------------------------------------------------------------------
    // procedureBody — no-op.
    //
    // The entire BEGIN…END block is opaque: blocking descent here prevents
    // IN/OUT/INOUT keyword tokens inside SQL body statements from ever
    // reaching parameterDeclaration (AC-5).
    // -----------------------------------------------------------------------

    procedureBody(_ctx: CstChildrenDictionary): void {
        // Intentionally empty — procedure body content is never extracted.
    }

    // -----------------------------------------------------------------------
    // Private helper: extract and normalise the name from a parameterName node.
    // Strips surrounding double-quotes from quoted identifiers.
    // -----------------------------------------------------------------------

    private extractName(node: CstNode): { name: string; lineNumber?: number } | undefined {
        if (!node.children) return undefined;

        // parameterName → identifier → Identifier | QuotedIdentifier
        const identifierNodes = node.children['identifier'] as CstNode[] | undefined;
        if (!identifierNodes?.length) return undefined;

        const identNode = identifierNodes[0];
        if (!identNode?.children) return undefined;

        const token =
            (identNode.children['Identifier']?.[0] as IToken | undefined) ?? (identNode.children['QuotedIdentifier']?.[0] as IToken | undefined);

        if (!token) return undefined;

        const raw = token.image;
        const name = raw.startsWith('"') ? raw.slice(1, -1) : raw;
        return { name, lineNumber: token.startLine };
    }
}
