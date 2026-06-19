import { describe, expect, it } from 'vitest';
import { extractViewColumns } from '../index';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function names(ddl: string): string[] {
    return extractViewColumns(ddl).map((s) => s.name);
}

// ---------------------------------------------------------------------------
// AC-1  Explicit column list extraction
// ---------------------------------------------------------------------------

describe('AC-1: explicit column list extraction', () => {
    it('extracts column names from the explicit list, not from SELECT aliases', () => {
        const ddl = `VIEW V_FOO ("ID", "NAME") AS SELECT T."CUST_ID", T."CUST_NAME" FROM T`;
        expect(names(ddl)).toEqual(['ID', 'NAME']);
    });

    it('does not include SELECT source columns when an explicit list is present', () => {
        const ddl = `VIEW V_FOO ("ID", "NAME") AS SELECT T."CUST_ID", T."CUST_NAME" FROM T`;
        expect(names(ddl)).not.toContain('CUST_ID');
        expect(names(ddl)).not.toContain('CUST_NAME');
    });

    it('all results carry type "field"', () => {
        const ddl = `VIEW V ("COL_A", "COL_B") AS SELECT T.A, T.B FROM T`;
        expect(extractViewColumns(ddl).every((r) => r.type === 'field')).toBe(true);
    });

    it('handles unquoted identifiers in explicit column list', () => {
        const ddl = `VIEW V (ID, NAME) AS SELECT T.A, T.B FROM T`;
        expect(names(ddl)).toEqual(['ID', 'NAME']);
    });

    it('handles a schema-qualified view name with an explicit column list', () => {
        const ddl = `VIEW "SCHEMA"."V_FOO" ("ID") AS SELECT T.A FROM T`;
        expect(names(ddl)).toEqual(['ID']);
    });
});

// ---------------------------------------------------------------------------
// AC-2  SELECT alias extraction (no explicit column list)
// ---------------------------------------------------------------------------

describe('AC-2: SELECT alias extraction (no explicit column list)', () => {
    it('extracts AS aliases from the top-level SELECT clause', () => {
        const ddl = `VIEW V_BAR AS SELECT T."CUST_ID" AS "ID", T."CUST_NAME" AS "NAME" FROM T`;
        expect(extractViewColumns(ddl)).toEqual([
            { type: 'field', name: 'ID', lineNumber: 1 },
            { type: 'field', name: 'NAME', lineNumber: 1 }
        ]);
    });

    it('handles unquoted alias names', () => {
        const ddl = `VIEW V AS SELECT T.X AS MY_COL FROM T`;
        expect(names(ddl)).toEqual(['MY_COL']);
    });

    it('all results carry type "field"', () => {
        const ddl = `VIEW V AS SELECT T.X AS "A", T.Y AS "B" FROM T`;
        expect(extractViewColumns(ddl).every((r) => r.type === 'field')).toBe(true);
    });

    it('handles CREATE VIEW prefix', () => {
        const ddl = `CREATE VIEW V AS SELECT T.X AS "COL" FROM T`;
        expect(names(ddl)).toEqual(['COL']);
    });
});

// ---------------------------------------------------------------------------
// AC-3  Subquery alias exclusion
// ---------------------------------------------------------------------------

describe('AC-3: subquery alias exclusion', () => {
    it('does not extract aliases from a derived-table subquery in FROM', () => {
        const ddl = `
            VIEW V_BAZ AS SELECT S."X" AS "MY_COL"
            FROM (SELECT "A" AS "X" FROM "T") S
        `;
        expect(names(ddl)).toEqual(['MY_COL']);
    });

    it('does not include inner aliases X or A from the subquery', () => {
        const ddl = `
            VIEW V AS SELECT S."X" AS "MY_COL"
            FROM (SELECT T."A" AS "X" FROM T) S
        `;
        expect(names(ddl)).not.toContain('X');
        expect(names(ddl)).not.toContain('A');
    });

    it('extracts multiple outer aliases when FROM has a subquery', () => {
        const ddl = `
            VIEW V AS
            SELECT S.A AS "FIRST", S.B AS "SECOND"
            FROM (SELECT T.X AS A, T.Y AS B FROM T) S
        `;
        expect(names(ddl)).toEqual(['FIRST', 'SECOND']);
    });
});

// ---------------------------------------------------------------------------
// AC-4  Block comment exclusion
// ---------------------------------------------------------------------------

