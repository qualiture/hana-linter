import { CstParser, type TokenType } from 'chevrotain';
import {
    allTokens,
    Alter,
    Any,
    Application,
    Catalog,
    Colon,
    ColonColon,
    Comma,
    Create,
    Debug,
    Delete,
    Dot,
    Drop,
    Execute,
    Extends,
    Identifier,
    IndexKw,
    Insert,
    LBrace,
    LParen,
    Object,
    Package,
    Privilege,
    QuotedIdentifier,
    RBrace,
    References,
    RoleKw,
    Roles,
    RParen,
    Schema,
    Select,
    Semicolon,
    Sql,
    Trigger,
    Update
} from './lexer';

/**
 * Chevrotain CstParser for HANA `.hdbrole` DSL files (XS Classic format).
 *
 * Grammar covers:
 *  - ROLE <roleName> [EXTENDS ROLES { <grantedRoleList> }] { <privilegeClause>* }
 *  - roleName / grantedRoleName: plain identifier, quoted identifier, or
 *    fully package-qualified name (e.g. com.example.app::AdminRole)
 *  - privilegeClause: catalog schema / catalog sql object / catalog package /
 *    application privilege — all consumed but NEVER extracted
 *
 * Only `roleName` and `grantedRoleName` CST nodes are surfaced by the visitor.
 * All privilege clause subtrees are blocked from extraction by no-op overrides.
 *
 * Error recovery is enabled by default in CstParser.
 */
export class HdbRoleParser extends CstParser {
    constructor() {
        super(allTokens);
        this.performSelfAnalysis();
    }

    // -----------------------------------------------------------------------
    // Top-level rule
    // -----------------------------------------------------------------------

    public roleDefinition = this.RULE('roleDefinition', () => {
        this.CONSUME(RoleKw);
        this.SUBRULE(this.roleName);
        this.OPTION(() => {
            this.CONSUME(Extends);
            this.CONSUME(Roles);
            this.CONSUME(LBrace);
            this.SUBRULE(this.grantedRoleList);
            this.CONSUME(RBrace);
        });
        this.CONSUME2(LBrace);
        this.MANY(() => this.SUBRULE(this.privilegeClause));
        this.CONSUME2(RBrace);
        this.OPTION2(() => this.CONSUME(Semicolon));
    });

    // -----------------------------------------------------------------------
    // Role name: unquoted (optionally package-qualified) or quoted.
    //
    // Branch 1 — unquoted start:
    //   Identifier (Dot Identifier)* (ColonColon (Identifier | QuotedIdentifier))?
    //   e.g. AdminRole  /  com.example.app::AdminRole
    //
    // Branch 2 — leading quoted identifier:
    //   QuotedIdentifier
    //   e.g. "AdminRole"
    //
    // FIRST sets are disjoint (Identifier vs QuotedIdentifier) — LL(1).
    // The MANY loop stops automatically at the follow set of roleName:
    //   {Extends, LBrace} — neither of which is Dot.
    // -----------------------------------------------------------------------

    public roleName = this.RULE('roleName', () => {
        this.OR([
            {
                ALT: () => {
                    this.CONSUME1(Identifier);
                    this.MANY(() => {
                        this.CONSUME1(Dot);
                        this.CONSUME2(Identifier);
                    });
                    this.OPTION(() => {
                        this.CONSUME(ColonColon);
                        this.OR2([{ ALT: () => this.CONSUME3(Identifier) }, { ALT: () => this.CONSUME1(QuotedIdentifier) }]);
                    });
                }
            },
            {
                ALT: () => this.CONSUME2(QuotedIdentifier)
            }
        ]);
    });

    // -----------------------------------------------------------------------
    // Granted role list: one or more grantedRoleName entries separated by commas.
    // -----------------------------------------------------------------------

    public grantedRoleList = this.RULE('grantedRoleList', () => {
        this.SUBRULE(this.grantedRoleName);
        this.MANY(() => {
            this.CONSUME(Comma);
            this.SUBRULE2(this.grantedRoleName);
        });
    });

    // -----------------------------------------------------------------------
    // Granted role name — identical structure to roleName.
    //
    // Declared as a separate rule so the visitor can produce 'grantedRoleName'
    // subjects without needing context about whether we are inside the
    // extends block or at the top level.
    //
    // The MANY loop stops at the follow set of grantedRoleName:
    //   {Comma, RBrace} — neither of which is Dot.
    // -----------------------------------------------------------------------

    public grantedRoleName = this.RULE('grantedRoleName', () => {
        this.OR([
            {
                ALT: () => {
                    this.CONSUME1(Identifier);
                    this.MANY(() => {
                        this.CONSUME1(Dot);
                        this.CONSUME2(Identifier);
                    });
                    this.OPTION(() => {
                        this.CONSUME(ColonColon);
                        this.OR2([{ ALT: () => this.CONSUME3(Identifier) }, { ALT: () => this.CONSUME1(QuotedIdentifier) }]);
                    });
                }
            },
            {
                ALT: () => this.CONSUME2(QuotedIdentifier)
            }
        ]);
    });

    // -----------------------------------------------------------------------
    // Privilege clause — dispatches to one of four typed alternatives.
    //
    // Disambiguation (all alternatives start with either Catalog or Application):
    //   Application                → applicationPrivilege       (LL-1)
    //   Catalog + Schema           → catalogSchemaPrivilege     (LL-2)
    //   Catalog + Sql              → catalogObjectPrivilege     (LL-2)
    //   Catalog + Package          → catalogPackagePrivilege    (LL-2)
    // -----------------------------------------------------------------------

