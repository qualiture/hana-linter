import { describe, expect, it } from 'vitest';
import { extractSequenceName } from '../index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function names(ddl: string): string[] {
    return extractSequenceName(ddl)
        .filter((s) => s.type === 'sequenceName')
        .map((s) => s.name);
}

// ---------------------------------------------------------------------------
// AC-1  Standard sequence name extraction — unquoted
// ---------------------------------------------------------------------------

describe('AC-1: unquoted sequence name', () => {
    it('extracts the sequence name as a sequenceName subject', () => {
        const ddl = `SEQUENCE MY_SEQUENCE INCREMENT BY 1 START WITH 1`;
        expect(extractSequenceName(ddl)).toEqual([{ type: 'sequenceName', name: 'MY_SEQUENCE', lineNumber: 1 }]);
    });

    it('handles a minimal file with no options', () => {
        const ddl = `SEQUENCE MY_SEQ`;
        expect(names(ddl)).toEqual(['MY_SEQ']);
    });

    it('all results carry type "sequenceName"', () => {
        const ddl = `SEQUENCE MY_SEQ INCREMENT BY 1`;
        expect(extractSequenceName(ddl).every((r) => r.type === 'sequenceName')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// AC-2  Standard sequence name extraction — quoted
// ---------------------------------------------------------------------------

describe('AC-2: quoted sequence name', () => {
    it('strips double-quotes from the sequence name', () => {
        const ddl = `SEQUENCE "MY_SEQUENCE" INCREMENT BY 1 START WITH 1`;
        expect(extractSequenceName(ddl)).toEqual([{ type: 'sequenceName', name: 'MY_SEQUENCE', lineNumber: 1 }]);
    });

    it('handles quoted name with no options', () => {
        const ddl = `SEQUENCE "ORDER_SEQ"`;
        expect(names(ddl)).toEqual(['ORDER_SEQ']);
    });
});

// ---------------------------------------------------------------------------
// AC-3  Schema-qualified sequence name — local name extracted
// ---------------------------------------------------------------------------

describe('AC-3: schema-qualified sequence name', () => {
    it('extracts only the local name (after the dot)', () => {
        const ddl = `SEQUENCE "MY_SCHEMA"."MY_SEQUENCE" INCREMENT BY 1`;
        expect(extractSequenceName(ddl)).toEqual([{ type: 'sequenceName', name: 'MY_SEQUENCE', lineNumber: 1 }]);
    });

    it('does not include the schema prefix as a subject', () => {
        const ddl = `SEQUENCE "MY_SCHEMA"."MY_SEQUENCE" START WITH 100`;
        expect(names(ddl)).not.toContain('MY_SCHEMA');
    });

    it('handles unquoted schema-qualified name', () => {
        const ddl = `SEQUENCE MY_SCHEMA.MY_SEQ START WITH 1`;
        expect(names(ddl)).toEqual(['MY_SEQ']);
    });
});

// ---------------------------------------------------------------------------
// AC-4  Block comment exclusion
// ---------------------------------------------------------------------------

describe('AC-4: block comment exclusion', () => {
    it('does not extract tokens inside /* … */ comments', () => {
        const ddl = `
            /* SEQUENCE OLD_SEQUENCE START WITH 1 */
            SEQUENCE MY_SEQUENCE INCREMENT BY 1
        `;
        expect(names(ddl)).not.toContain('OLD_SEQUENCE');
        expect(names(ddl)).toContain('MY_SEQUENCE');
    });

    it('handles a block comment wrapping sequence options', () => {
        const ddl = `
            SEQUENCE MY_SEQUENCE
            /* INCREMENT BY 5
               START WITH 100 */
            START WITH 1
        `;
        expect(names(ddl)).toEqual(['MY_SEQUENCE']);
    });
});

// ---------------------------------------------------------------------------
// AC-5  Line comment exclusion
// ---------------------------------------------------------------------------

describe('AC-5: line comment exclusion', () => {
    it('does not extract an identifier on a -- comment line', () => {
        const ddl = `
            -- SEQUENCE OLD_SEQUENCE START WITH 1
            SEQUENCE MY_SEQUENCE INCREMENT BY 1
        `;
        expect(names(ddl)).not.toContain('OLD_SEQUENCE');
        expect(names(ddl)).toContain('MY_SEQUENCE');
    });

    it('ignores a -- comment after an option value', () => {
        const ddl = `
            SEQUENCE MY_SEQUENCE
            START WITH 1 -- starting value
            INCREMENT BY 1
        `;
        expect(names(ddl)).toEqual(['MY_SEQUENCE']);
    });
});

// ---------------------------------------------------------------------------
// AC-6  RESET BY SELECT body not extracted
// ---------------------------------------------------------------------------

describe('AC-6: RESET BY SELECT body not extracted', () => {
    it('does not include identifiers from the RESET BY SELECT body', () => {
        const ddl = `
            SEQUENCE "ORDER_SEQ"
              START WITH 1
              INCREMENT BY 1
              RESET BY SELECT IFNULL(MAX("ORDER_ID"), 0) + 1 FROM "ORDERS"
        `;
        const result = extractSequenceName(ddl);
        expect(result).toEqual([{ type: 'sequenceName', name: 'ORDER_SEQ', lineNumber: 2 }]);
        expect(names(ddl)).not.toContain('ORDER_ID');
        expect(names(ddl)).not.toContain('ORDERS');
    });

    it('correctly extracts the name when RESET BY comes before other options', () => {
        const ddl = `
            SEQUENCE "SEQ_A"
              RESET BY SELECT IFNULL(MAX("ID"), 0) + 1 FROM "T"
              INCREMENT BY 1
              START WITH 1
        `;
        expect(names(ddl)).toEqual(['SEQ_A']);
    });

    it('does not extract IFNULL, MAX, or other function names from the RESET BY body', () => {
        const ddl = `
            SEQUENCE MY_SEQ
            RESET BY SELECT IFNULL(MAX(ID), 0) + 1 FROM MY_TABLE
        `;
        expect(names(ddl)).toEqual(['MY_SEQ']);
    });

    it('handles a complex RESET BY expression with arithmetic and CASE', () => {
        const ddl = `
            SEQUENCE "COMPLEX_SEQ"
              RESET BY SELECT CASE WHEN MAX("VAL") IS NULL THEN 1 ELSE MAX("VAL") + 1 END FROM "T"
        `;
        expect(names(ddl)).toEqual(['COMPLEX_SEQ']);
    });
});

// ---------------------------------------------------------------------------
// AC-7  All standard sequence options consumed without error
// ---------------------------------------------------------------------------

describe('AC-7: all sequence options parsed without error', () => {
    it('handles all options in a single file', () => {
        const ddl = `
            SEQUENCE "FULL_SEQ"
              INCREMENT BY 5
              START WITH 100
              MINVALUE 1
              MAXVALUE 9999999
              NO CYCLE
              DEPENDS ON "MY_TABLE";
        `;
        expect(extractSequenceName(ddl)).toEqual([{ type: 'sequenceName', name: 'FULL_SEQ', lineNumber: 2 }]);
    });

    it('handles options in a different order', () => {
        const ddl = `
            SEQUENCE MY_SEQ
              NO CYCLE
              MAXVALUE 9999
              START WITH 1
              MINVALUE 1
              INCREMENT BY 1
        `;
        expect(names(ddl)).toEqual(['MY_SEQ']);
    });
});

// ---------------------------------------------------------------------------
// AC-8  Optional semicolon terminator
// ---------------------------------------------------------------------------

describe('AC-8: optional semicolon', () => {
    it('produces the same result with and without a trailing semicolon', () => {
        const withSemicolon = `SEQUENCE MY_SEQ INCREMENT BY 1;`;
        const withoutSemicolon = `SEQUENCE MY_SEQ INCREMENT BY 1`;
        expect(names(withSemicolon)).toEqual(names(withoutSemicolon));
    });
});

// ---------------------------------------------------------------------------
// AC-9  NO MINVALUE / NO MAXVALUE variants
// ---------------------------------------------------------------------------

describe('AC-9: NO MINVALUE and NO MAXVALUE', () => {
    it('parses NO MINVALUE and NO MAXVALUE without error', () => {
        const ddl = `
            SEQUENCE "RANGE_SEQ"
              START WITH 1
              INCREMENT BY 1
              NO MINVALUE
              NO MAXVALUE
              NO CYCLE;
        `;
        expect(extractSequenceName(ddl)).toEqual([{ type: 'sequenceName', name: 'RANGE_SEQ', lineNumber: 2 }]);
    });

    it('handles NO MINVALUE alone', () => {
        const ddl = `SEQUENCE MY_SEQ NO MINVALUE INCREMENT BY 1`;
        expect(names(ddl)).toEqual(['MY_SEQ']);
    });

    it('handles NO MAXVALUE alone', () => {
        const ddl = `SEQUENCE MY_SEQ NO MAXVALUE`;
        expect(names(ddl)).toEqual(['MY_SEQ']);
    });
});

// ---------------------------------------------------------------------------
// AC-10  Graceful error handling
// ---------------------------------------------------------------------------

describe('AC-10: graceful error handling', () => {
    it('does not throw on completely invalid input', () => {
        expect(() => extractSequenceName('THIS IS NOT VALID DDL !!!')).not.toThrow();
    });

    it('does not throw on an empty string', () => {
        expect(() => extractSequenceName('')).not.toThrow();
        expect(extractSequenceName('')).toEqual([]);
    });

    it('returns empty array when SEQUENCE keyword is missing', () => {
        expect(extractSequenceName('START WITH 1 INCREMENT BY 1')).toEqual([]);
    });

    it('does not throw on a file that is only comments', () => {
        const ddl = `
            -- This file is intentionally left blank
            /* No sequence defined here */
        `;
        expect(() => extractSequenceName(ddl)).not.toThrow();
        expect(extractSequenceName(ddl)).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// CRLF line endings
// ---------------------------------------------------------------------------

describe('CRLF line endings', () => {
    it('handles CRLF line endings correctly', () => {
        const ddl = 'SEQUENCE "MY_SEQ"\r\n  INCREMENT BY 1\r\n  START WITH 1\r\n';
        expect(names(ddl)).toEqual(['MY_SEQ']);
    });
});
