import { describe, it, expect } from 'vitest';
import { extractFunctionParameters } from '../index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inputs(ddl: string): string[] {
    return extractFunctionParameters(ddl)
        .filter((s) => s.type === 'inputParameter')
        .map((s) => s.name);
}

// ---------------------------------------------------------------------------
// AC-1  IN parameter extraction (scalar function)
// ---------------------------------------------------------------------------

describe('AC-1: IN parameter extraction (scalar function)', () => {
    it('extracts IN parameters as inputParameter subjects', () => {
        const ddl = `
            FUNCTION MY_FUNC (
                IN IV_CUSTOMER_ID NVARCHAR(10),
                IN IV_DATE DATE
            ) RETURNS NVARCHAR(100) AS BEGIN END
        `;
        expect(extractFunctionParameters(ddl)).toEqual([
            { type: 'inputParameter', name: 'IV_CUSTOMER_ID', lineNumber: 3 },
            { type: 'inputParameter', name: 'IV_DATE', lineNumber: 4 }
        ]);
    });

    it('does not produce outputParameter entries for any parameter', () => {
        const ddl = `FUNCTION F (IN IV_AMOUNT DECIMAL(18,2)) RETURNS INTEGER AS BEGIN END`;
        const outputSubjects = extractFunctionParameters(ddl).filter((s) => s.type === 'outputParameter');
        expect(outputSubjects).toHaveLength(0);
    });

    it('all results carry type "inputParameter"', () => {
        const ddl = `FUNCTION F (IN IV_A INTEGER, IN IV_B NVARCHAR(10)) RETURNS INTEGER AS BEGIN END`;
        expect(extractFunctionParameters(ddl).every((r) => r.type === 'inputParameter')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// AC-2  IN parameter extraction (table function)
// ---------------------------------------------------------------------------

describe('AC-2: IN parameter extraction (table function)', () => {
    it('extracts IN params and ignores RETURNS TABLE columns', () => {
        const ddl = `
            FUNCTION MY_FUNC (
                IN IV_STATUS NVARCHAR(1)
            ) RETURNS TABLE (ID INTEGER, NAME NVARCHAR(100)) AS BEGIN END
        `;
        expect(extractFunctionParameters(ddl)).toEqual([{ type: 'inputParameter', name: 'IV_STATUS', lineNumber: 3 }]);
    });

    it('does not produce outputParameter entries for a table function', () => {
        const ddl = `
            FUNCTION F (IN IV_X INTEGER)
            RETURNS TABLE (COL1 NVARCHAR(10))
            AS BEGIN END
        `;
        const outputSubjects = extractFunctionParameters(ddl).filter((s) => s.type === 'outputParameter');
        expect(outputSubjects).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// AC-3  RETURNS TABLE columns are not extracted
// ---------------------------------------------------------------------------

describe('AC-3: RETURNS TABLE columns not extracted', () => {
    it('does not extract OUT_COL or IN_COL from RETURNS TABLE definition', () => {
        const ddl = `
            FUNCTION F ()
            RETURNS TABLE (OUT_COL INTEGER, IN_COL NVARCHAR(10))
            AS BEGIN END
        `;
        const names = extractFunctionParameters(ddl).map((s) => s.name);
        expect(names).not.toContain('OUT_COL');
        expect(names).not.toContain('IN_COL');
    });

    it('does not extract column names from a multi-column RETURNS TABLE', () => {
        const ddl = `
            FUNCTION F (IN IV_X INTEGER)
            RETURNS TABLE (
                COL_A BIGINT,
                COL_B NVARCHAR(200),
                COL_C TIMESTAMP
            ) AS BEGIN END
        `;
        expect(inputs(ddl)).toEqual(['IV_X']);
    });
});

// ---------------------------------------------------------------------------
// AC-4  No outputParameter subjects produced
// ---------------------------------------------------------------------------

describe('AC-4: no outputParameter subjects produced', () => {
    it('never emits an outputParameter entry for any parameter', () => {
        const ddl = `
            FUNCTION F (IN IV_A INTEGER, IN IV_B NVARCHAR(10))
            RETURNS INTEGER AS BEGIN END
        `;
        const outputSubjects = extractFunctionParameters(ddl).filter((s) => s.type === 'outputParameter');
        expect(outputSubjects).toHaveLength(0);
    });

    it('never emits outputParameter even for a function with no parameters', () => {
        const ddl = `FUNCTION F () RETURNS INTEGER AS BEGIN END`;
        const outputSubjects = extractFunctionParameters(ddl).filter((s) => s.type === 'outputParameter');
        expect(outputSubjects).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// AC-5  TABLE-type IN parameter: inner columns not extracted
// ---------------------------------------------------------------------------

describe('AC-5: TABLE-type IN parameter columns not extracted', () => {
    it('extracts only the outer parameter name, not inner column names', () => {
        const ddl = `
            FUNCTION F (
                IN TV_INPUT TABLE (COL1 INTEGER, COL2 NVARCHAR(100))
            ) RETURNS INTEGER AS BEGIN END
        `;
        const result = extractFunctionParameters(ddl);
        expect(result).toContainEqual({ type: 'inputParameter', name: 'TV_INPUT', lineNumber: 3 });
        expect(result.map((s) => s.name)).not.toContain('COL1');
        expect(result.map((s) => s.name)).not.toContain('COL2');
    });

    it('handles multi-column TABLE-type IN param without extracting column names', () => {
        const ddl = `
            FUNCTION F (
                IN TV_DATA TABLE (
                    ID BIGINT,
                    NAME NVARCHAR(200),
                    CREATED_AT TIMESTAMP
                )
            ) RETURNS INTEGER AS BEGIN END
        `;
        expect(inputs(ddl)).toEqual(['TV_DATA']);
    });
});

// ---------------------------------------------------------------------------
// AC-6  Function body SQL does not pollute extraction
// ---------------------------------------------------------------------------

describe('AC-6: function body SQL does not pollute extraction', () => {
    it('ignores IN keyword inside WHERE clause in the body', () => {
        const ddl = `
            FUNCTION F (IN IV_ID INTEGER) RETURNS INTEGER AS
            BEGIN
                SELECT COUNT(*) FROM MY_TABLE WHERE STATUS IN ('A', 'B');
            END
        `;
        expect(inputs(ddl)).toEqual(['IV_ID']);
    });

    it('handles nested BEGIN/END in body without false extraction', () => {
        const ddl = `
            FUNCTION F (IN IV_FLAG BOOLEAN) RETURNS NVARCHAR(10) AS
            BEGIN
                DECLARE result NVARCHAR(10);
                IF IV_FLAG = TRUE THEN
                BEGIN
                    result = 'YES';
                END;
                RETURN result;
            END
        `;
        expect(inputs(ddl)).toEqual(['IV_FLAG']);
    });

    it('body content containing IN and function-like syntax is ignored', () => {
        const ddl = `
            FUNCTION F (IN IV_STATUS NVARCHAR(1), IN IV_ID INTEGER)
            RETURNS TABLE (OUT_COL NVARCHAR(10))
            AS
            BEGIN
                RETURN SELECT STATUS FROM T WHERE ID IN (1, 2, 3) AND TYPE = 'IN';
            END
        `;
        const result = extractFunctionParameters(ddl);
        expect(result).toEqual([
            { type: 'inputParameter', name: 'IV_STATUS', lineNumber: 2 },
            { type: 'inputParameter', name: 'IV_ID', lineNumber: 2 }
        ]);
    });
});

// ---------------------------------------------------------------------------
// AC-7  Block comment exclusion
// ---------------------------------------------------------------------------

describe('AC-7: block comment exclusion', () => {
    it('does not extract a parameter wrapped in /* … */', () => {
        const ddl = `
            FUNCTION F (
                IN IV_ACTIVE BOOLEAN
                /* , IN IV_OLD NVARCHAR(10) */
            ) RETURNS INTEGER AS BEGIN END
        `;
        const names = inputs(ddl);
        expect(names).not.toContain('IV_OLD');
        expect(names).toContain('IV_ACTIVE');
    });

    it('handles block comment spanning multiple lines', () => {
        const ddl = `
            FUNCTION F (
                /*
                 * IN IV_COMMENTED INTEGER,
                 */
                IN IV_REAL NVARCHAR(10)
            ) RETURNS INTEGER AS BEGIN END
        `;
        expect(inputs(ddl)).toEqual(['IV_REAL']);
        expect(inputs(ddl)).not.toContain('IV_COMMENTED');
    });
});

// ---------------------------------------------------------------------------
// AC-8  Line comment exclusion
// ---------------------------------------------------------------------------

describe('AC-8: line comment exclusion', () => {
    it('does not extract a parameter on a -- comment line', () => {
        const ddl = `
            FUNCTION F (
                IN IV_ID INTEGER
                -- , IN IV_OLD NVARCHAR(10)
            ) RETURNS INTEGER AS BEGIN END
        `;
        expect(inputs(ddl)).toEqual(['IV_ID']);
        expect(inputs(ddl)).not.toContain('IV_OLD');
    });
});

// ---------------------------------------------------------------------------
// AC-9  Quoted identifier normalisation
// ---------------------------------------------------------------------------

describe('AC-9: quoted identifier normalisation', () => {
    it('strips double-quotes from a quoted parameter name', () => {
        const ddl = `FUNCTION F (IN "IV_CUSTOMER_ID" NVARCHAR(10)) RETURNS INTEGER AS BEGIN END`;
        expect(extractFunctionParameters(ddl)).toContainEqual({
            type: 'inputParameter',
            name: 'IV_CUSTOMER_ID',
            lineNumber: 1
        });
    });

    it('handles mixed quoted and unquoted parameters', () => {
        const ddl = `
            FUNCTION F (
                IN "IV_QUOTED" NVARCHAR(10),
                IN IV_UNQUOTED INTEGER
            ) RETURNS INTEGER AS BEGIN END
        `;
        expect(inputs(ddl)).toEqual(['IV_QUOTED', 'IV_UNQUOTED']);
    });
});

// ---------------------------------------------------------------------------
// AC-10  Schema-qualified function name
// ---------------------------------------------------------------------------

describe('AC-10: schema-qualified function name', () => {
    it('parses schema-qualified name without error', () => {
        const ddl = `
            FUNCTION "MY_SCHEMA"."MY_FUNCTION" (IN IV_ID INTEGER)
            RETURNS INTEGER AS BEGIN END
        `;
        expect(() => extractFunctionParameters(ddl)).not.toThrow();
        expect(inputs(ddl)).toEqual(['IV_ID']);
    });

    it('parses unquoted schema-qualified name without error', () => {
        const ddl = `FUNCTION MY_SCHEMA.MY_FUNC (IN IV_X INTEGER) RETURNS INTEGER AS BEGIN END`;
        expect(() => extractFunctionParameters(ddl)).not.toThrow();
        expect(inputs(ddl)).toEqual(['IV_X']);
    });
});

// ---------------------------------------------------------------------------
// AC-11  Function options are ignored
// ---------------------------------------------------------------------------

describe('AC-11: function option clauses do not affect extraction', () => {
    it('handles LANGUAGE SQLSCRIPT SQL SECURITY INVOKER', () => {
        const ddl = `
            FUNCTION F (IN IV_ID INTEGER)
            RETURNS INTEGER
            LANGUAGE SQLSCRIPT
            SQL SECURITY INVOKER
            AS BEGIN END
        `;
        expect(inputs(ddl)).toEqual(['IV_ID']);
    });

    it('handles SQL SECURITY DEFINER WITH ENCRYPTION', () => {
        const ddl = `
            FUNCTION F (IN IV_X NVARCHAR(10))
            RETURNS NVARCHAR(10)
            SQL SECURITY DEFINER
            WITH ENCRYPTION
            AS BEGIN END
        `;
        expect(inputs(ddl)).toEqual(['IV_X']);
    });

    it('handles DEFAULT SCHEMA option', () => {
        const ddl = `
            FUNCTION F (IN IV_X INTEGER)
            RETURNS INTEGER
            DEFAULT SCHEMA MY_SCHEMA
            AS BEGIN END
        `;
        expect(inputs(ddl)).toEqual(['IV_X']);
    });

    it('handles all options combined', () => {
        const ddl = `
            CREATE FUNCTION F (IN IV_A INTEGER, IN IV_B NVARCHAR(10))
            RETURNS TABLE (RES_COL NVARCHAR(10))
            LANGUAGE SQLSCRIPT
            SQL SECURITY DEFINER
            DEFAULT SCHEMA MY_SCHEMA
            WITH ENCRYPTION
            AS BEGIN END
        `;
        expect(inputs(ddl)).toEqual(['IV_A', 'IV_B']);
    });
});

// ---------------------------------------------------------------------------
// AC-12  Empty parameter list
// ---------------------------------------------------------------------------

describe('AC-12: empty parameter list', () => {
    it('returns empty array for a function with no parameters', () => {
        const ddl = `FUNCTION F () RETURNS INTEGER AS BEGIN END`;
        expect(extractFunctionParameters(ddl)).toEqual([]);
    });

    it('returns empty array for a table function with no parameters', () => {
        const ddl = `FUNCTION F () RETURNS TABLE (COL1 INTEGER) AS BEGIN END`;
        expect(extractFunctionParameters(ddl)).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// AC-13  CREATE keyword optional
// ---------------------------------------------------------------------------

describe('AC-13: CREATE keyword optional', () => {
    it('extracts identically with and without CREATE keyword', () => {
        const withCreate = `CREATE FUNCTION F (IN IV_ID INTEGER) RETURNS INTEGER AS BEGIN END`;
        const withoutCreate = `FUNCTION F (IN IV_ID INTEGER) RETURNS INTEGER AS BEGIN END`;
        expect(extractFunctionParameters(withCreate)).toEqual(extractFunctionParameters(withoutCreate));
    });
});

// ---------------------------------------------------------------------------
// AC-14  Graceful error on unparseable file
// ---------------------------------------------------------------------------

describe('AC-14: graceful error handling', () => {
    it('does not throw on invalid syntax', () => {
        const ddl = `FUNCTION ??? GARBAGE SYNTAX`;
        expect(() => extractFunctionParameters(ddl)).not.toThrow();
    });

    it('returns an array (possibly empty) on invalid syntax', () => {
        const ddl = `FUNCTION ??? GARBAGE SYNTAX`;
        expect(Array.isArray(extractFunctionParameters(ddl))).toBe(true);
    });

    it('does not throw on an empty string', () => {
        expect(() => extractFunctionParameters('')).not.toThrow();
        expect(Array.isArray(extractFunctionParameters(''))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// AC-15  CRLF line endings
// ---------------------------------------------------------------------------

describe('AC-15: CRLF line ending support', () => {
    it('correctly extracts parameters from a file with CRLF line endings', () => {
        const ddl = 'FUNCTION F (\r\n    IN IV_ID INTEGER,\r\n    IN IV_NAME NVARCHAR(100)\r\n) RETURNS INTEGER AS BEGIN END';
        expect(inputs(ddl)).toEqual(['IV_ID', 'IV_NAME']);
    });
});
