import { describe, expect, it } from 'vitest';
import { extractTriggerName } from '../index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function names(ddl: string): string[] {
    return extractTriggerName(ddl)
        .filter((s) => s.type === 'triggerName')
        .map((s) => s.name);
}

// ---------------------------------------------------------------------------
// AC-1  Basic trigger name extraction — unquoted name
// ---------------------------------------------------------------------------

describe('AC-1: basic trigger name extraction', () => {
    it('extracts the trigger name as a triggerName subject', () => {
        const ddl = `CREATE TRIGGER TRG_AI_MY_TABLE AFTER INSERT ON MY_TABLE FOR EACH ROW BEGIN END`;
        expect(extractTriggerName(ddl)).toEqual([{ type: 'triggerName', name: 'TRG_AI_MY_TABLE', lineNumber: 1 }]);
    });

    it('handles a file without a trailing semicolon', () => {
        const ddl = `CREATE TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH ROW BEGIN END`;
        expect(names(ddl)).toEqual(['TRG_AI_T']);
    });

    it('handles a file with a trailing semicolon', () => {
        const ddl = `CREATE TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH ROW BEGIN END;`;
        expect(names(ddl)).toEqual(['TRG_AI_T']);
    });

    it('all results carry type "triggerName"', () => {
        const ddl = `CREATE TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH ROW BEGIN END`;
        expect(extractTriggerName(ddl).every((r) => r.type === 'triggerName')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// AC-2  Quoted trigger name normalisation
// ---------------------------------------------------------------------------

describe('AC-2: quoted trigger name normalisation', () => {
    it('strips double-quotes from the trigger name', () => {
        const ddl = `CREATE TRIGGER "TRG_AI_MY_TABLE" AFTER INSERT ON "MY_TABLE" FOR EACH ROW BEGIN END`;
        expect(extractTriggerName(ddl)).toEqual([{ type: 'triggerName', name: 'TRG_AI_MY_TABLE', lineNumber: 1 }]);
    });

    it('handles a mixed-quote file (quoted trigger name, unquoted table)', () => {
        const ddl = `CREATE TRIGGER "TRG_AI_T" AFTER INSERT ON MY_TABLE FOR EACH ROW BEGIN END`;
        expect(names(ddl)).toEqual(['TRG_AI_T']);
    });
});

// ---------------------------------------------------------------------------
// AC-3  Schema-qualified trigger name — local name extracted
// ---------------------------------------------------------------------------

describe('AC-3: schema-qualified trigger name', () => {
    it('extracts only the local name (after the dot)', () => {
        const ddl = `CREATE TRIGGER "MY_SCHEMA"."TRG_AI_MY_TABLE" AFTER INSERT ON "MY_TABLE" FOR EACH ROW BEGIN END`;
        expect(extractTriggerName(ddl)).toEqual([{ type: 'triggerName', name: 'TRG_AI_MY_TABLE', lineNumber: 1 }]);
    });

    it('does not include the schema prefix as a subject', () => {
        const ddl = `CREATE TRIGGER "MY_SCHEMA"."TRG_AI_T" AFTER INSERT ON "MY_TABLE" FOR EACH ROW BEGIN END`;
        expect(names(ddl)).not.toContain('MY_SCHEMA');
    });

    it('handles unquoted schema-qualified name', () => {
        const ddl = `CREATE TRIGGER MY_SCHEMA.TRG_AI_T AFTER INSERT ON MY_TABLE FOR EACH ROW BEGIN END`;
        expect(names(ddl)).toEqual(['TRG_AI_T']);
        expect(names(ddl)).not.toContain('MY_SCHEMA');
    });
});

// ---------------------------------------------------------------------------
// AC-4  Optional CREATE keyword absent
// ---------------------------------------------------------------------------

describe('AC-4: optional CREATE keyword absent', () => {
    it('extracts the trigger name when CREATE is omitted', () => {
        const ddl = `TRIGGER TRG_AI_MY_TABLE AFTER INSERT ON MY_TABLE FOR EACH ROW BEGIN END`;
        expect(extractTriggerName(ddl)).toEqual([{ type: 'triggerName', name: 'TRG_AI_MY_TABLE', lineNumber: 1 }]);
    });

    it('produces the same result with and without CREATE', () => {
        const withCreate = `CREATE TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH ROW BEGIN END`;
        const withoutCreate = `TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH ROW BEGIN END`;
        expect(names(withCreate)).toEqual(names(withoutCreate));
    });
});

// ---------------------------------------------------------------------------
// AC-5  BEFORE timing keyword
// ---------------------------------------------------------------------------

describe('AC-5: BEFORE timing keyword', () => {
    it('extracts the trigger name for a BEFORE INSERT trigger', () => {
        const ddl = `CREATE TRIGGER TRG_BI_T BEFORE INSERT ON T FOR EACH ROW BEGIN END`;
        expect(extractTriggerName(ddl)).toEqual([{ type: 'triggerName', name: 'TRG_BI_T', lineNumber: 1 }]);
    });

    it('extracts the trigger name for a BEFORE UPDATE trigger', () => {
        const ddl = `CREATE TRIGGER TRG_BU_T BEFORE UPDATE ON T FOR EACH ROW BEGIN END`;
        expect(names(ddl)).toEqual(['TRG_BU_T']);
    });

    it('extracts the trigger name for a BEFORE DELETE trigger', () => {
        const ddl = `CREATE TRIGGER TRG_BD_T BEFORE DELETE ON T FOR EACH ROW BEGIN END`;
        expect(names(ddl)).toEqual(['TRG_BD_T']);
    });
});

// ---------------------------------------------------------------------------
// AC-6  INSTEAD OF timing keyword
// ---------------------------------------------------------------------------

describe('AC-6: INSTEAD OF timing keyword', () => {
    it('extracts the trigger name for an INSTEAD OF INSERT trigger', () => {
        const ddl = `CREATE TRIGGER TRG_IO_V INSTEAD OF INSERT ON V FOR EACH ROW BEGIN END`;
        expect(extractTriggerName(ddl)).toEqual([{ type: 'triggerName', name: 'TRG_IO_V', lineNumber: 1 }]);
    });

    it('extracts the trigger name for an INSTEAD OF UPDATE trigger', () => {
        const ddl = `CREATE TRIGGER TRG_IO_V INSTEAD OF UPDATE ON V FOR EACH ROW BEGIN END`;
        expect(names(ddl)).toEqual(['TRG_IO_V']);
    });

    it('extracts the trigger name for an INSTEAD OF DELETE trigger', () => {
        const ddl = `CREATE TRIGGER TRG_IO_V INSTEAD OF DELETE ON V FOR EACH ROW BEGIN END`;
        expect(names(ddl)).toEqual(['TRG_IO_V']);
    });
});

// ---------------------------------------------------------------------------
// AC-7  UPDATE OF column list excluded
// ---------------------------------------------------------------------------

describe('AC-7: UPDATE OF column list excluded', () => {
    it('does not include UPDATE OF column names in the result', () => {
        const ddl = `CREATE TRIGGER TRG_AU_T AFTER UPDATE OF COL1, COL2, COL3 ON T FOR EACH ROW BEGIN END`;
        expect(extractTriggerName(ddl)).toEqual([{ type: 'triggerName', name: 'TRG_AU_T', lineNumber: 1 }]);
    });

    it('does not include column names from UPDATE OF as subjects', () => {
        const ddl = `CREATE TRIGGER TRG_AU_T AFTER UPDATE OF COL1, COL2 ON T FOR EACH ROW BEGIN END`;
        expect(names(ddl)).not.toContain('COL1');
        expect(names(ddl)).not.toContain('COL2');
    });

    it('handles quoted column names in UPDATE OF without error', () => {
        const ddl = `CREATE TRIGGER TRG_AU_T AFTER UPDATE OF "COL1", "COL2" ON "T" FOR EACH ROW BEGIN END`;
        expect(names(ddl)).toEqual(['TRG_AU_T']);
    });

    it('handles UPDATE without OF clause', () => {
        const ddl = `CREATE TRIGGER TRG_AU_T AFTER UPDATE ON T FOR EACH ROW BEGIN END`;
        expect(names(ddl)).toEqual(['TRG_AU_T']);
    });
});

// ---------------------------------------------------------------------------
// AC-8  REFERENCING clause excluded
// ---------------------------------------------------------------------------

describe('AC-8: REFERENCING clause excluded', () => {
    it('does not include NEW ROW alias in the result', () => {
        const ddl = `CREATE TRIGGER TRG_AI_T AFTER INSERT ON T REFERENCING NEW ROW AS NEW_ROW FOR EACH ROW BEGIN END`;
        expect(extractTriggerName(ddl)).toEqual([{ type: 'triggerName', name: 'TRG_AI_T', lineNumber: 1 }]);
        expect(names(ddl)).not.toContain('NEW_ROW');
    });

    it('does not include OLD ROW alias in the result', () => {
        const ddl = `CREATE TRIGGER TRG_AU_T AFTER UPDATE ON T REFERENCING OLD ROW AS OLD_ROW NEW ROW AS NEW_ROW FOR EACH ROW BEGIN END`;
        expect(names(ddl)).not.toContain('OLD_ROW');
        expect(names(ddl)).not.toContain('NEW_ROW');
        expect(names(ddl)).toEqual(['TRG_AU_T']);
    });

    it('handles NEW TABLE AS alias without error', () => {
        const ddl = `CREATE TRIGGER TRG_AI_T AFTER INSERT ON T REFERENCING NEW TABLE AS NEW_TABLE FOR EACH STATEMENT BEGIN END`;
        expect(names(ddl)).toEqual(['TRG_AI_T']);
        expect(names(ddl)).not.toContain('NEW_TABLE');
    });

    it('handles OLD TABLE AS alias without error', () => {
        const ddl = `CREATE TRIGGER TRG_AD_T AFTER DELETE ON T REFERENCING OLD TABLE AS OLD_TABLE FOR EACH STATEMENT BEGIN END`;
        expect(names(ddl)).toEqual(['TRG_AD_T']);
        expect(names(ddl)).not.toContain('OLD_TABLE');
    });
});

// ---------------------------------------------------------------------------
// AC-9  WHEN clause excluded
// ---------------------------------------------------------------------------

describe('AC-9: WHEN clause excluded', () => {
    it('extracts the trigger name without error when a WHEN clause is present', () => {
        const ddl = `CREATE TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH ROW WHEN (1 = 1) BEGIN END`;
        expect(extractTriggerName(ddl)).toEqual([{ type: 'triggerName', name: 'TRG_AI_T', lineNumber: 1 }]);
    });

    it('does not extract identifiers from the WHEN predicate', () => {
        const ddl = `CREATE TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH ROW WHEN (STATUS_COL > 0) BEGIN END`;
        expect(names(ddl)).not.toContain('STATUS_COL');
        expect(names(ddl)).toEqual(['TRG_AI_T']);
    });

    it('handles nested function calls in the WHEN predicate without error', () => {
        const ddl = `CREATE TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH ROW WHEN (COALESCE(NEW_VAL, 0) > 0) BEGIN END`;
        expect(names(ddl)).toEqual(['TRG_AI_T']);
    });

    it('handles a WHEN clause with a quoted identifier predicate', () => {
        const ddl = `CREATE TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH ROW WHEN ("STATUS" = 'ACTIVE') BEGIN END`;
        expect(names(ddl)).toEqual(['TRG_AI_T']);
    });
});

// ---------------------------------------------------------------------------
// AC-10  Trigger body excluded
// ---------------------------------------------------------------------------

describe('AC-10: trigger body excluded', () => {
    it('does not extract identifiers from the body', () => {
        const ddl = `
            CREATE TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH ROW
            BEGIN
                INSERT INTO AUDIT_LOG (EVENT_COL, TS_COL) VALUES ('INSERT', NOW());
            END
        `;
        expect(extractTriggerName(ddl)).toEqual([{ type: 'triggerName', name: 'TRG_AI_T', lineNumber: 2 }]);
        expect(names(ddl)).not.toContain('AUDIT_LOG');
        expect(names(ddl)).not.toContain('EVENT_COL');
    });

    it('handles a body containing TRIGGER and ON keywords without confusion', () => {
        const ddl = `
            CREATE TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH ROW
            BEGIN
                DECLARE LV_TRIGGER NVARCHAR(100);
                SELECT LV_TRIGGER FROM T WHERE ID = 1;
            END
        `;
        expect(names(ddl)).toEqual(['TRG_AI_T']);
    });

    it('handles a body with nested BEGIN/END blocks', () => {
        const ddl = `
            CREATE TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH ROW
            BEGIN
                BEGIN
                    INSERT INTO LOG_TABLE VALUES (1);
                END;
            END
        `;
        expect(names(ddl)).toEqual(['TRG_AI_T']);
    });

    it('handles multi-line body with parenthesised expressions', () => {
        const ddl = `
            CREATE TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH ROW
            BEGIN
                UPDATE OTHER_TABLE SET COL1 = CONCAT('prefix_', NEW_VAL) WHERE ID = 1;
            END
        `;
        expect(names(ddl)).toEqual(['TRG_AI_T']);
    });
});

// ---------------------------------------------------------------------------
// AC-11  Block comment exclusion
// ---------------------------------------------------------------------------

describe('AC-11: block comment exclusion', () => {
    it('does not extract a trigger name inside a block comment', () => {
        const ddl = `
            /* CREATE TRIGGER OLD_TRIGGER AFTER INSERT ON T FOR EACH ROW BEGIN END; */
            CREATE TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH ROW BEGIN END
        `;
        expect(names(ddl)).not.toContain('OLD_TRIGGER');
        expect(names(ddl)).toContain('TRG_AI_T');
    });

    it('handles an inline block comment inside the declaration', () => {
        const ddl = `CREATE TRIGGER /* inline comment */ TRG_AI_T AFTER INSERT ON T FOR EACH ROW BEGIN END`;
        expect(names(ddl)).toEqual(['TRG_AI_T']);
    });
});

// ---------------------------------------------------------------------------
// AC-12  Line comment exclusion
// ---------------------------------------------------------------------------

describe('AC-12: line comment exclusion', () => {
    it('does not extract a trigger name on a -- comment line', () => {
        const ddl = `
            -- CREATE TRIGGER OLD_TRIGGER AFTER INSERT ON T FOR EACH ROW BEGIN END;
            CREATE TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH ROW BEGIN END
        `;
        expect(names(ddl)).not.toContain('OLD_TRIGGER');
        expect(names(ddl)).toContain('TRG_AI_T');
    });

    it('handles a trailing line comment after the body', () => {
        const ddl = `CREATE TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH ROW BEGIN END -- end of trigger`;
        expect(names(ddl)).toEqual(['TRG_AI_T']);
    });
});

// ---------------------------------------------------------------------------
// AC-13  FOR EACH STATEMENT granularity
// ---------------------------------------------------------------------------

describe('AC-13: FOR EACH STATEMENT granularity', () => {
    it('extracts the trigger name for a FOR EACH STATEMENT trigger', () => {
        const ddl = `CREATE TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH STATEMENT BEGIN END`;
        expect(extractTriggerName(ddl)).toEqual([{ type: 'triggerName', name: 'TRG_AI_T', lineNumber: 1 }]);
    });
});

// ---------------------------------------------------------------------------
// AC-14  Optional trailing semicolon
// ---------------------------------------------------------------------------

describe('AC-14: optional trailing semicolon', () => {
    it('produces the same result with and without a trailing semicolon', () => {
        const withSemicolon = `CREATE TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH ROW BEGIN END;`;
        const withoutSemicolon = `CREATE TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH ROW BEGIN END`;
        expect(names(withSemicolon)).toEqual(names(withoutSemicolon));
    });
});

// ---------------------------------------------------------------------------
// AC-15  Graceful error handling
// ---------------------------------------------------------------------------

describe('AC-15: graceful error handling', () => {
    it('does not throw on completely invalid input', () => {
        expect(() => extractTriggerName('THIS IS NOT VALID DDL !!!')).not.toThrow();
    });

    it('does not throw on an empty string', () => {
        expect(() => extractTriggerName('')).not.toThrow();
        expect(extractTriggerName('')).toEqual([]);
    });

    it('does not throw when the TRIGGER keyword is missing', () => {
        expect(() => extractTriggerName('CREATE TRG_AI_T AFTER INSERT ON T FOR EACH ROW BEGIN END')).not.toThrow();
    });

    it('does not throw when the body is missing', () => {
        expect(() => extractTriggerName('CREATE TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH ROW')).not.toThrow();
    });

    it('does not throw on whitespace-only input', () => {
        expect(() => extractTriggerName('   \n\t  ')).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// Additional multi-clause combinations
// ---------------------------------------------------------------------------

describe('multi-clause trigger combinations', () => {
    it('handles all optional clauses present (REFERENCING + FOR EACH ROW + WHEN)', () => {
        const ddl = `
            CREATE TRIGGER TRG_AI_T
            AFTER INSERT ON T
            REFERENCING NEW ROW AS NEW_ROW
            FOR EACH ROW
            WHEN (NEW_ROW > 0)
            BEGIN END
        `;
        expect(names(ddl)).toEqual(['TRG_AI_T']);
    });

    it('handles AFTER DELETE with no optional clauses', () => {
        const ddl = `CREATE TRIGGER TRG_AD_T AFTER DELETE ON T BEGIN END`;
        expect(names(ddl)).toEqual(['TRG_AD_T']);
    });

    it('handles multi-line declaration formatting', () => {
        const ddl = `
            CREATE TRIGGER
              TRG_AU_T
            AFTER UPDATE OF STATUS_COL, PRIORITY_COL
            ON "MY_SCHEMA"."MY_TABLE"
            REFERENCING OLD ROW AS OLD_ROW NEW ROW AS NEW_ROW
            FOR EACH ROW
            WHEN (OLD_ROW.STATUS_COL <> NEW_ROW.STATUS_COL)
            BEGIN
                INSERT INTO AUDIT (MSG) VALUES ('Status changed');
            END;
        `;
        expect(names(ddl)).toEqual(['TRG_AU_T']);
        expect(names(ddl)).not.toContain('STATUS_COL');
        expect(names(ddl)).not.toContain('OLD_ROW');
        expect(names(ddl)).not.toContain('AUDIT');
    });

    it('handles CRLF line endings', () => {
        const ddl = 'CREATE TRIGGER TRG_AI_T AFTER INSERT ON T FOR EACH ROW BEGIN END\r\n';
        expect(names(ddl)).toEqual(['TRG_AI_T']);
    });
});
