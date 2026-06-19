import { describe, it, expect } from 'vitest';
import { extractTableColumns } from '../index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function names(ddl: string): string[] {
    return extractTableColumns(ddl).map((s) => s.name);
}

// ---------------------------------------------------------------------------
// AC-1  Correct column extraction — standard case
// ---------------------------------------------------------------------------

describe('AC-1: standard column extraction', () => {
    it('extracts all column names from a COLUMN TABLE with a PK constraint', () => {
        const ddl = `
            COLUMN TABLE MY_TABLE (
                ID      INTEGER     NOT NULL,
                NAME    NVARCHAR(100),
                CREATED_AT TIMESTAMP,
                CONSTRAINT PK_MY_TABLE PRIMARY KEY (ID)
            )
        `;
        expect(extractTableColumns(ddl)).toEqual([
            { type: 'field', name: 'ID', lineNumber: 3 },
            { type: 'field', name: 'NAME', lineNumber: 4 },
            { type: 'field', name: 'CREATED_AT', lineNumber: 5 }
        ]);
    });

    it('does not include the constraint name in the result', () => {
        const ddl = `COLUMN TABLE T (A INTEGER, CONSTRAINT PK PRIMARY KEY (A))`;
        expect(names(ddl)).not.toContain('PK');
    });

    it('all results carry type "field"', () => {
        const ddl = `COLUMN TABLE T (A INTEGER, B NVARCHAR(10))`;
        expect(extractTableColumns(ddl).every((r) => r.type === 'field')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// AC-2  Block comment exclusion
// ---------------------------------------------------------------------------

describe('AC-2: block comment exclusion', () => {
    it('does not extract a column definition wrapped in /* … */', () => {
        const ddl = `
            COLUMN TABLE MY_TABLE (
                ID   INTEGER NOT NULL,
                /* DELETED_FIELD NVARCHAR(50), */
                NAME NVARCHAR(100)
            )
        `;
        expect(names(ddl)).not.toContain('DELETED_FIELD');
    });

    it('still extracts columns outside the block comment', () => {
        const ddl = `
            COLUMN TABLE T (
                /* GONE INTEGER, */
                KEPT NVARCHAR(10)
            )
        `;
        expect(names(ddl)).toEqual(['KEPT']);
    });

    it('handles multi-line block comments spanning several column definitions', () => {
        const ddl = `
            COLUMN TABLE T (
                REAL_COL INTEGER,
                /*
                  GHOST_A NVARCHAR(10),
                  GHOST_B DATE,
                */
                REAL_COL_2 BOOLEAN
            )
        `;
        const result = names(ddl);
        expect(result).not.toContain('GHOST_A');
        expect(result).not.toContain('GHOST_B');
        expect(result).toContain('REAL_COL');
        expect(result).toContain('REAL_COL_2');
    });
});

// ---------------------------------------------------------------------------
// AC-3  Line comment exclusion
// ---------------------------------------------------------------------------

describe('AC-3: line comment exclusion', () => {
    it('does not extract an identifier that appears only in a -- comment', () => {
        const ddl = `
            COLUMN TABLE MY_TABLE (
                ID   INTEGER NOT NULL,
                -- OLD_FIELD NVARCHAR(10),
                NAME NVARCHAR(100)
            )
        `;
        expect(names(ddl)).not.toContain('OLD_FIELD');
    });

    it('extracts the column on the same line after an inline comment has been consumed', () => {
        // Comments appear between columns, not inline with a column name.
        const ddl = `
            COLUMN TABLE T (
                A INTEGER, -- this is a comment
                B NVARCHAR(10)
            )
        `;
        expect(names(ddl)).toEqual(['A', 'B']);
    });
});

// ---------------------------------------------------------------------------
// AC-4  Quoted identifier normalisation
// ---------------------------------------------------------------------------

describe('AC-4: quoted identifier normalisation', () => {
    it('strips surrounding double-quotes from a quoted column identifier', () => {
        const ddl = `COLUMN TABLE "MY_TABLE" ("MY_COLUMN" NVARCHAR(100))`;
        expect(extractTableColumns(ddl)).toContainEqual({ type: 'field', name: 'MY_COLUMN', lineNumber: 1 });
    });

    it('strips quotes even when the table name is also quoted', () => {
        const ddl = `COLUMN TABLE "SCHEMA"."T" ("COL" INTEGER)`;
        expect(names(ddl)).toEqual(['COL']);
    });
});

// ---------------------------------------------------------------------------
// AC-5  Multi-line column definitions are not duplicated or omitted
// ---------------------------------------------------------------------------

describe('AC-5: multi-line column definitions', () => {
    it('correctly extracts a column whose name and type are on separate lines', () => {
        const ddl = `
            COLUMN TABLE T (
                MY_FIELD
                    NVARCHAR(200)
                    NOT NULL,
                OTHER INTEGER
            )
        `;
        expect(names(ddl)).toEqual(['MY_FIELD', 'OTHER']);
    });
});

// ---------------------------------------------------------------------------
// AC-6  HANA table-type variants
// ---------------------------------------------------------------------------

describe('AC-6: HANA table-type variants', () => {
    it('parses COLUMN TABLE', () => {
        expect(names('COLUMN TABLE T (A INTEGER)')).toEqual(['A']);
    });

    it('parses ROW TABLE', () => {
        expect(names('ROW TABLE T (B NVARCHAR(10))')).toEqual(['B']);
    });

    it('parses GLOBAL TEMPORARY COLUMN TABLE', () => {
        expect(names('GLOBAL TEMPORARY COLUMN TABLE T (C DATE)')).toEqual(['C']);
    });

    it('parses bare CREATE TABLE (no type modifier)', () => {
        expect(names('CREATE TABLE T (D BIGINT)')).toEqual(['D']);
    });

    it('parses CREATE COLUMN TABLE', () => {
        expect(names('CREATE COLUMN TABLE T (E DECIMAL(10,2))')).toEqual(['E']);
    });

    it('parses CREATE GLOBAL TEMPORARY COLUMN TABLE', () => {
        expect(names('CREATE GLOBAL TEMPORARY COLUMN TABLE T (F BOOLEAN)')).toEqual(['F']);
    });
});

// ---------------------------------------------------------------------------
// AC-7  Graceful error on unparseable input
// ---------------------------------------------------------------------------

describe('AC-7: graceful degradation on bad input', () => {
    it('does not throw on completely invalid input', () => {
        expect(() => extractTableColumns('TOTAL GARBAGE @@##!!')).not.toThrow();
    });

    it('does not throw on empty string', () => {
        expect(() => extractTableColumns('')).not.toThrow();
    });

    it('returns an array (possibly empty) for empty input', () => {
        expect(extractTableColumns('')).toEqual([]);
    });

    it('does not throw on input with only comments', () => {
        expect(() => extractTableColumns('-- just a comment\n/* another */')).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// Constraint-type coverage (all must be excluded from column list)
// ---------------------------------------------------------------------------

describe('constraint exclusion', () => {
    it('excludes UNIQUE INDEX constraint names', () => {
        const ddl = `
            COLUMN TABLE T (
                ID   INTEGER,
                NAME NVARCHAR(50),
                UNIQUE INDEX IDX_NAME (NAME)
            )
        `;
        const result = names(ddl);
        expect(result).toContain('ID');
        expect(result).toContain('NAME');
        expect(result).not.toContain('IDX_NAME');
    });

    it('excludes named CONSTRAINT … PRIMARY KEY clause', () => {
        const ddl = `COLUMN TABLE T (ID INTEGER, CONSTRAINT MY_PK PRIMARY KEY (ID))`;
        expect(names(ddl)).not.toContain('MY_PK');
    });

    it('excludes FOREIGN KEY … REFERENCES clause', () => {
        const ddl = `
            COLUMN TABLE T (
                ID        INTEGER,
                PARENT_ID INTEGER,
                FOREIGN KEY (PARENT_ID) REFERENCES OTHER_TABLE (ID)
            )
        `;
        const result = names(ddl);
        expect(result).toContain('ID');
        expect(result).toContain('PARENT_ID');
        expect(result).not.toContain('OTHER_TABLE');
    });

    it('excludes CHECK constraint contents', () => {
        const ddl = `
            COLUMN TABLE T (
                AMOUNT INTEGER,
                CHECK (AMOUNT > 0)
            )
        `;
        expect(names(ddl)).toEqual(['AMOUNT']);
    });
});

// ---------------------------------------------------------------------------
// Data-type coverage
// ---------------------------------------------------------------------------

describe('data-type coverage', () => {
    const types = [
        'NVARCHAR(100)',
        'VARCHAR(50)',
        'INTEGER',
        'BIGINT',
        'SMALLINT',
        'TINYINT',
        'DECIMAL(10,2)',
        'FLOAT',
        'DOUBLE',
        'REAL',
        'BOOLEAN',
        'DATE',
        'TIME',
        'TIMESTAMP',
        'SECONDDATE',
        'CLOB',
        'NCLOB',
        'BLOB',
        'VARBINARY(255)',
        'ALPHANUM(20)',
        'SHORTTEXT(100)'
    ];

    for (const dataType of types) {
        it(`correctly parses column with data type ${dataType}`, () => {
            const ddl = `COLUMN TABLE T (MY_COL ${dataType})`;
            expect(names(ddl)).toEqual(['MY_COL']);
        });
    }
});

// ---------------------------------------------------------------------------
// Table options (WITH PARAMETERS)
// ---------------------------------------------------------------------------

describe('table options', () => {
    it('handles WITH PARAMETERS clause without crashing', () => {
        const ddl = `
            COLUMN TABLE T (
                ID INTEGER
            ) WITH PARAMETERS ('PARTITION_SPEC' = 'HASH 4 PARTITIONS')
        `;
        expect(names(ddl)).toEqual(['ID']);
    });
});

// ---------------------------------------------------------------------------
// Mixed quoted/unquoted identifiers
// ---------------------------------------------------------------------------

describe('mixed quoted and unquoted identifiers', () => {
    it('handles a mix in the same table', () => {
        const ddl = `COLUMN TABLE T ("QUOTED" INTEGER, UNQUOTED NVARCHAR(10))`;
        expect(extractTableColumns(ddl)).toEqual([
            { type: 'field', name: 'QUOTED', lineNumber: 1 },
            { type: 'field', name: 'UNQUOTED', lineNumber: 1 }
        ]);
    });
});

// ---------------------------------------------------------------------------
// DEFAULT value edge cases
// ---------------------------------------------------------------------------

describe('DEFAULT value edge cases', () => {
    it('correctly extracts column name when followed by DEFAULT string literal', () => {
        const ddl = `COLUMN TABLE T (STATUS NVARCHAR(10) DEFAULT 'active')`;
        expect(names(ddl)).toEqual(['STATUS']);
    });

    it('correctly extracts column name when followed by DEFAULT integer literal', () => {
        const ddl = `COLUMN TABLE T (RETRIES INTEGER DEFAULT 0)`;
        expect(names(ddl)).toEqual(['RETRIES']);
    });

    it('correctly extracts column name when followed by DEFAULT NULL', () => {
        const ddl = `COLUMN TABLE T (OPT_VAL NVARCHAR(50) DEFAULT NULL)`;
        expect(names(ddl)).toEqual(['OPT_VAL']);
    });
});

// ---------------------------------------------------------------------------
// CRLF line endings (FR-8)
// ---------------------------------------------------------------------------

describe('CRLF line endings', () => {
    it('handles CRLF line endings correctly', () => {
        const ddl = 'COLUMN TABLE T (\r\n  ID INTEGER,\r\n  NAME NVARCHAR(10)\r\n)';
        expect(names(ddl)).toEqual(['ID', 'NAME']);
    });
});

// ---------------------------------------------------------------------------
// Schema-qualified table names
// ---------------------------------------------------------------------------

describe('schema-qualified table name', () => {
    it('parses a schema-qualified table name without extracting it as a column', () => {
        const ddl = `COLUMN TABLE "MY_SCHEMA"."MY_TABLE" (COL_A INTEGER)`;
        expect(names(ddl)).toEqual(['COL_A']);
    });
});
