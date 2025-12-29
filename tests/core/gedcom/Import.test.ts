import { describe, it, expect } from 'vitest';
import { GedcomReader } from '../../../src/core/gedcom/Import';
import { Person } from '../../../src/schemas/PersonSchema';

describe('GedcomReader', () => {
    // Sample GEDCOM 5.5.1 Data
    const SAMPLE_GEDCOM = `
0 HEAD
1 SOUR LegacyGraph
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I1@ INDI
1 NAME John /Doe/
1 SEX M
1 BIRT
2 DATE 10 JAN 1980
2 PLAC Springfield, IL
1 NOTE This is a note about John.
1 _ATTR Blue Eyes
1 FAMC @F1@
0 @I2@ INDI
1 NAME Jane /Smith/
1 SEX F
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 1 JUN 2000
0 TRLR
`;

    it('should parse INDI records into Person objects', async () => {
        const reader = new GedcomReader();
        const result = await reader.parse(SAMPLE_GEDCOM);

        expect(result.people).toHaveLength(2);
        
        const john = result.people.find(p => p.names[0].last === 'Doe');
        expect(john).toBeDefined();
        if (john) {
            expect(john.names[0].first).toBe('John');
            expect(john.sex).toBe('M');
            expect(john.events).toHaveLength(2); // Birth + Marriage (derived from FAM)
            
            // Check Birth Event
            const birth = john.events.find(e => e.type === 'birth');
            expect(birth).toBeDefined();
            expect(birth?.date).toBe('10 JAN 1980');
            expect(birth?.location).toBe('Springfield, IL');

            // Check Custom Tag preservation
            expect(john._gedcom).toBeDefined();
            expect(john._gedcom?.['_ATTR']).toBe('Blue Eyes');

            // Check Note mapping to scrapbook_md
            expect(john.scrapbook_md).toContain('This is a note about John.');
        }
    });

    it('should link families correctly (Marriage Events)', async () => {
        const reader = new GedcomReader();
        const result = await reader.parse(SAMPLE_GEDCOM);

        const jane = result.people.find(p => p.names[0].last === 'Smith');
        expect(jane).toBeDefined();
        
        if (jane) {
            // Check Marriage Event
            const marriage = jane.events.find(e => e.type === 'marriage');
            expect(marriage).toBeDefined();
            expect(marriage?.date).toBe('1 JUN 2000');
            expect(marriage?.partner_id).toBeDefined(); // Should point to John's ID (which is dynamic, but we can check existence)
        }
    });

    it('should parse GEDCOM 7.0 structures', async () => {
        // GEDCOM 7.0 uses the same Lineage-Linked syntax but enforces UTF-8 and strict tagging.
        // This test verifies our parser regex handles standard 7.0 records.
        const GEDCOM_7 = `
0 HEAD
1 GEDC
2 VERS 7.0
1 CHAR UTF-8
0 @I_7A@ INDI
1 NAME Seven /Seven/
1 BIRT
2 DATE 2023
0 TRLR
`;
        const reader = new GedcomReader();
        const result = await reader.parse(GEDCOM_7);
        
        expect(result.people).toHaveLength(1);
        const p = result.people[0];
        expect(p.names[0].first).toBe("Seven");
        expect(p.events[0].date).toBe("2023");
        // Verify no warnings or crashes
    });
});