describe('AC-4: block comment exclusion', () => {
    it('does not extract an alias wrapped in /* … */', () => {
        const ddl = `
            VIEW V AS SELECT
                T."ID" AS "ID",
                /* T."OLD" AS "GHOST", */
                T."NAME" AS "NAME"
            FROM T
        `;
        expect(names(ddl)).not.toContain('GHOST');
    });

    it('still extracts aliases outside the block comment', () => {
        const ddl = `
            VIEW V AS SELECT
                T."ID" AS "ID",
                /* T."OLD" AS "GHOST", */
                T."NAME" AS "NAME"
            FROM T
        `;
        expect(names(ddl)).toContain('ID');
        expect(names(ddl)).toContain('NAME');
    });

    it('handles multi-line block comments', () => {
        const ddl = `
            VIEW V AS SELECT
                T.A AS "REAL_COL",
                /*
                  T.B AS "GHOST_A",
                  T.C AS "GHOST_B",
                */
                T.D AS "REAL_COL_2"
            FROM T
        `;
        const result = names(ddl);
        expect(result).not.toContain('GHOST_A');
        expect(result).not.toContain('GHOST_B');
        expect(result).toContain('REAL_COL');
        expect(result).toContain('REAL_COL_2');
    });
});

// ---------------------------------------------------------------------------
// AC-5  Line comment exclusion
// ---------------------------------------------------------------------------

describe('AC-5: line comment exclusion', () => {
    it('does not extract an alias appearing only in a -- comment', () => {
        const ddl = `
            VIEW V AS SELECT
                T."ID" AS "ID"
                -- , T."OLD" AS "OLD_COL"
            FROM T
        `;
        expect(names(ddl)).not.toContain('OLD_COL');
    });

    it('still extracts aliases on non-commented lines', () => {
        const ddl = `
            VIEW V AS SELECT
                T."ID" AS "ID"
                -- , T."OLD" AS "OLD_COL"
            FROM T
        `;
        expect(names(ddl)).toContain('ID');
    });
});

// ---------------------------------------------------------------------------
// AC-6  Quoted identifier normalisation
// ---------------------------------------------------------------------------

describe('AC-6: quoted identifier normalisation', () => {
    it('strips double-quotes from quoted aliases', () => {
        const ddl = `VIEW V AS SELECT T.X AS "MY_ALIAS" FROM T`;
        expect(extractViewColumns(ddl)).toContainEqual({ type: 'field', name: 'MY_ALIAS', lineNumber: 1 });
    });

    it('strips double-quotes from quoted names in explicit column list', () => {
        const ddl = `VIEW V ("MY_COL") AS SELECT T.X FROM T`;
        expect(extractViewColumns(ddl)).toContainEqual({ type: 'field', name: 'MY_COL', lineNumber: 1 });
    });
});

// ---------------------------------------------------------------------------
// AC-7  Schema-qualified view name
// ---------------------------------------------------------------------------

describe('AC-7: schema-qualified view name', () => {
    it('parses schema-qualified view name without throwing', () => {
        const ddl = `VIEW "MY_SCHEMA"."V_MY_VIEW" AS SELECT T.X AS "COL" FROM T`;
        expect(() => extractViewColumns(ddl)).not.toThrow();
    });

    it('extracts column aliases correctly from a schema-qualified view', () => {
        const ddl = `VIEW "MY_SCHEMA"."V_MY_VIEW" AS SELECT T.X AS "COL" FROM T`;
        expect(names(ddl)).toEqual(['COL']);
    });
});

// ---------------------------------------------------------------------------
// AC-8  WITH READ ONLY trailing clause
// ---------------------------------------------------------------------------

