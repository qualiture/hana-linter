import type { CstChildrenDictionary, CstNode, IToken } from 'chevrotain';
import type { ExtractedSubject } from '../../types/issues';
import { hdbFunctionParser } from './parser';

const BaseCstVisitorWithDefaults = hdbFunctionParser.getBaseCstVisitorConstructorWithDefaults();

/**
 * CST visitor that walks the parse tree produced by HdbFunctionParser and
 * collects the name of every formal IN parameter declared in the function's
 * parameter list.
 *
 * Subject type mapping:
 *  - Every parameter → { type: 'inputParameter', name }
 *
 * HANA functions accept only IN parameters; no 'outputParameter' entries are
 * ever produced.
 *
 * Blocked subtrees (visitor no-ops prevent extraction from):
 *  - tableColumnDefinition — column names inside TABLE-type IN parameters are
 *    NOT emitted as parameter subjects (AC-5).
 *  - returnColumnDefinition — column names in RETURNS TABLE(...) are NOT
 *    emitted as parameter subjects (AC-2, AC-3).
 *  - functionBody — the entire BEGIN…END block is opaque; IN keyword tokens
 *    inside SQL body statements are never reached (AC-6).
 *
 * Usage:
 *   const visitor = new HdbFunctionParameterVisitor();
 *   visitor.visit(cst);
 *   return visitor.parameters;
 */
export class HdbFunctionParameterVisitor extends BaseCstVisitorWithDefaults {
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
    // All function parameters are IN; no mode check is required.
    // Extracts the parameter name from the parameterName child rule.
    // -----------------------------------------------------------------------

    parameterDeclaration(ctx: CstChildrenDictionary): void {
        const nameNodes = ctx['parameterName'] as CstNode[] | undefined;
        if (!nameNodes?.length || !nameNodes[0]) return;

        const name = this.extractName(nameNodes[0]);
        if (!name) return;

        this.parameters.push({ type: 'inputParameter', name });
    }

    // -----------------------------------------------------------------------
    // tableColumnDefinition — no-op.
    //
    // Prevents the default auto-visit from descending into TABLE-type IN
    // parameter column definitions and treating inner column names as
    // parameter subjects (AC-5).
    // -----------------------------------------------------------------------

    tableColumnDefinition(_ctx: CstChildrenDictionary): void {
        // Intentionally empty — inner column names of TABLE-type IN parameters
        // are NOT extracted as parameter subjects.
    }

    // -----------------------------------------------------------------------
    // returnColumnDefinition — no-op.
    //
    // Prevents the default auto-visit from descending into RETURNS TABLE(...)
    // column definitions and treating return column names as parameter
    // subjects (AC-2, AC-3).
    // -----------------------------------------------------------------------

    returnColumnDefinition(_ctx: CstChildrenDictionary): void {
        // Intentionally empty — RETURNS TABLE column names are NOT extracted.
    }

    // -----------------------------------------------------------------------
    // functionBody — no-op.
    //
    // The entire BEGIN…END block is opaque: blocking descent here prevents
    // IN keyword tokens inside SQL body statements from ever reaching
    // parameterDeclaration (AC-6).
    // -----------------------------------------------------------------------

    functionBody(_ctx: CstChildrenDictionary): void {
        // Intentionally empty — function body content is never extracted.
    }

    // -----------------------------------------------------------------------
    // Private helper: extract and normalise the name from a parameterName node.
    // Strips surrounding double-quotes from quoted identifiers.
    // -----------------------------------------------------------------------

    private extractName(node: CstNode): string | undefined {
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
        return raw.startsWith('"') ? raw.slice(1, -1) : raw;
    }
}
