import type { CstChildrenDictionary, CstNode, IToken } from 'chevrotain';
import type { ExtractedSubject } from '../../types/issues';
import { hdbSequenceParser } from './parser';

const BaseCstVisitorWithDefaults = hdbSequenceParser.getBaseCstVisitorConstructorWithDefaults();

/**
 * CST visitor that walks the parse tree produced by HdbSequenceParser and
 * collects the local sequence name from the `sequenceName` node.
 *
 * Only the `sequenceName` sub-tree is visited for extraction.
 * The `resetByClause` sub-tree is overridden with a no-op to prevent any
 * accidental traversal into the RESET BY SELECT body tokens.
 * All other grammar nodes are traversed by the default base-class
 * implementation but produce no output.
 *
 * Usage:
 *   const visitor = new HdbSequenceNameVisitor();
 *   visitor.visit(cst);
 *   return visitor.subjects;
 */
export class HdbSequenceNameVisitor extends BaseCstVisitorWithDefaults {
    public subjects: ExtractedSubject[] = [];

    constructor() {
        super();
        // Throws at construction if a visitor method name does not correspond
        // to an actual grammar rule — catches typos early.
        this.validateVisitor();
    }

    /**
     * Called for every `sequenceName` node in the CST.
     *
     * The `sequenceName` grammar rule produces one `identifier` child for an
     * unqualified name, or two `identifier` children for a schema-qualified
     * name (`"SCHEMA"."SEQ_NAME"`).  We always extract the LAST `identifier`
     * child, which is the local (post-dot) name in both forms.
     */
    sequenceName(ctx: CstChildrenDictionary): void {
        const identifierElements = ctx['identifier'];
        if (!identifierElements || identifierElements.length === 0) {
            return;
        }

        // Take the last identifier — it is the local sequence name whether or
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
        // Strip surrounding double-quotes from quoted identifiers ("MY_SEQ" → MY_SEQ).
        const name = raw.startsWith('"') ? raw.slice(1, -1) : raw;

        this.subjects.push({ type: 'sequenceName', name, lineNumber: tokenElement.startLine });
    }

    /**
     * Called for every `resetByClause` node in the CST.
     * Overridden as a no-op to prevent BaseCstVisitorWithDefaults from
     * auto-traversing into the RESET BY SELECT body and surfacing any
     * identifiers or keywords it contains.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    resetByClause(_ctx: CstChildrenDictionary): void {
        // Intentionally empty — all tokens inside the RESET BY SELECT body
        // are consumed structurally but must NOT be extracted as subjects.
    }
}
