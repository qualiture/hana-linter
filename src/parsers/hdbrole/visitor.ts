import type { CstChildrenDictionary, IToken } from 'chevrotain';
import type { ExtractedSubject } from '../../types/issues';
import { hdbRoleParser } from './parser';

const BaseCstVisitorWithDefaults = hdbRoleParser.getBaseCstVisitorConstructorWithDefaults();

/**
 * CST visitor that walks the parse tree produced by HdbRoleParser and
 * collects role name subjects.
 *
 * Subject type mapping:
 *  - `role <name> { ... }`             → { type: 'roleName',        name }
 *  - `extends roles { <name>, ... }`   → { type: 'grantedRoleName', name }
 *
 * Blocked subtrees (visitor no-ops prevent extraction from):
 *  - catalogSchemaPrivilege   — schema name and privilege keywords
 *  - catalogObjectPrivilege   — schema/object names and privilege keywords
 *  - catalogPackagePrivilege  — package name and privilege keywords
 *  - applicationPrivilege     — application privilege name
 *
 * Both simple identifiers (AdminRole) and fully package-qualified names
 * (com.example.app::AdminRole) are reconstructed as a single string by
 * sorting all consumed tokens by their startOffset.
 *
 * Usage:
 *   const visitor = new HdbRoleNameVisitor();
 *   visitor.visit(cst);
 *   return visitor.subjects;
 */
export class HdbRoleNameVisitor extends BaseCstVisitorWithDefaults {
    public subjects: ExtractedSubject[] = [];

    constructor() {
        super();
        // Throws at construction if a visitor method name doesn't correspond
        // to an actual grammar rule — catches typos early.
        this.validateVisitor();
    }

    // -----------------------------------------------------------------------
    // roleName — primary extraction point for the role being defined.
    //
    // Called once by BaseCstVisitorWithDefaults auto-traversal when the
    // visitor reaches the `roleName` CST node inside `roleDefinition`.
    // -----------------------------------------------------------------------

    roleName(ctx: CstChildrenDictionary): void {
        const name = this.reconstructRoleName(ctx);
        if (name) {
            const lineNumber = this.extractLineNumber(ctx);
            this.subjects.push({ type: 'roleName', name, lineNumber });
        }
    }

    // -----------------------------------------------------------------------
    // grantedRoleName — extraction point for each inherited role.
    //
    // Called once per grantedRoleName node during auto-traversal of the
    // grantedRoleList inside the extends block.
    // -----------------------------------------------------------------------

    grantedRoleName(ctx: CstChildrenDictionary): void {
        const name = this.reconstructRoleName(ctx);
        if (name) {
            const lineNumber = this.extractLineNumber(ctx);
            this.subjects.push({ type: 'grantedRoleName', name, lineNumber });
        }
    }

    // -----------------------------------------------------------------------
    // Privilege clause no-ops.
    //
    // BaseCstVisitorWithDefaults auto-visits all child CST nodes for any rule
    // method not explicitly overridden.  These no-ops prevent the traversal
    // from descending into any privilege clause subtree, ensuring that schema
    // names, object names, package names, and application privilege names
    // are never pushed to this.subjects.
    // -----------------------------------------------------------------------

    catalogSchemaPrivilege(_ctx: CstChildrenDictionary): void {
        // Intentionally empty — privilege body is not extracted.
    }

    catalogObjectPrivilege(_ctx: CstChildrenDictionary): void {
        // Intentionally empty — privilege body is not extracted.
    }

    catalogPackagePrivilege(_ctx: CstChildrenDictionary): void {
        // Intentionally empty — privilege body is not extracted.
    }

    applicationPrivilege(_ctx: CstChildrenDictionary): void {
        // Intentionally empty — privilege body is not extracted.
    }

    // -----------------------------------------------------------------------
    // Private helper: reconstruct the full role name string from a roleName
    // or grantedRoleName CST node's children dictionary.
    //
    // The rule may produce:
    //   ctx['Identifier']       — all unquoted identifier tokens
    //   ctx['QuotedIdentifier'] — quoted identifier token(s)
    //   ctx['ColonColon']       — the '::' separator token (if qualified)
    //   ctx['Dot']              — '.' separator tokens (package path segments)
    //
    // To reconstruct the correct order for qualified names, all tokens are
    // collected with their startOffset, sorted ascending, and joined.
    //
    // Examples:
    //   "AdminRole"               → plain quoted   → strip quotes → "AdminRole"
    //   AdminRole                 → plain unquoted → "AdminRole"
    //   com.example.app::AdminRole → qualified    → "com.example.app::AdminRole"
    // -----------------------------------------------------------------------

    private reconstructRoleName(ctx: CstChildrenDictionary): string {
        const identifiers = (ctx['Identifier'] as IToken[] | undefined) ?? [];
        const quotedIdents = (ctx['QuotedIdentifier'] as IToken[] | undefined) ?? [];
        const colonColons = (ctx['ColonColon'] as IToken[] | undefined) ?? [];
        const dots = (ctx['Dot'] as IToken[] | undefined) ?? [];

        // Branch 2: plain quoted name, e.g. "AdminRole"
        if (quotedIdents.length > 0 && identifiers.length === 0 && colonColons.length === 0) {
            const raw = quotedIdents[0]!.image;
            return raw.startsWith('"') ? raw.slice(1, -1) : raw;
        }

        // No tokens at all (error recovery may produce an empty node)
        if (identifiers.length === 0) return '';

        // Branch 1a: plain unquoted name, e.g. AdminRole
        if (colonColons.length === 0 && dots.length === 0) {
            return identifiers[0]!.image;
        }

        // Branch 1b: package-qualified name, e.g. com.example.app::AdminRole
        // Sort all participating tokens by startOffset and join their images.
        const parts: Array<{ offset: number; image: string }> = [
            ...identifiers.map((t) => ({ offset: t.startOffset, image: t.image })),
            ...quotedIdents.map((t) => ({
                offset: t.startOffset,
                image: t.image.startsWith('"') ? t.image.slice(1, -1) : t.image
            })),
            ...colonColons.map((t) => ({ offset: t.startOffset, image: '::' })),
            ...dots.map((t) => ({ offset: t.startOffset, image: '.' }))
        ];
        parts.sort((a, b) => a.offset - b.offset);
        return parts.map((p) => p.image).join('');
    }

    // -----------------------------------------------------------------------
    // Private helper: extract the start line from the first token in the node.
    // -----------------------------------------------------------------------

    private extractLineNumber(ctx: CstChildrenDictionary): number | undefined {
        const identifiers = (ctx['Identifier'] as IToken[] | undefined) ?? [];
        const quotedIdents = (ctx['QuotedIdentifier'] as IToken[] | undefined) ?? [];

        const firstToken = identifiers[0] ?? quotedIdents[0];
        return firstToken?.startLine ?? undefined;
    }
}
