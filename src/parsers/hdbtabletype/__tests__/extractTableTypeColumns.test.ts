import { describe, it, expect } from 'vitest';
import { extractTableTypeColumns } from '../index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fields(ddl: string): string[] {
    return extractTableTypeColumns(ddl)
        .filter((s) => s.type === 'field')
        .map((s) => s.name);
}

// ---------------------------------------------------------------------------
// AC-1  Standard column extraction
// ---------------------------------------------------------------------------

describe('AC-1: standard column extraction', () => {
    it('extracts all column names as field subjects in declaration order', () => {
        const ddl = `
            TYPE "MY_TYPE" AS TABLE (
                ID         INTEGER,
                NAME       NVARCHAR(100),
                CREATED_AT TIMESTAMP
            );
        `;
        expect(extractTableTypeColumns(ddl)).toEqual([
            { type: 'field', name: 'ID', lineNumber: 3 },
            { type: 'field', name: 'NAME', lineNumber: 4 },
            { type: 'field', name: 'CREATED_AT', lineNumber: 5 }
        ]);
    });

    it('handles a single-column table type', () => {
        const ddl = `TYPE "T" AS TABLE (STATUS NVARCHAR(1));`;
        expect(fields(ddl)).toEqual(['STATUS']);
    });

    it('all results carry type "field"', () => {
        const ddl = `TYPE "T" AS TABLE (A INTEGER, B NVARCHAR(10))`;
        expect(extractTableTypeColumns(ddl).every((r) => r.type === 'field')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// AC-2  Block comment exclusion
// ---------------------------------------------------------------------------

describe('AC-2: block comment exclusion', () => {
    it('does not extract a column wrapped in /* … */', () => {
        const ddl = `
            TYPE "T" AS TABLE (
                ID INTEGER,
                /* OLD_FIELD NVARCHAR(10), */
                NAME NVARCHAR(100)
            );
        `;
        expect(fields(ddl)).not.toContain('OLD_FIELD');
        expect(fields(ddl)).toContain('ID');
        expect(fields(ddl)).toContain('NAME');
    });

    it('does not extract a multi-line block-commented column', () => {
        const ddl = `
            TYPE "T" AS TABLE (
                /*
                  ARCHIVED_FLAG BOOLEAN,
                */
                ACTIVE_FLAG BOOLEAN
            );
        `;
        expect(fields(ddl)).not.toContain('ARCHIVED_FLAG');
        expect(fields(ddl)).toContain('ACTIVE_FLAG');
    });

    it('still extracts columns outside the block comment', () => {
        const ddl = `
            TYPE "T" AS TABLE (
                /* GONE INTEGER, */
                KEPT NVARCHAR(10)
            )
        `;
        expect(fields(ddl)).toEqual(['KEPT']);
    });
});

// ---------------------------------------------------------------------------
// AC-3  Line comment exclusion
// ---------------------------------------------------------------------------

describe('AC-3: line comment exclusion', () => {
    it('does not extract a column on a -- comment line', () => {
        const ddl = `
            TYPE "T" AS TABLE (
                ID INTEGER
                -- , OLD_FIELD NVARCHAR(10)
            );
        `;
        expect(fields(ddl)).not.toContain('OLD_FIELD');
        expect(fields(ddl)).toContain('ID');
    });

    it('extracts the column that follows an inline comment', () => {
        const ddl = `
            TYPE "T" AS TABLE (
                -- REMOVED BIGINT,
                KEPT DECIMAL(10, 2)
            )
        `;
        expect(fields(ddl)).toEqual(['KEPT']);
    });
});

// ---------------------------------------------------------------------------
// AC-4  Quoted identifier normalisation
// ---------------------------------------------------------------------------

describe('AC-4: quoted identifier normalisation', () => {
    it('strips double-quotes from a quoted column name', () => {
        const ddl = `TYPE "T" AS TABLE ("MY_COLUMN" NVARCHAR(100));`;
        expect(extractTableTypeColumns(ddl)).toContainEqual(expect.objectContaining({ type: 'field', name: 'MY_COLUMN' }));
    });

    it('handles a fully quoted table type with quoted type name and quoted columns', () => {
        const ddl = `
            TYPE "MY_SCHEMA"."MY_TYPE" AS TABLE (
                "ID"     INTEGER,
                "AMOUNT" DECIMAL(15, 2)
            );
        `;
        expect(fields(ddl)).toEqual(['ID', 'AMOUNT']);
    });
});

// ---------------------------------------------------------------------------
// AC-5  Unquoted identifier extraction
// ---------------------------------------------------------------------------

describe('AC-5: unquoted identifier extraction', () => {
    it('extracts an unquoted column name without modification', () => {
        const ddl = `TYPE MY_TYPE AS TABLE (MY_COLUMN NVARCHAR(100));`;
        expect(extractTableTypeColumns(ddl)).toContainEqual(expect.objectContaining({ type: 'field', name: 'MY_COLUMN' }));
    });

    it('handles a mix of quoted and unquoted column names', () => {
        const ddl = `TYPE T AS TABLE ("QUOTED_COL" INTEGER, UNQUOTED_COL NVARCHAR(50))`;
        expect(fields(ddl)).toEqual(['QUOTED_COL', 'UNQUOTED_COL']);
    });
});

// ---------------------------------------------------------------------------
// AC-6  Schema-qualified type name does not affect extraction
// ---------------------------------------------------------------------------

describe('AC-6: schema-qualified type name not extracted as field', () => {
    it('does not emit the schema or type name as a field subject', () => {
        const ddl = `
            TYPE "MY_SCHEMA"."MY_TYPE" AS TABLE (
                COL_A INTEGER,
                COL_B NVARCHAR(50)
            );
        `;
        const names = fields(ddl);
        expect(names).not.toContain('MY_SCHEMA');
        expect(names).not.toContain('MY_TYPE');
        expect(names).toEqual(['COL_A', 'COL_B']);
    });
});

// ---------------------------------------------------------------------------
// AC-7  Data type precision arguments not extracted as columns
// ---------------------------------------------------------------------------

describe('AC-7: data type precision arguments not extracted', () => {
    it('does not emit numeric precision/scale arguments as field subjects', () => {
        const ddl = `
            TYPE "T" AS TABLE (
                AMOUNT DECIMAL(15, 2),
                LABEL  NVARCHAR(200)
            );
        `;
        const result = extractTableTypeColumns(ddl);
        const names = result.map((s) => s.name);
        expect(names).not.toContain('DECIMAL');
        expect(names).not.toContain('15');
        expect(names).not.toContain('2');
        expect(names).toContain('AMOUNT');
        expect(names).toContain('LABEL');
    });

    it('handles all common HANA-specific data types without failures', () => {
        const ddl = `
            TYPE "T" AS TABLE (
                A SECONDDATE,
                B SHORTTEXT(255),
                C ALPHANUM(20),
                D VARBINARY(512),
                E NCLOB,
                F BIGINT,
                G BOOLEAN,
                H BLOB
            );
        `;
        expect(fields(ddl)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    });

    it('handles NVARCHAR with precision', () => {
        const ddl = `TYPE "T" AS TABLE (COL NVARCHAR(100))`;
        expect(fields(ddl)).toEqual(['COL']);
    });
});

// ---------------------------------------------------------------------------
// AC-8  Multi-line column definitions
// ---------------------------------------------------------------------------

describe('AC-8: multi-line column definitions', () => {
    it('correctly extracts a column name when the data type is on the next line', () => {
        const ddl = `
            TYPE "T" AS TABLE (
                LONG_COLUMN_NAME
                    NVARCHAR(500),
                OTHER_COL INTEGER
            );
        `;
        expect(fields(ddl)).toEqual(['LONG_COLUMN_NAME', 'OTHER_COL']);
    });
});

// ---------------------------------------------------------------------------
// AC-9  Empty column list
// ---------------------------------------------------------------------------

describe('AC-9: empty column list', () => {
    it('returns an empty array and does not throw for TYPE T AS TABLE ()', () => {
        const ddl = `TYPE "MY_TYPE" AS TABLE ();`;
        expect(() => extractTableTypeColumns(ddl)).not.toThrow();
        expect(extractTableTypeColumns(ddl)).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// AC-10  Graceful error on unparseable file
// ---------------------------------------------------------------------------

describe('AC-10: graceful error on unparseable file', () => {
    it('does not throw on completely invalid input', () => {
        expect(() => extractTableTypeColumns('THIS IS NOT VALID DDL @@##')).not.toThrow();
    });

    it('does not throw on an empty string', () => {
        expect(() => extractTableTypeColumns('')).not.toThrow();
        expect(extractTableTypeColumns('')).toEqual([]);
    });

    it('does not throw for a file cut off mid-definition', () => {
        const ddl = `
            TYPE "T" AS TABLE (
                ID INTEGER,
                NAME NVARCHAR(
        `;
        // The function must not throw; it returns whatever could be recovered.
        expect(() => extractTableTypeColumns(ddl)).not.toThrow();
        expect(Array.isArray(extractTableTypeColumns(ddl))).toBe(true);
    });
});
