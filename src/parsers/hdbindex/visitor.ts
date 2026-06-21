import type { CstChildrenDictionary, CstNode, IToken } from 'chevrotain';
import type { ExtractedSubject } from '../../types/issues';
import { hdbIndexParser } from './parser';

const BaseCstVisitorWithDefaults = hdbIndexParser.getBaseCstVisitorConstructorWithDefaults();

/**
 * CST visitor that walks the parse tree produced by HdbIndexParser and
 * collects the local index name from the `indexName` node.
 *
 * Only the `indexName` sub-tree is visited for extraction.
 * Column identifiers inside `columnList`/`columnRef` and the table name
 * inside `tableName` are never surfaced — they are children of different
 * grammar rules and are not reachable from the `indexName` override.
 *
 * Usage:
 *   const visitor = new HdbIndexVisitor();
 *   visitor.visit(cst);
 *   return visitor.subjects;
 */
export class HdbIndexVisitor extends BaseCstVisitorWithDefaults {
    public subjects: ExtractedSubject[] = [];

    constructor() {
        super();
        // Throws at construction if a visitor method name does not correspond
        // to an actual grammar rule — catches typos early.
        this.validateVisitor();
    }

    /**
     * Called for every `indexName` node in the CST.
     *
     * The `indexName` grammar rule produces one `identifier` child for an
     * unqualified name, or two `identifier` children for a schema-qualified
     * name (`"SCHEMA"."IDX_NAME"`).  We always extract the LAST `identifier`
     * child, which is the local (post-dot) name in both forms.
     */
    indexName(ctx: CstChildrenDictionary): void {
        const identifierElements = ctx['identifier'];
        if (!identifierElements || identifierElements.length === 0) {
            return;
        }

        // Take the last identifier — it is the local index name whether or
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
        // Strip surrounding double-quotes from quoted identifiers ("MY_INDEX" → MY_INDEX).
        const name = raw.startsWith('"') ? raw.slice(1, -1) : raw;

        this.subjects.push({ type: 'indexName', name, lineNumber: tokenElement.startLine });
    }
}