describe('AC-8: WITH READ ONLY trailing clause', () => {
    it('handles WITH READ ONLY without affecting column extraction', () => {
        const ddl = `VIEW V AS SELECT T.X AS "COL" FROM T WITH READ ONLY`;
        expect(names(ddl)).toEqual(['COL']);
    });

    it('handles WITH CHECK OPTION without affecting column extraction', () => {
        const ddl = `VIEW V AS SELECT T.X AS "COL" FROM T WITH CHECK OPTION`;
        expect(names(ddl)).toEqual(['COL']);
    });

    it('does not throw when WITH READ ONLY is present', () => {
        const ddl = `VIEW V AS SELECT T.X AS "COL" FROM T WITH READ ONLY`;
        expect(() => extractViewColumns(ddl)).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// AC-9  Unaliased SELECT item silently skipped
// ---------------------------------------------------------------------------

describe('AC-9: unaliased SELECT item silently skipped', () => {
    it('returns empty array when no AS alias is present and no column list', () => {
        const ddl = `VIEW V AS SELECT T."RAW_FIELD" FROM T`;
        expect(names(ddl)).toEqual([]);
    });

    it('skips items without alias, extracts items with alias', () => {
        const ddl = `VIEW V AS SELECT T.A, T.B AS "NAMED" FROM T`;
        expect(names(ddl)).toEqual(['NAMED']);
        expect(names(ddl)).not.toContain('A');
    });

    it('does not throw when all items lack aliases', () => {
        const ddl = `VIEW V AS SELECT T.A, T.B, T.C FROM T`;
        expect(() => extractViewColumns(ddl)).not.toThrow();
        expect(names(ddl)).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// AC-10  CREATE keyword optional
// ---------------------------------------------------------------------------

describe('AC-10: CREATE keyword optional', () => {
    it('extracts identical columns with and without CREATE keyword', () => {
        const withCreate = `CREATE VIEW V AS SELECT T.X AS "COL" FROM T`;
        const withoutCreate = `VIEW V AS SELECT T.X AS "COL" FROM T`;
        expect(names(withCreate)).toEqual(names(withoutCreate));
    });

    it('extracts columns when CREATE is absent', () => {
        const ddl = `VIEW V AS SELECT T.A AS "A", T.B AS "B" FROM T`;
        expect(names(ddl)).toEqual(['A', 'B']);
    });
});

// ---------------------------------------------------------------------------
// AC-11  Graceful error on unparseable file
// ---------------------------------------------------------------------------

describe('AC-11: graceful error on unparseable file', () => {
    it('does not throw on invalid / garbage syntax', () => {
        const ddl = `VIEW V AS SELECT ??? GARBAGE SYNTAX`;
        expect(() => extractViewColumns(ddl)).not.toThrow();
    });

    it('does not throw on empty string', () => {
        expect(() => extractViewColumns('')).not.toThrow();
    });

    it('does not throw on completely unrelated content', () => {
        expect(() => extractViewColumns('Hello world this is not SQL')).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// Additional real-world scenarios
// ---------------------------------------------------------------------------

describe('Real-world scenarios', () => {
    it('handles a multi-table JOIN view', () => {
        const ddl = `
            VIEW V_ORDERS AS
            SELECT
                O."ORDER_ID" AS "ORDER_ID",
                C."CUSTOMER_NAME" AS "CUSTOMER_NAME",
                O."TOTAL" AS "TOTAL"
            FROM "ORDERS" O
            INNER JOIN "CUSTOMERS" C ON O."CUSTOMER_ID" = C."ID"
            WHERE O."STATUS" = 'ACTIVE'
        `;
        expect(names(ddl)).toEqual(['ORDER_ID', 'CUSTOMER_NAME', 'TOTAL']);
    });

    it('handles a view with GROUP BY and HAVING', () => {
        const ddl = `
            VIEW V_SUMMARY AS
            SELECT
                T."CATEGORY" AS "CATEGORY",
                SUM(T."AMOUNT") AS "TOTAL_AMOUNT"
            FROM "TRANSACTIONS" T
            GROUP BY T."CATEGORY"
            HAVING SUM(T."AMOUNT") > 0
        `;
        expect(names(ddl)).toEqual(['CATEGORY', 'TOTAL_AMOUNT']);
    });

    it('handles CAST expression in SELECT', () => {
        const ddl = `
            VIEW V AS SELECT
                CAST(T.AMOUNT AS DECIMAL(10,2)) AS "AMOUNT_DEC"
            FROM T
        `;
        expect(names(ddl)).toEqual(['AMOUNT_DEC']);
    });

    it('handles CASE/WHEN expression in SELECT', () => {
        const ddl = `
            VIEW V AS SELECT
                CASE WHEN T.STATUS = 1 THEN 'ACTIVE' ELSE 'INACTIVE' END AS "STATUS_LABEL"
            FROM T
        `;
        expect(names(ddl)).toEqual(['STATUS_LABEL']);
    });

    it('handles a view with ORDER BY clause', () => {
        const ddl = `
            VIEW V AS SELECT T.X AS "COL_X", T.Y AS "COL_Y"
            FROM T
            ORDER BY T.X
        `;
        expect(names(ddl)).toEqual(['COL_X', 'COL_Y']);
    });

    it('handles CRLF line endings', () => {
        const ddl = `VIEW V AS SELECT T.X AS "COL" FROM T`.replace(/\n/g, '\r\n');
        expect(names(ddl)).toEqual(['COL']);
    });
});
