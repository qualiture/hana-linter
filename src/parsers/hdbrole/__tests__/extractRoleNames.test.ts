import { describe, it, expect } from 'vitest';
import { extractRoleNames } from '../index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function names(dsl: string): string[] {
    return extractRoleNames(dsl).map((s) => s.name);
}

function types(dsl: string): string[] {
    return extractRoleNames(dsl).map((s) => s.type);
}

// ---------------------------------------------------------------------------
// AC-1  Unqualified role name extraction
// ---------------------------------------------------------------------------

describe('AC-1: unqualified role name extraction', () => {
    it('extracts a plain unqualified role name', () => {
        const dsl = `role AdminRole { }`;
        expect(extractRoleNames(dsl)).toEqual([{ type: 'roleName', name: 'AdminRole', lineNumber: 1 }]);
    });

    it('result has type "roleName"', () => {
        expect(types(`role AdminRole { }`)).toEqual(['roleName']);
    });

    it('all results carry the roleName type', () => {
        const dsl = `role AdminRole { }`;
        expect(extractRoleNames(dsl).every((r) => r.type === 'roleName')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// AC-2  Fully-qualified role name extraction
// ---------------------------------------------------------------------------

describe('AC-2: fully-qualified role name extraction', () => {
    it('extracts a package-qualified role name as a single string', () => {
        const dsl = `role com.example.app::AdminRole { }`;
        expect(extractRoleNames(dsl)).toEqual([{ type: 'roleName', name: 'com.example.app::AdminRole', lineNumber: 1 }]);
    });

    it('preserves the full qualified form including package path and :: separator', () => {
        expect(names(`role com.example.app::AdminRole { }`)).toContain('com.example.app::AdminRole');
    });

    it('handles deep package paths', () => {
        const dsl = `role sap.hana.xs.example::MyRole { }`;
        expect(names(dsl)).toEqual(['sap.hana.xs.example::MyRole']);
    });
});

// ---------------------------------------------------------------------------
// AC-3  Quoted role name normalisation
// ---------------------------------------------------------------------------

describe('AC-3: quoted role name normalisation', () => {
    it('strips double-quotes from a quoted role name', () => {
        const dsl = `role "AdminRole" { }`;
        expect(extractRoleNames(dsl)).toEqual([{ type: 'roleName', name: 'AdminRole', lineNumber: 1 }]);
    });

    it('extracts the name without quotes', () => {
        expect(names(`role "AdminRole" { }`)).toEqual(['AdminRole']);
    });
});

// ---------------------------------------------------------------------------
// AC-4  Single granted role extraction
// ---------------------------------------------------------------------------

describe('AC-4: single granted role extraction', () => {
    it('extracts the defined role and one granted role', () => {
        const dsl = `
            role com.example.app::AdminRole
                extends roles { com.example.app::BaseRole }
            { }
        `;
        const result = extractRoleNames(dsl);
        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({ type: 'roleName', name: 'com.example.app::AdminRole' });
        expect(result[1]).toMatchObject({ type: 'grantedRoleName', name: 'com.example.app::BaseRole' });
    });

    it('granted role has type "grantedRoleName"', () => {
        const dsl = `
            role com.example.app::AdminRole
                extends roles { com.example.app::BaseRole }
            { }
        `;
        expect(types(dsl)).toEqual(['roleName', 'grantedRoleName']);
    });
});

// ---------------------------------------------------------------------------
// AC-5  Multiple granted roles extraction
// ---------------------------------------------------------------------------

describe('AC-5: multiple granted roles extraction', () => {
    it('extracts one roleName and two grantedRoleName subjects', () => {
        const dsl = `
            role com.example.app::AdminRole
                extends roles {
                    com.example.app::BaseRole,
                    com.example.app::AuditRole
                }
            { }
        `;
        const result = extractRoleNames(dsl);
        expect(result).toHaveLength(3);
        expect(result[0]).toMatchObject({ type: 'roleName', name: 'com.example.app::AdminRole' });
        expect(result[1]).toMatchObject({ type: 'grantedRoleName', name: 'com.example.app::BaseRole' });
        expect(result[2]).toMatchObject({ type: 'grantedRoleName', name: 'com.example.app::AuditRole' });
    });

    it('produces exactly one roleName and multiple grantedRoleName entries', () => {
        const dsl = `
            role AdminRole
                extends roles { RoleA, RoleB, RoleC }
            { }
        `;
        const result = extractRoleNames(dsl);
        expect(result.filter((s) => s.type === 'roleName')).toHaveLength(1);
        expect(result.filter((s) => s.type === 'grantedRoleName')).toHaveLength(3);
    });
});

// ---------------------------------------------------------------------------
// AC-6  No extends block yields no grantedRoleName subjects
// ---------------------------------------------------------------------------

describe('AC-6: no extends block yields no grantedRoleName subjects', () => {
    it('returns exactly one roleName subject when no extends block is present', () => {
        const dsl = `role AdminRole { catalog schema "MY_SCHEMA": SELECT; }`;
        const result = extractRoleNames(dsl);
        expect(result).toHaveLength(1);
        expect(result[0]?.type).toBe('roleName');
    });

    it('returns zero grantedRoleName subjects', () => {
        const dsl = `role com.example.app::AdminRole { }`;
        expect(extractRoleNames(dsl).filter((s) => s.type === 'grantedRoleName')).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// AC-7  Privilege clauses are not extracted
// ---------------------------------------------------------------------------

describe('AC-7: privilege clause content is not extracted', () => {
    it('does not extract schema names from catalog schema clauses', () => {
        const dsl = `
            role com.example.app::AdminRole {
                catalog schema "MY_SCHEMA": SELECT, INSERT, UPDATE, DELETE;
            }
        `;
        expect(names(dsl)).not.toContain('MY_SCHEMA');
        expect(names(dsl)).not.toContain('SELECT');
        expect(names(dsl)).not.toContain('INSERT');
    });

    it('does not extract object names from catalog sql object clauses', () => {
        const dsl = `
            role AdminRole {
                catalog sql object "MY_SCHEMA"."MY_TABLE": SELECT;
            }
        `;
        expect(names(dsl)).not.toContain('MY_TABLE');
        expect(names(dsl)).not.toContain('MY_SCHEMA');
    });

    it('does not extract package names from catalog package clauses', () => {
        const dsl = `
            role AdminRole {
                catalog package "com.example.app": EXECUTE;
            }
        `;
        expect(names(dsl)).not.toContain('com.example.app');
        expect(names(dsl)).not.toContain('EXECUTE');
    });

    it('does not extract application privilege names', () => {
        const dsl = `
            role com.example.app::AdminRole {
                application privilege: com.example.app::EditData;
            }
        `;
        expect(names(dsl)).not.toContain('com.example.app::EditData');
        expect(names(dsl)).not.toContain('EditData');
    });

    it('only contains the role name when a file has multiple privilege clauses', () => {
        const dsl = `
            role com.example.app::AdminRole {
                catalog schema "MY_SCHEMA": SELECT, INSERT, UPDATE, DELETE;
                catalog sql object "MY_SCHEMA"."MY_TABLE": SELECT;
                catalog package "com.example.app": EXECUTE;
                application privilege: com.example.app::EditData;
            }
        `;
        expect(names(dsl)).toEqual(['com.example.app::AdminRole']);
    });
});

// ---------------------------------------------------------------------------
// AC-8  Block comment exclusion
// ---------------------------------------------------------------------------

describe('AC-8: block comment exclusion', () => {
    it('does not extract a granted role wrapped in /* … */', () => {
        const dsl = `
            role com.example.app::AdminRole
                extends roles {
                    com.example.app::BaseRole
                    /* , com.example.app::OldRole */
                }
            { }
        `;
        expect(names(dsl)).not.toContain('com.example.app::OldRole');
        expect(names(dsl)).toContain('com.example.app::BaseRole');
    });

    it('still extracts roles outside block comments', () => {
        const dsl = `
            role AdminRole
                extends roles {
                    /* GhostRole, */
                    RealRole
                }
            { }
        `;
        expect(names(dsl)).not.toContain('GhostRole');
        expect(names(dsl)).toContain('RealRole');
    });
});

// ---------------------------------------------------------------------------
// AC-9  Line comment exclusion
// ---------------------------------------------------------------------------

describe('AC-9: line comment exclusion', () => {
    it('does not extract a granted role appearing only in a -- comment', () => {
        const dsl = `
            role com.example.app::AdminRole
                extends roles {
                    com.example.app::BaseRole
                    -- , com.example.app::OldRole
                }
            { }
        `;
        expect(names(dsl)).not.toContain('com.example.app::OldRole');
    });

    it('does not extract a role name from a commented-out privilege clause', () => {
        const dsl = `
            role AdminRole {
                -- catalog schema "GHOST_SCHEMA": SELECT;
            }
        `;
        expect(names(dsl)).not.toContain('GHOST_SCHEMA');
    });
});

// ---------------------------------------------------------------------------
// AC-10  Fully-qualified granted role name preserved
// ---------------------------------------------------------------------------

describe('AC-10: fully-qualified granted role name preserved', () => {
    it('preserves the full package path and :: in grantedRoleName', () => {
        const dsl = `
            role AdminRole
                extends roles { com.sap.security::BaseRole }
            { }
        `;
        expect(extractRoleNames(dsl)).toContainEqual(expect.objectContaining({ type: 'grantedRoleName', name: 'com.sap.security::BaseRole' }));
    });

    it('preserves the full qualified form for multiple granted roles', () => {
        const dsl = `
            role AdminRole
                extends roles {
                    com.sap.security::BaseRole,
                    com.sap.audit::AuditRole
                }
            { }
        `;
        expect(names(dsl)).toContain('com.sap.security::BaseRole');
        expect(names(dsl)).toContain('com.sap.audit::AuditRole');
    });
});

// ---------------------------------------------------------------------------
// AC-11  Graceful error handling
// ---------------------------------------------------------------------------

describe('AC-11: graceful error handling', () => {
    it('does not throw on completely invalid content', () => {
        expect(() => extractRoleNames('@@@ not valid hdbrole')).not.toThrow();
    });

    it('returns an empty array for empty input', () => {
        expect(extractRoleNames('')).toEqual([]);
    });

    it('does not throw on a partial role definition missing the closing brace', () => {
        const dsl = `role com.example.app::AdminRole {`;
        expect(() => extractRoleNames(dsl)).not.toThrow();
    });

    it('returns partial results (or empty) when input contains illegal characters', () => {
        const dsl = `role com.example.app::AdminRole { @@@ BROKEN `;
        expect(() => extractRoleNames(dsl)).not.toThrow();
        // Result is an array — partial recovery is best-effort
        expect(Array.isArray(extractRoleNames(dsl))).toBe(true);
    });

    it('does not throw on input with valid tokens but broken structure', () => {
        const dsl = `role com.example.app::AdminRole { UNKNOWN_TOKEN }`;
        expect(() => extractRoleNames(dsl)).not.toThrow();
        expect(Array.isArray(extractRoleNames(dsl))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// AC-12 / AC-13  All subjects carry correct types
// ---------------------------------------------------------------------------

describe('AC-12/AC-13: all extracted subjects carry the correct type', () => {
    it('all subjects from a role-with-extends file have one of the two role types', () => {
        const dsl = `
            role com.example.app::AdminRole
                extends roles { com.example.app::BaseRole }
            { }
        `;
        const result = extractRoleNames(dsl);
        expect(result.every((s) => s.type === 'roleName' || s.type === 'grantedRoleName')).toBe(true);
    });

    it('first subject is always roleName when present', () => {
        const dsl = `
            role AdminRole
                extends roles { BaseRole }
            { }
        `;
        const result = extractRoleNames(dsl);
        expect(result[0]?.type).toBe('roleName');
    });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
    it('handles CRLF line endings', () => {
        const dsl = `role com.example.app::AdminRole\r\n    extends roles { com.example.app::BaseRole }\r\n{ }`;
        const result = extractRoleNames(dsl);
        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({ type: 'roleName', name: 'com.example.app::AdminRole' });
        expect(result[1]).toMatchObject({ type: 'grantedRoleName', name: 'com.example.app::BaseRole' });
    });

    it('handles a role with no privileges and no extends block', () => {
        const dsl = `role EmptyRole { }`;
        expect(extractRoleNames(dsl)).toEqual([{ type: 'roleName', name: 'EmptyRole', lineNumber: 1 }]);
    });

    it('handles a role with a trailing semicolon', () => {
        const dsl = `role AdminRole { };`;
        expect(names(dsl)).toEqual(['AdminRole']);
    });

    it('handles keywords as part of an identifier-like role name', () => {
        // Role name "SELECTROLE" starts with the keyword SELECT
        const dsl = `role SELECTROLE { }`;
        expect(names(dsl)).toEqual(['SELECTROLE']);
    });

    it('handles a single-segment role name that is a partial keyword prefix', () => {
        // CATALOG alone is a keyword but CATALOGROLE should be an identifier
        const dsl = `role CATALOGROLE { }`;
        expect(names(dsl)).toEqual(['CATALOGROLE']);
    });
});