    public privilegeClause = this.RULE('privilegeClause', () => {
        this.OR([
            { ALT: () => this.SUBRULE(this.applicationPrivilege) },
            { ALT: () => this.SUBRULE(this.catalogSchemaPrivilege) },
            { ALT: () => this.SUBRULE(this.catalogObjectPrivilege) },
            { ALT: () => this.SUBRULE(this.catalogPackagePrivilege) }
        ]);
    });

    // -----------------------------------------------------------------------
    // catalog schema "<schema>": <privilegeList> [;]
    // -----------------------------------------------------------------------

    public catalogSchemaPrivilege = this.RULE('catalogSchemaPrivilege', () => {
        this.CONSUME(Catalog);
        this.CONSUME(Schema);
        this.SUBRULE(this.quotedOrUnquotedIdentifier);
        this.CONSUME(Colon);
        this.SUBRULE(this.privilegeList);
        this.OPTION(() => this.CONSUME(Semicolon));
    });

    // -----------------------------------------------------------------------
    // catalog sql object "<schema>"."<object>": <privilegeList> [;]
    // -----------------------------------------------------------------------

    public catalogObjectPrivilege = this.RULE('catalogObjectPrivilege', () => {
        this.CONSUME(Catalog);
        this.CONSUME(Sql);
        this.CONSUME(Object);
        this.SUBRULE(this.quotedOrUnquotedIdentifier);
        this.CONSUME(Dot);
        this.SUBRULE2(this.quotedOrUnquotedIdentifier);
        this.CONSUME(Colon);
        this.SUBRULE(this.privilegeList);
        this.OPTION(() => this.CONSUME(Semicolon));
    });

    // -----------------------------------------------------------------------
    // catalog package "<package>": <privilegeList> [;]
    // -----------------------------------------------------------------------

    public catalogPackagePrivilege = this.RULE('catalogPackagePrivilege', () => {
        this.CONSUME(Catalog);
        this.CONSUME(Package);
        this.SUBRULE(this.quotedOrUnquotedIdentifier);
        this.CONSUME(Colon);
        this.SUBRULE(this.privilegeList);
        this.OPTION(() => this.CONSUME(Semicolon));
    });

    // -----------------------------------------------------------------------
    // application privilege: <privilegeName> [;]
    //
    // The application privilege name may itself be a package-qualified
    // identifier (e.g. com.example.app::EditData) consumed by
    // applicationPrivilegeName — but NOT extracted by the visitor.
    // -----------------------------------------------------------------------

    public applicationPrivilege = this.RULE('applicationPrivilege', () => {
        this.CONSUME(Application);
        this.CONSUME(Privilege);
        this.CONSUME(Colon);
        this.SUBRULE(this.applicationPrivilegeName);
        this.OPTION(() => this.CONSUME(Semicolon));
    });

    // -----------------------------------------------------------------------
    // Application privilege name — same shape as roleName; consumed but
    // never extracted (visitor provides a no-op override for applicationPrivilege).
    // -----------------------------------------------------------------------

    public applicationPrivilegeName = this.RULE('applicationPrivilegeName', () => {
        this.OR([
            {
                ALT: () => {
                    this.CONSUME1(Identifier);
                    this.MANY(() => {
                        this.CONSUME1(Dot);
                        this.CONSUME2(Identifier);
                    });
                    this.OPTION(() => {
                        this.CONSUME(ColonColon);
                        this.OR2([{ ALT: () => this.CONSUME3(Identifier) }, { ALT: () => this.CONSUME1(QuotedIdentifier) }]);
                    });
                }
            },
            {
                ALT: () => this.CONSUME2(QuotedIdentifier)
            }
        ]);
    });

    // -----------------------------------------------------------------------
    // Privilege list: one or more privilege keyword tokens, comma-separated.
    // -----------------------------------------------------------------------

    public privilegeList = this.RULE('privilegeList', () => {
        this.SUBRULE(this.privilegeKeyword);
        this.MANY(() => {
            this.CONSUME(Comma);
            this.SUBRULE2(this.privilegeKeyword);
        });
    });

    // -----------------------------------------------------------------------
    // Privilege keyword — any SQL privilege type.
    // -----------------------------------------------------------------------

    public privilegeKeyword = this.RULE('privilegeKeyword', () => {
        this.OR([
            { ALT: () => this.CONSUME(Select) },
            { ALT: () => this.CONSUME(Insert) },
            { ALT: () => this.CONSUME(Update) },
            { ALT: () => this.CONSUME(Delete) },
            { ALT: () => this.CONSUME(Execute) },
            { ALT: () => this.CONSUME(Create) },
            { ALT: () => this.CONSUME(Alter) },
            { ALT: () => this.CONSUME(Drop) },
            { ALT: () => this.CONSUME(IndexKw) },
            { ALT: () => this.CONSUME(Trigger) },
            { ALT: () => this.CONSUME(References) },
            { ALT: () => this.CONSUME(Debug) },
            { ALT: () => this.CONSUME(Any) }
        ]);
    });

    // -----------------------------------------------------------------------
    // Quoted-or-unquoted identifier helper — used in privilege clauses.
    // -----------------------------------------------------------------------

    public quotedOrUnquotedIdentifier = this.RULE('quotedOrUnquotedIdentifier', () => {
        this.OR([{ ALT: () => this.CONSUME(QuotedIdentifier) }, { ALT: () => this.CONSUME(Identifier) }]);
    });
}

/**
 * Singleton parser instance — instantiated once at module load time per
 * Chevrotain best practices (NFR-3).
 */
export const hdbRoleParser = new HdbRoleParser();
