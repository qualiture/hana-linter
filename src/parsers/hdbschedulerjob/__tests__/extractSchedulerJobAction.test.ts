import { describe, expect, it } from 'vitest';
import { extractSchedulerJobAction } from '../index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function action(content: string): string[] {
    return extractSchedulerJobAction(content)
        .filter((s) => s.type === 'jobAction')
        .map((s) => s.name);
}

// ---------------------------------------------------------------------------
// AC-1  Plain action name extraction
// ---------------------------------------------------------------------------

describe('AC-1: plain action name', () => {
    it('extracts a simple unqualified procedure name as a jobAction subject', () => {
        const content = `{
            "description": "Nightly cleanup",
            "action": "MY_PROCEDURE",
            "status": "active",
            "schedules": []
        }`;
        expect(extractSchedulerJobAction(content)).toEqual([{ type: 'jobAction', name: 'MY_PROCEDURE', lineNumber: 3 }]);
    });

    it('all results carry type "jobAction"', () => {
        const content = `{ "action": "MY_PROC", "schedules": [] }`;
        expect(extractSchedulerJobAction(content).every((r) => r.type === 'jobAction')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// AC-2  Package-path–qualified action name extraction
// ---------------------------------------------------------------------------

describe('AC-2: package-path-qualified action name', () => {
    it('extracts the full HDI path including the :: separator', () => {
        const content = `{
            "description": "Nightly cleanup",
            "action": "com.example.myapp::runMaintenance",
            "status": "active",
            "schedules": []
        }`;
        expect(extractSchedulerJobAction(content)).toEqual([{ type: 'jobAction', name: 'com.example.myapp::runMaintenance', lineNumber: 3 }]);
    });

    it('handles a minimal file with only an action key', () => {
        const content = `{ "action": "com.example::runJob" }`;
        expect(action(content)).toEqual(['com.example::runJob']);
    });
});

// ---------------------------------------------------------------------------
// AC-3  Schema-qualified SQL action name extraction
// ---------------------------------------------------------------------------

describe('AC-3: schema-qualified SQL action name', () => {
    it('extracts the full escaped schema-qualified name preserving inner escape sequences', () => {
        // In the raw file the JSON string is: "\"MY_SCHEMA\".\"MY_PROCEDURE\""
        // The JsonString token image is: "\"MY_SCHEMA\".\"MY_PROCEDURE\""
        // After stripping outer quotes the name is: \"MY_SCHEMA\".\"MY_PROCEDURE\"
        const content = `{
            "description": "Archival job",
            "action": "\\"MY_SCHEMA\\".\\"MY_PROCEDURE\\"",
            "status": "active",
            "schedules": []
        }`;
        expect(action(content)).toEqual(['\\"MY_SCHEMA\\".\\"MY_PROCEDURE\\"']);
    });

    it('extracts a plain schema-prefixed action without inner double-quotes', () => {
        const content = `{ "action": "MY_SCHEMA.MY_PROCEDURE" }`;
        expect(action(content)).toEqual(['MY_SCHEMA.MY_PROCEDURE']);
    });
});

// ---------------------------------------------------------------------------
// AC-4  // single-line comment exclusion
// ---------------------------------------------------------------------------

describe('AC-4: // comment exclusion', () => {
    it('does not extract an action from a // commented-out line', () => {
        const content = `{
            // "action": "OLD_PROCEDURE",
            "action": "com.example::runJob",
            "status": "active",
            "schedules": []
        }`;
        expect(action(content)).not.toContain('OLD_PROCEDURE');
        expect(action(content)).toContain('com.example::runJob');
    });

    it('handles a comment at end of a value line', () => {
        const content = `{
            "action": "com.example::runJob" // active job
        }`;
        expect(action(content)).toEqual(['com.example::runJob']);
    });
});

// ---------------------------------------------------------------------------
// AC-5  /* */ block comment exclusion
// ---------------------------------------------------------------------------

describe('AC-5: block comment exclusion', () => {
    it('does not extract an action wrapped in a block comment', () => {
        const content = `{
            /* "action": "DEPRECATED_PROC", */
            "action": "com.example::runJob",
            "status": "active",
            "schedules": []
        }`;
        expect(action(content)).not.toContain('DEPRECATED_PROC');
        expect(action(content)).toContain('com.example::runJob');
    });

    it('handles a multi-line block comment spanning several keys', () => {
        const content = `{
            /*
              "action": "OLD_PROC",
              "status": "inactive"
            */
            "action": "com.example::activeJob",
            "schedules": []
        }`;
        expect(action(content)).toEqual(['com.example::activeJob']);
    });
});

// ---------------------------------------------------------------------------
// AC-6  Nested schedule objects are ignored
// ---------------------------------------------------------------------------

describe('AC-6: nested schedule objects not extracted', () => {
    it('does not extract string values from within the schedules array', () => {
        const content = `{
            "description": "My job",
            "action": "com.example::theAction",
            "locale": "en",
            "status": "active",
            "schedules": [
                {
                    "description": "Run daily at midnight",
                    "xscron": "* * * * 1 0 0",
                    "parameter": "{ \\"mode\\": \\"full\\" }",
                    "status": "active"
                }
            ]
        }`;
        expect(extractSchedulerJobAction(content)).toEqual([{ type: 'jobAction', name: 'com.example::theAction', lineNumber: 3 }]);
    });

    it('handles an empty schedules array without error', () => {
        const content = `{ "action": "com.example::runJob", "schedules": [] }`;
        expect(action(content)).toEqual(['com.example::runJob']);
    });

    it('handles a deeply nested structure without extracting inner strings', () => {
        const content = `{
            "action": "com.example::runJob",
            "schedules": [
                { "nested": { "deep": "some.value::here" } }
            ]
        }`;
        expect(action(content)).toEqual(['com.example::runJob']);
    });
});

// ---------------------------------------------------------------------------
// AC-7  Trailing comma tolerance
// ---------------------------------------------------------------------------

describe('AC-7: trailing comma tolerance', () => {
    it('parses a trailing comma after the last key-value pair in an object', () => {
        const content = `{
            "description": "My job",
            "action": "com.example::runJob",
            "status": "active",
        }`;
        expect(() => extractSchedulerJobAction(content)).not.toThrow();
        expect(action(content)).toEqual(['com.example::runJob']);
    });

    it('parses a trailing comma inside the schedules array', () => {
        const content = `{
            "action": "com.example::runJob",
            "schedules": [
                { "xscron": "* * * * 1 0 0", "status": "active", },
            ]
        }`;
        expect(() => extractSchedulerJobAction(content)).not.toThrow();
        expect(action(content)).toEqual(['com.example::runJob']);
    });
});

// ---------------------------------------------------------------------------
// AC-8  Missing action key returns empty array
// ---------------------------------------------------------------------------

describe('AC-8: missing action key', () => {
    it('returns an empty array when the action key is absent', () => {
        const content = `{
            "description": "Incomplete job",
            "status": "active",
            "schedules": []
        }`;
        expect(extractSchedulerJobAction(content)).toEqual([]);
    });

    it('returns an empty array for an empty object', () => {
        expect(extractSchedulerJobAction('{}')).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// AC-9  Malformed JSON degrades gracefully
// ---------------------------------------------------------------------------

describe('AC-9: malformed JSON degrades gracefully', () => {
    it('does not throw on completely invalid input', () => {
        expect(() => extractSchedulerJobAction('NOT JSON AT ALL !!!')).not.toThrow();
    });

    it('does not throw on an empty string', () => {
        expect(() => extractSchedulerJobAction('')).not.toThrow();
        expect(extractSchedulerJobAction('')).toEqual([]);
    });

    it('does not throw on a missing closing brace', () => {
        const content = `{ "action": "com.example::runJob"`;
        expect(() => extractSchedulerJobAction(content)).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// AC-10  CRLF line endings supported
// ---------------------------------------------------------------------------

describe('AC-10: CRLF line endings', () => {
    it('extracts the action name from a CRLF-terminated file', () => {
        const content = '{\r\n  "action": "com.example::runJob",\r\n  "schedules": []\r\n}';
        expect(action(content)).toEqual(['com.example::runJob']);
    });
});

// ---------------------------------------------------------------------------
// AC-11  UTF-8 BOM is tolerated
// ---------------------------------------------------------------------------

describe('AC-11: UTF-8 BOM tolerance', () => {
    it('strips a leading BOM before tokenisation', () => {
        const content = '\uFEFF{ "action": "com.example::runJob", "schedules": [] }';
        expect(action(content)).toEqual(['com.example::runJob']);
    });
});

// ---------------------------------------------------------------------------
// AC-13  Lint pipeline integration (unit-level contract)
// ---------------------------------------------------------------------------

describe('AC-13: pipeline integration — returns correct ExtractedSubject shape', () => {
    it('produces exactly one subject per file regardless of extra keys', () => {
        const content = `{
            "description": "My job",
            "action": "com.example::myJob",
            "locale": "en",
            "status": "active",
            "schedules": [{ "xscron": "* * * * 1 0 0", "status": "active" }]
        }`;
        const result = extractSchedulerJobAction(content);
        expect(result).toHaveLength(1);
        expect(result[0]?.type).toBe('jobAction');
        expect(result[0]?.name).toBe('com.example::myJob');
    });
});
