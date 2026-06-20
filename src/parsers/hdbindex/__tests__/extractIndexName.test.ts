import { describe, expect, it } from 'vitest';
import { extractIndexName } from '../index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function names(ddl: string): string[] {
    return extractIndexName(ddl)
        .filter((s) => s.type === 'indexName')
        .map((s) => s.name);
}

// ---------------------------------------------------------------------------
// AC-1  Bare INDEX syntax — unquoted name
// ---------------------------------------------------------------------------

describe('AC-1: bare INDEX syntax, unquoted name', () => {
    it('extracts the index name as an indexName subject', () => {
        const ddl = `INDEX MY_INDEX ON MY_TABLE (COL1, COL2);`;
        expect(extractIndexName(ddl)).toEqual([{ type: 'indexName', name: 'MY_INDEX', lineNumber: 1 }]);
    });

    it('handles a file without a trailing semicolon', () => {
        const ddl = `INDEX MY_INDEX ON MY_TABLE (COL1)`;
        expect(names(ddl)).toEqual(['MY_INDEX']);
    });

    it('all results carry type "indexName"', () => {
        const ddl = `INDEX MY_IDX ON T (C1)`;
        expect(extractIndexName(ddl).every((r) => r.type === 'indexName')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// AC-2  Full CREATE INDEX syntax — unquoted name
// ---------------------------------------------------------------------------

describe('AC-2: CREATE INDEX syntax, unquoted name', () => {
    it('extracts the index name from a full CREATE INDEX statement', () => {
        const ddl = `CREATE INDEX MY_INDEX ON MY_TABLE (COL1 ASC, COL2 DESC);`;
        expect(extractIndexName(ddl)).toEqual([{ type: 'indexName', name: 'MY_INDEX', lineNumber: 1 }]);
    });

    it('handles multi-line formatting', () => {
        const ddl = `CREATE INDEX\n  MY_INDEX\nON MY_TABLE\n  (COL1);`;
        expect(names(ddl)).toEqual(['MY_INDEX']);
    });
});

// ---------------------------------------------------------------------------
// AC-3  CREATE UNIQUE INDEX syntax
// ---------------------------------------------------------------------------

describe('AC-3: CREATE UNIQUE INDEX syntax', () => {
    it('extracts the index name from a CREATE UNIQUE INDEX statement', () => {
        const ddl = `CREATE UNIQUE INDEX MY_UNIQUE_INDEX ON MY_TABLE (COL1);`;
        expect(extractIndexName(ddl)).toEqual([{ type: 'indexName', name: 'MY_UNIQUE_INDEX', lineNumber: 1 }]);
    });

    it('handles UNIQUE without CREATE prefix', () => {
        const ddl = `UNIQUE INDEX MY_UNIQUE_INDEX ON MY_TABLE (COL1);`;
        expect(names(ddl)).toEqual(['MY_UNIQUE_INDEX']);
    });
});

// ---------------------------------------------------------------------------
// AC-4  Index type keyword variants consumed without error
// ---------------------------------------------------------------------------

describe('AC-4: index type keyword variants', () => {
    const cases: [string, string][] = [
        ['BTREE', `CREATE BTREE INDEX MY_IDX ON MY_TABLE (COL1);`],
        ['CPBTREE', `CREATE CPBTREE INDEX MY_IDX ON MY_TABLE (COL1);`],
        ['INVERTED HASH', `CREATE INVERTED HASH INDEX MY_IDX ON MY_TABLE (COL1);`],
        ['INVERTED VALUE', `CREATE INVERTED VALUE INDEX MY_IDX ON MY_TABLE (COL1);`],
        ['INVERTED INDIVIDUAL', `CREATE INVERTED INDIVIDUAL INDEX MY_IDX ON MY_TABLE (COL1);`]
    ];

    for (const [label, ddl] of cases) {
        it(`extracts the index name when type is ${label}`, () => {
            expect(extractIndexName(ddl)).toEqual([{ type: 'indexName', name: 'MY_IDX', lineNumber: 1 }]);
        });
    }

    it('accepts UNIQUE combined with INVERTED HASH', () => {
        const ddl = `CREATE UNIQUE INVERTED HASH INDEX MY_IDX ON MY_TABLE (COL1);`;
        expect(names(ddl)).toEqual(['MY_IDX']);
    });

    it('accepts UNIQUE combined with INVERTED VALUE', () => {
        const ddl = `CREATE UNIQUE INVERTED VALUE INDEX MY_IDX ON MY_TABLE (COL1);`;
        expect(names(ddl)).toEqual(['MY_IDX']);
    });

    it('accepts UNIQUE combined with INVERTED INDIVIDUAL', () => {
        const ddl = `CREATE UNIQUE INVERTED INDIVIDUAL INDEX MY_IDX ON MY_TABLE (COL1);`;
        expect(names(ddl)).toEqual(['MY_IDX']);
    });
});

// ---------------------------------------------------------------------------
// AC-5  Quoted identifier normalisation
// ---------------------------------------------------------------------------

describe('AC-5: quoted identifier normalisation', () => {
    it('strips double-quotes from the index name', () => {
        const ddl = `CREATE INDEX "MY_INDEX" ON "MY_TABLE" ("COL1", "COL2");`;
        expect(extractIndexName(ddl)).toEqual([{ type: 'indexName', name: 'MY_INDEX', lineNumber: 1 }]);
    });

    it('handles a mixed-quote file (quoted index name, unquoted table)', () => {
        const ddl = `CREATE INDEX "MY_INDEX" ON MY_TABLE (COL1);`;
        expect(names(ddl)).toEqual(['MY_INDEX']);
    });

    it('handles a fully unquoted file', () => {
        const ddl = `CREATE INDEX MY_INDEX ON MY_TABLE (COL1);`;
        expect(names(ddl)).toEqual(['MY_INDEX']);
    });
});

// ---------------------------------------------------------------------------
// AC-6  Schema-qualified index name — local name extracted
// ---------------------------------------------------------------------------

describe('AC-6: schema-qualified index name', () => {
    it('extracts only the local name (after the dot)', () => {
        const ddl = `CREATE INDEX "MY_SCHEMA"."MY_INDEX" ON "MY_SCHEMA"."MY_TABLE" ("COL1");`;
        expect(extractIndexName(ddl)).toEqual([{ type: 'indexName', name: 'MY_INDEX', lineNumber: 1 }]);
    });

    it('does not include the schema prefix as a subject', () => {
        const ddl = `CREATE INDEX "MY_SCHEMA"."MY_INDEX" ON "MY_TABLE" (COL1);`;
        expect(names(ddl)).not.toContain('MY_SCHEMA');
    });

    it('handles unquoted schema-qualified name', () => {
        const ddl = `CREATE INDEX MY_SCHEMA.MY_INDEX ON MY_TABLE (COL1);`;
        expect(names(ddl)).toEqual(['MY_INDEX']);
    });
});

// ---------------------------------------------------------------------------
// AC-7  Column identifiers not extracted
// ---------------------------------------------------------------------------

describe('AC-7: column identifiers not extracted', () => {
    it('does not include column names in the result', () => {
        const ddl = `CREATE INDEX MY_INDEX ON MY_TABLE (FIRST_COLUMN ASC, SECOND_COLUMN DESC);`;
        const result = extractIndexName(ddl);
        expect(result).toEqual([{ type: 'indexName', name: 'MY_INDEX', lineNumber: 1 }]);
        expect(names(ddl)).not.toContain('FIRST_COLUMN');
        expect(names(ddl)).not.toContain('SECOND_COLUMN');
    });

    it('does not include the table name in the result', () => {
        const ddl = `CREATE INDEX MY_INDEX ON MY_TABLE (COL1);`;
        expect(names(ddl)).not.toContain('MY_TABLE');
    });

    it('handles a multi-column list without extracting any column name', () => {
        const ddl = `INDEX MY_INDEX ON T (A, B, C, D);`;
        expect(names(ddl)).toEqual(['MY_INDEX']);
    });
});

// ---------------------------------------------------------------------------
// AC-8  Block comment exclusion
// ---------------------------------------------------------------------------

describe('AC-8: block comment exclusion', () => {
    it('does not extract an index name wrapped in a block comment', () => {
        const ddl = `
            /* CREATE INDEX OLD_INDEX ON MY_TABLE (COL1); */
            CREATE INDEX MY_INDEX ON MY_TABLE (COL1);
        `;
        expect(names(ddl)).not.toContain('OLD_INDEX');
        expect(names(ddl)).toContain('MY_INDEX');
    });

    it('handles a block comment spanning multiple lines before the real statement', () => {
        const ddl = `
            /*
              CREATE INDEX COMMENTED_INDEX ON MY_TABLE (COL1);
            */
            INDEX MY_INDEX ON MY_TABLE (COL1);
        `;
        expect(names(ddl)).not.toContain('COMMENTED_INDEX');
        expect(names(ddl)).toEqual(['MY_INDEX']);
    });
});

// ---------------------------------------------------------------------------
// AC-9  Line comment exclusion
// ---------------------------------------------------------------------------

describe('AC-9: line comment exclusion', () => {
    it('does not extract an index name on a -- comment line', () => {
        const ddl = `
            -- CREATE INDEX OLD_INDEX ON MY_TABLE (COL1);
            CREATE INDEX MY_INDEX ON MY_TABLE (COL1);
        `;
        expect(names(ddl)).not.toContain('OLD_INDEX');
        expect(names(ddl)).toContain('MY_INDEX');
    });

    it('ignores a -- comment after the statement', () => {
        const ddl = `CREATE INDEX MY_INDEX ON MY_TABLE (COL1); -- production index`;
        expect(names(ddl)).toEqual(['MY_INDEX']);
    });
});

// ---------------------------------------------------------------------------
// AC-10  Optional semicolon
// ---------------------------------------------------------------------------

describe('AC-10: optional semicolon', () => {
    it('produces the same result with and without a trailing semicolon', () => {
        const withSemicolon = `CREATE INDEX MY_INDEX ON MY_TABLE (COL1);`;
        const withoutSemicolon = `CREATE INDEX MY_INDEX ON MY_TABLE (COL1)`;
        expect(names(withSemicolon)).toEqual(names(withoutSemicolon));
    });
});

// ---------------------------------------------------------------------------
// AC-11  Graceful error on unparseable file
// ---------------------------------------------------------------------------

describe('AC-11: graceful error handling', () => {
    it('does not throw on completely invalid input', () => {
        expect(() => extractIndexName('THIS IS NOT VALID DDL !!!')).not.toThrow();
    });

    it('does not throw on an empty string', () => {
        expect(() => extractIndexName('')).not.toThrow();
        expect(extractIndexName('')).toEqual([]);
    });

    it('does not throw when INDEX keyword is missing', () => {
        expect(() => extractIndexName('CREATE MY_INDEX ON MY_TABLE (COL1)')).not.toThrow();
    });

    it('handles CRLF line endings', () => {
        const ddl = 'CREATE INDEX MY_INDEX ON MY_TABLE (COL1);\r\n';
        expect(names(ddl)).toEqual(['MY_INDEX']);
    });
});
