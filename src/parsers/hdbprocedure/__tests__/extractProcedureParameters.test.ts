import { describe, it, expect } from 'vitest';
import { extractProcedureParameters } from '../index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inputs(ddl: string): string[] {
    return extractProcedureParameters(ddl)
        .filter((s) => s.type === 'inputParameter')
        .map((s) => s.name);
}

function outputs(ddl: string): string[] {
    return extractProcedureParameters(ddl)
        .filter((s) => s.type === 'outputParameter')
        .map((s) => s.name);
}

// ---------------------------------------------------------------------------
// AC-1  IN parameter extraction
// ---------------------------------------------------------------------------

describe('AC-1: IN parameter extraction', () => {
    it('extracts IN parameters as inputParameter subjects', () => {
        const ddl = `
            PROCEDURE MY_PROC (
                IN IV_CUSTOMER_ID NVARCHAR(10),
                IN IV_DATE DATE
            ) AS BEGIN END
        `;
        expect(extractProcedureParameters(ddl)).toEqual([
            { type: 'inputParameter', name: 'IV_CUSTOMER_ID', lineNumber: 3 },
            { type: 'inputParameter', name: 'IV_DATE', lineNumber: 4 }
        ]);
    });

    it('does not produce outputParameter entries for IN parameters', () => {
        const ddl = `PROCEDURE P (IN IV_AMOUNT DECIMAL(18,2)) AS BEGIN END`;
        expect(outputs(ddl)).toHaveLength(0);
    });

    it('all IN results carry type "inputParameter"', () => {
        const ddl = `PROCEDURE P (IN IV_A INTEGER, IN IV_B NVARCHAR(10)) AS BEGIN END`;
        expect(extractProcedureParameters(ddl).every((r) => r.type === 'inputParameter')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// AC-2  OUT parameter extraction
// ---------------------------------------------------------------------------

describe('AC-2: OUT parameter extraction', () => {
    it('extracts OUT parameters as outputParameter subjects', () => {
        const ddl = `
            PROCEDURE MY_PROC (
                OUT EV_COUNT INTEGER,
                OUT EV_STATUS NVARCHAR(1)
            ) AS BEGIN END
        `;
        expect(extractProcedureParameters(ddl)).toEqual([
            { type: 'outputParameter', name: 'EV_COUNT', lineNumber: 3 },
            { type: 'outputParameter', name: 'EV_STATUS', lineNumber: 4 }
        ]);
    });

    it('does not produce inputParameter entries for OUT parameters', () => {
        const ddl = `PROCEDURE P (OUT EV_FLAG BOOLEAN) AS BEGIN END`;
        expect(inputs(ddl)).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// AC-3  INOUT parameter yields both subject types
// ---------------------------------------------------------------------------

describe('AC-3: INOUT parameter yields inputParameter and outputParameter', () => {
    it('produces both types for an INOUT scalar parameter', () => {
        const ddl = `PROCEDURE P (INOUT CV_STATUS NVARCHAR(1)) AS BEGIN END`;
        expect(extractProcedureParameters(ddl)).toEqual([
            { type: 'inputParameter', name: 'CV_STATUS', lineNumber: 1 },
            { type: 'outputParameter', name: 'CV_STATUS', lineNumber: 1 }
        ]);
    });

    it('produces both types for an INOUT TABLE parameter', () => {
        const ddl = `PROCEDURE P (INOUT TV_RESULT TABLE (ID INTEGER)) AS BEGIN END`;
        const result = extractProcedureParameters(ddl);
        expect(result).toContainEqual({ type: 'inputParameter', name: 'TV_RESULT', lineNumber: 1 });
        expect(result).toContainEqual({ type: 'outputParameter', name: 'TV_RESULT', lineNumber: 1 });
    });

    it('yields exactly two entries for a single INOUT parameter', () => {
        const ddl = `PROCEDURE P (INOUT CV_X INTEGER) AS BEGIN END`;
        expect(extractProcedureParameters(ddl)).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// AC-4  TABLE-type parameter: inner columns not extracted
// ---------------------------------------------------------------------------

describe('AC-4: TABLE-type parameter columns not extracted', () => {
    it('extracts only the outer parameter name, not inner column names', () => {
        const ddl = `
            PROCEDURE P (
                IN TV_INPUT TABLE (COL1 INTEGER, COL2 NVARCHAR(100))
            ) AS BEGIN END
        `;
        const result = extractProcedureParameters(ddl);
        expect(result).toContainEqual({ type: 'inputParameter', name: 'TV_INPUT', lineNumber: 3 });
        expect(result.map((s) => s.name)).not.toContain('COL1');
        expect(result.map((s) => s.name)).not.toContain('COL2');
    });

    it('handles multi-column TABLE type without extracting column names', () => {
        const ddl = `
            PROCEDURE P (
                OUT TV_OUT TABLE (
                    ID BIGINT,
                    NAME NVARCHAR(200),
                    CREATED_AT TIMESTAMP
                )
            ) AS BEGIN END
        `;
        expect(outputs(ddl)).toEqual(['TV_OUT']);
        expect(extractProcedureParameters(ddl).map((s) => s.name)).not.toContain('ID');
        expect(extractProcedureParameters(ddl).map((s) => s.name)).not.toContain('NAME');
        expect(extractProcedureParameters(ddl).map((s) => s.name)).not.toContain('CREATED_AT');
    });
});

// ---------------------------------------------------------------------------
// AC-5  Procedure body SQL does not pollute extraction
// ---------------------------------------------------------------------------

describe('AC-5: procedure body SQL does not pollute extraction', () => {
    it('ignores IN keyword inside WHERE clause in the body', () => {
        const ddl = `
            PROCEDURE P (IN IV_ID INTEGER) AS
            BEGIN
                SELECT * FROM MY_TABLE WHERE STATUS IN ('A', 'B');
            END
        `;
        expect(inputs(ddl)).toEqual(['IV_ID']);
        expect(outputs(ddl)).toHaveLength(0);
    });

    it('ignores OUT-like variable assignments in the body', () => {
        const ddl = `
            PROCEDURE P (OUT EV_COUNT INTEGER) AS
            BEGIN
                SELECT COUNT(*) INTO EV_COUNT FROM MY_TABLE;
            END
        `;
        expect(outputs(ddl)).toEqual(['EV_COUNT']);
        expect(inputs(ddl)).toHaveLength(0);
    });

    it('handles nested BEGIN/END in body without false extraction', () => {
        const ddl = `
            PROCEDURE P (IN IV_FLAG BOOLEAN, OUT EV_RESULT NVARCHAR(10)) AS
            BEGIN
                IF :IV_FLAG = TRUE THEN
                BEGIN
                    EV_RESULT = 'YES';
                END;
                ELSE
                BEGIN
                    EV_RESULT = 'NO';
                END;
            END
        `;
        expect(inputs(ddl)).toEqual(['IV_FLAG']);
        expect(outputs(ddl)).toEqual(['EV_RESULT']);
    });

    it('handles deeply nested BEGIN/END blocks in the body', () => {
        const ddl = `
            PROCEDURE P (IN IV_X INTEGER, OUT EV_Y INTEGER) AS
            BEGIN
                BEGIN
                    BEGIN
                        EV_Y = IV_X + 1;
                    END;
                END;
            END
        `;
        expect(inputs(ddl)).toEqual(['IV_X']);
        expect(outputs(ddl)).toEqual(['EV_Y']);
    });
});

// ---------------------------------------------------------------------------
// AC-6  Block comment exclusion
// ---------------------------------------------------------------------------

describe('AC-6: block comment exclusion', () => {
    it('does not extract a parameter wrapped in /* … */', () => {
        const ddl = `
            PROCEDURE P (
                IN IV_ACTIVE BOOLEAN,
                /* IN IV_OLD NVARCHAR(10), */
                OUT EV_COUNT INTEGER
            ) AS BEGIN END
        `;
        const names = extractProcedureParameters(ddl).map((s) => s.name);
        expect(names).not.toContain('IV_OLD');
        expect(names).toContain('IV_ACTIVE');
        expect(names).toContain('EV_COUNT');
    });

    it('handles multi-line block comments spanning parameter definitions', () => {
        const ddl = `
            PROCEDURE P (
                IN IV_REAL INTEGER
                /*
                  , IN IV_GHOST_A NVARCHAR(10)
                  , IN IV_GHOST_B DATE
                */
            ) AS BEGIN END
        `;
        const names = extractProcedureParameters(ddl).map((s) => s.name);
        expect(names).not.toContain('IV_GHOST_A');
        expect(names).not.toContain('IV_GHOST_B');
        expect(names).toContain('IV_REAL');
    });
});

// ---------------------------------------------------------------------------
// AC-7  Line comment exclusion
// ---------------------------------------------------------------------------

describe('AC-7: line comment exclusion', () => {
    it('does not extract a parameter on a -- comment line', () => {
        const ddl = `
            PROCEDURE P (
                IN IV_ID INTEGER
                -- , IN IV_OLD NVARCHAR(10)
            ) AS BEGIN END
        `;
        expect(inputs(ddl)).toEqual(['IV_ID']);
        expect(inputs(ddl)).not.toContain('IV_OLD');
    });
});

// ---------------------------------------------------------------------------
// AC-8  Quoted identifier normalisation
// ---------------------------------------------------------------------------

describe('AC-8: quoted identifier normalisation', () => {
    it('strips double-quotes from a quoted IN parameter name', () => {
        const ddl = `PROCEDURE P (IN "IV_CUSTOMER_ID" NVARCHAR(10)) AS BEGIN END`;
        expect(extractProcedureParameters(ddl)).toContainEqual({
            type: 'inputParameter',
            name: 'IV_CUSTOMER_ID',
            lineNumber: 1
        });
    });

    it('strips double-quotes from a quoted OUT parameter name', () => {
        const ddl = `PROCEDURE P (OUT "EV_RESULT" INTEGER) AS BEGIN END`;
        expect(extractProcedureParameters(ddl)).toContainEqual({
            type: 'outputParameter',
            name: 'EV_RESULT',
            lineNumber: 1
        });
    });
});

// ---------------------------------------------------------------------------
// AC-9  Schema-qualified procedure name
// ---------------------------------------------------------------------------

describe('AC-9: schema-qualified procedure name', () => {
    it('parses schema-qualified name without error', () => {
        const ddl = `
            PROCEDURE "MY_SCHEMA"."MY_PROCEDURE" (IN IV_ID INTEGER)
            AS BEGIN END
        `;
        expect(() => extractProcedureParameters(ddl)).not.toThrow();
        expect(inputs(ddl)).toEqual(['IV_ID']);
    });
});

// ---------------------------------------------------------------------------
// AC-10  Procedure option clauses are ignored
// ---------------------------------------------------------------------------

describe('AC-10: procedure option clauses do not affect extraction', () => {
    it('handles LANGUAGE SQLSCRIPT SQL SECURITY INVOKER READS SQL DATA', () => {
        const ddl = `
            PROCEDURE P (IN IV_ID INTEGER, OUT EV_NAME NVARCHAR(100))
            LANGUAGE SQLSCRIPT
            SQL SECURITY INVOKER
            READS SQL DATA
            AS BEGIN END
        `;
        expect(inputs(ddl)).toEqual(['IV_ID']);
        expect(outputs(ddl)).toEqual(['EV_NAME']);
    });

    it('handles SQL SECURITY DEFINER MODIFIES SQL DATA WITH ENCRYPTION', () => {
        const ddl = `
            PROCEDURE P (OUT EV_FLAG BOOLEAN)
            SQL SECURITY DEFINER
            MODIFIES SQL DATA
            WITH ENCRYPTION
            AS BEGIN END
        `;
        expect(outputs(ddl)).toEqual(['EV_FLAG']);
    });

    it('handles DEFAULT SCHEMA option', () => {
        const ddl = `
            PROCEDURE P (IN IV_X INTEGER)
            DEFAULT SCHEMA MY_SCHEMA
            AS BEGIN END
        `;
        expect(inputs(ddl)).toEqual(['IV_X']);
    });

    it('handles all options together', () => {
        const ddl = `
            PROCEDURE P (IN IV_A INTEGER, OUT EV_B NVARCHAR(10))
            LANGUAGE SQLSCRIPT
            SQL SECURITY DEFINER
            DEFAULT SCHEMA MY_SCHEMA
            MODIFIES SQL DATA
            WITH ENCRYPTION
            AS BEGIN END
        `;
        expect(inputs(ddl)).toEqual(['IV_A']);
        expect(outputs(ddl)).toEqual(['EV_B']);
    });
});

// ---------------------------------------------------------------------------
// AC-11  Empty parameter list
// ---------------------------------------------------------------------------

describe('AC-11: empty parameter list', () => {
    it('returns empty array for a procedure with no parameters', () => {
        const ddl = `PROCEDURE P () AS BEGIN END`;
        expect(extractProcedureParameters(ddl)).toEqual([]);
    });

    it('returns empty array for a procedure with no parameters and options', () => {
        const ddl = `
            PROCEDURE P ()
            LANGUAGE SQLSCRIPT
            SQL SECURITY INVOKER
            AS BEGIN END
        `;
        expect(extractProcedureParameters(ddl)).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// AC-12  CREATE keyword optional
// ---------------------------------------------------------------------------

describe('AC-12: CREATE keyword optional', () => {
    it('extracts identically with and without CREATE keyword', () => {
        const withCreate = `CREATE PROCEDURE P (IN IV_ID INTEGER, OUT EV_NAME NVARCHAR(100)) AS BEGIN END`;
        const withoutCreate = `PROCEDURE P (IN IV_ID INTEGER, OUT EV_NAME NVARCHAR(100)) AS BEGIN END`;
        expect(extractProcedureParameters(withCreate)).toEqual(extractProcedureParameters(withoutCreate));
    });
});

// ---------------------------------------------------------------------------
// AC-13  Graceful error handling
// ---------------------------------------------------------------------------

describe('AC-13: graceful error handling', () => {
    it('does not throw on invalid syntax', () => {
        const ddl = `PROCEDURE ??? GARBAGE SYNTAX`;
        expect(() => extractProcedureParameters(ddl)).not.toThrow();
    });

    it('returns an array on invalid syntax', () => {
        const ddl = `PROCEDURE ??? GARBAGE SYNTAX`;
        expect(Array.isArray(extractProcedureParameters(ddl))).toBe(true);
    });

    it('does not throw on completely empty input', () => {
        expect(() => extractProcedureParameters('')).not.toThrow();
        expect(Array.isArray(extractProcedureParameters(''))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Mixed parameter modes
// ---------------------------------------------------------------------------

describe('mixed parameter modes', () => {
    it('handles IN, OUT, and INOUT parameters together', () => {
        const ddl = `
            PROCEDURE P (
                IN IV_ID INTEGER,
                OUT EV_COUNT INTEGER,
                INOUT CV_STATUS NVARCHAR(1)
            ) AS BEGIN END
        `;
        const result = extractProcedureParameters(ddl);
        expect(result).toContainEqual({ type: 'inputParameter', name: 'IV_ID', lineNumber: 3 });
        expect(result).toContainEqual({ type: 'outputParameter', name: 'EV_COUNT', lineNumber: 4 });
        expect(result).toContainEqual({ type: 'inputParameter', name: 'CV_STATUS', lineNumber: 5 });
        expect(result).toContainEqual({ type: 'outputParameter', name: 'CV_STATUS', lineNumber: 5 });
        expect(result).toHaveLength(4);
    });

    it('handles mixed scalar and TABLE parameters', () => {
        const ddl = `
            PROCEDURE P (
                IN IV_KEY NVARCHAR(10),
                OUT TV_RESULT TABLE (ID INTEGER, NAME NVARCHAR(100)),
                IN IV_FLAG BOOLEAN
            ) AS BEGIN END
        `;
        const result = extractProcedureParameters(ddl);
        expect(inputs(ddl)).toEqual(['IV_KEY', 'IV_FLAG']);
        expect(outputs(ddl)).toEqual(['TV_RESULT']);
        expect(result.map((s) => s.name)).not.toContain('ID');
        expect(result.map((s) => s.name)).not.toContain('NAME');
    });
});

// ---------------------------------------------------------------------------
// CRLF handling
// ---------------------------------------------------------------------------

describe('CRLF line endings', () => {
    it('handles CRLF line endings correctly', () => {
        const ddl = 'PROCEDURE P (\r\n    IN IV_ID INTEGER,\r\n    OUT EV_NAME NVARCHAR(100)\r\n) AS BEGIN END';
        expect(inputs(ddl)).toEqual(['IV_ID']);
        expect(outputs(ddl)).toEqual(['EV_NAME']);
    });
});
