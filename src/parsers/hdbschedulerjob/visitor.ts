import type { CstChildrenDictionary, IToken } from 'chevrotain';
import type { ExtractedSubject } from '../../types/issues';
import { hdbSchedulerJobParser } from './parser';

const BaseCstVisitorWithDefaults = hdbSchedulerJobParser.getBaseCstVisitorConstructorWithDefaults();

/**
 * CST visitor that walks the parse tree produced by HdbSchedulerJobParser and
 * collects the job action name from the `actionMember` node.
 *
 * Only the `actionMember` sub-tree is overridden for extraction. All other
 * grammar nodes are traversed by the default base-class implementation
 * (BaseCstVisitorWithDefaults), which auto-visits child nodes but produces
 * no output. This is safe because the `JsonString` tokens in all other member
 * rules are never children of an `actionMember` CST node.
 *
 * Usage:
 *   const visitor = new HdbSchedulerJobVisitor();
 *   visitor.visit(cst);
 *   return visitor.subjects;
 */
export class HdbSchedulerJobVisitor extends BaseCstVisitorWithDefaults {
    public subjects: ExtractedSubject[] = [];

    constructor() {
        super();
        // Throws at construction if a visitor method name does not correspond
        // to an actual grammar rule — catches typos early.
        this.validateVisitor();
    }

    /**
     * Called for every `actionMember` node in the CST.
     *
     * The `actionMember` grammar rule produces one `JsonString` child token
     * which is the value of the `"action"` key. The surrounding double-quotes
     * are stripped to produce the final action name.
     *
     * Examples:
     *   Token image: '"com.example::runJob"'  → name: 'com.example::runJob'
     *   Token image: '"MY_PROCEDURE"'         → name: 'MY_PROCEDURE'
     */
    actionMember(ctx: CstChildrenDictionary): void {
        const token = ctx['JsonString']?.[0] as IToken | undefined;
        if (!token) {
            return;
        }

        const raw = token.image;
        // Strip the surrounding double-quotes from the JSON string value.
        // No inner JSON escape unescaping is performed — the raw content
        // between the outer quotes is preserved as-is.
        const name = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;

        this.subjects.push({ type: 'jobAction', name, lineNumber: token.startLine });
    }
}
