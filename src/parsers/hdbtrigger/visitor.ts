import type { CstChildrenDictionary, CstNode, IToken } from 'chevrotain';
import type { ExtractedSubject } from '../../types/issues';
import { hdbTriggerParser } from './parser';

const BaseCstVisitorWithDefaults = hdbTriggerParser.getBaseCstVisitorConstructorWithDefaults();

/**
 * CST visitor that walks the parse tree produced by HdbTriggerParser and
 * collects the local trigger name from the `triggerName` node.
 *
 * Only the `triggerName` sub-tree is visited for extraction.
 *
 * Blocked subtrees (explicit no-op visitor overrides prevent accidental
 * extraction from):
 *  - referencingItem — correlation-name aliases (OLD ROW AS <alias> etc.)
 *    are NOT emitted as trigger-name subjects.
 *  - updateColumnList — column names in UPDATE OF <col1>, <col2> are NOT
 *    emitted as trigger-name subjects.
 *
 * All other grammar-rule methods (`triggerStatement`, `triggerTiming`,
 * `triggerEvent`, `tableName`, `forEachClause`, `whenClause`,
 * `triggerBody`, `triggerBodyContent`, `nestedBlock`, `parenGroup`,
 * `anyBodyToken`, `identifier`) are left to the default auto-traversal
 * provided by BaseCstVisitorWithDefaults.  They contain no `triggerName`
 * child nodes, so auto-traversal into them produces no false extractions.
 *
 * Usage:
 *   const visitor = new HdbTriggerNameVisitor();
 *   visitor.visit(cst);
 *   return visitor.subjects;
 */
export class HdbTriggerNameVisitor extends BaseCstVisitorWithDefaults {
    public subjects: ExtractedSubject[] = [];

    constructor() {
        super();
        // Throws at construction if a visitor method name does not correspond
        // to an actual grammar rule — catches typos early.
        this.validateVisitor();
    }

    /**
     * Called for every `triggerName` node in the CST.
     *
     * The `triggerName` grammar rule produces one `identifier` child for an
     * unqualified name, or two `identifier` children for a schema-qualified
     * name (`"MY_SCHEMA"."TRG_AI_T"`).  We always extract the LAST `identifier`
     * child, which is the local (post-dot) name in both forms.
     */
    triggerName(ctx: CstChildrenDictionary): void {
        const identifierElements = ctx['identifier'];
        if (!identifierElements || identifierElements.length === 0) {
            return;
        }

        // Take the last identifier — it is the local trigger name whether or
        // not a schema qualifier is present.
        const localNameNode = identifierElements[identifierElements.length - 1] as CstNode;
        if (!localNameNode.children) {
            return;
        }

        const tokenElement =
            (localNameNode.children['QuotedIdentifier']?.[0] as IToken | undefined) ??
            (localNameNode.children['Identifier']?.[0] as IToken | undefined);

        if (!tokenElement) {
            return;
        }

        const raw = tokenElement.image;
        // Strip surrounding double-quotes from quoted identifiers
        // ("TRG_AI_T" → TRG_AI_T).
        const name = raw.startsWith('"') ? raw.slice(1, -1) : raw;

        this.subjects.push({ type: 'triggerName', name, lineNumber: tokenElement.startLine });
    }

    /**
     * referencingItem — explicit no-op.
     *
     * Prevents BaseCstVisitorWithDefaults from auto-traversing into the
     * correlation-name alias identifier (OLD ROW AS <alias>, NEW TABLE AS
     * <alias>, etc.) and treating it as an extraction target.
     */
    referencingItem(_ctx: CstChildrenDictionary): void {
        // Intentionally empty — the correlation-name alias must NOT be extracted.
    }

    /**
     * updateColumnList — explicit no-op.
     *
     * Prevents BaseCstVisitorWithDefaults from auto-traversing into the
     * column names declared in UPDATE OF <col1>, <col2>, ... and treating
     * them as extraction targets.
     */
    updateColumnList(_ctx: CstChildrenDictionary): void {
        // Intentionally empty — UPDATE OF column names must NOT be extracted.
    }
}
