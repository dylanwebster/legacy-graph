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
            expect(birth?.location?.name).toBe('Springfield, IL');

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

    it('should link spouses when FAM has HUSB+WIFE but no MARR record', async () => {
        const NO_MARR_GEDCOM = `
0 HEAD
1 SOUR LegacyGraph
0 @I1@ INDI
1 NAME Hans /Gruber/
1 SEX M
0 @I2@ INDI
1 NAME Ingrid /Braun/
1 SEX F
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
0 TRLR
`;
        const reader = new GedcomReader();
        const result = await reader.parse(NO_MARR_GEDCOM);

        expect(result.people).toHaveLength(2);

        const hans = result.people.find(p => p.names[0].last === 'Gruber');
        const ingrid = result.people.find(p => p.names[0].last === 'Braun');
        expect(hans).toBeDefined();
        expect(ingrid).toBeDefined();

        if (hans && ingrid) {
            const hansMar = hans.events.find(e => e.type === 'marriage');
            expect(hansMar).toBeDefined();
            expect(hansMar?.partner_id).toBe(ingrid.id);
            expect(hansMar?.date).toBe('');

            const ingridMar = ingrid.events.find(e => e.type === 'marriage');
            expect(ingridMar).toBeDefined();
            expect(ingridMar?.partner_id).toBe(hans.id);
            expect(ingridMar?.date).toBe('');
        }
    });

    it('should NOT create a marriage event when FAM has only HUSB (no WIFE)', async () => {
        const HUSB_ONLY_GEDCOM = `
0 HEAD
1 SOUR LegacyGraph
0 @I1@ INDI
1 NAME Solo /Man/
1 SEX M
0 @F1@ FAM
1 HUSB @I1@
0 TRLR
`;
        const reader = new GedcomReader();
        const result = await reader.parse(HUSB_ONLY_GEDCOM);

        expect(result.people).toHaveLength(1);
        const soloMan = result.people[0];
        const marriageEvent = soloMan.events.find(e => e.type === 'marriage');
        expect(marriageEvent).toBeUndefined();
    });

    it('should parse GEDCOM 7.0 structures', async () => {
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
    });

    it('should import RESI (residence) events', async () => {
        const GEDCOM = `
0 HEAD
1 SOUR Test
0 @I1@ INDI
1 NAME Mary /Smith/
1 SEX F
1 RESI
2 DATE 1880
2 PLAC Boston, Massachusetts
1 RESI
2 DATE 1900
2 PLAC New York, New York
0 TRLR
`;
        const reader = new GedcomReader();
        const result = await reader.parse(GEDCOM);

        const mary = result.people[0];
        const residences = mary.events.filter(e => e.type === 'residence');
        expect(residences).toHaveLength(2);
        expect(residences[0].date).toBe('1880');
        expect(residences[0].location?.name).toBe('Boston, Massachusetts');
        expect(residences[0].sort_date).toBe('1880-01-01');
        expect(residences[1].date).toBe('1900');
    });

    it('should import EVEN (generic event) with TYPE subtag', async () => {
        const GEDCOM = `
0 HEAD
1 SOUR Test
0 @I1@ INDI
1 NAME Pamela /Whalley/
1 SEX F
1 EVEN
2 TYPE Arrival
2 DATE 24 May 1947
2 PLAC Southampton, England
0 TRLR
`;
        const reader = new GedcomReader();
        const result = await reader.parse(GEDCOM);

        const pamela = result.people[0];
        const arrival = pamela.events.find(e => e.type === 'generic');
        expect(arrival).toBeDefined();
        expect((arrival as any).title).toBe('Arrival');
        expect(arrival!.date).toBe('24 May 1947');
        expect(arrival!.sort_date).toBe('1947-05-24');
        expect(arrival!.location?.name).toBe('Southampton, England');
    });

    it('should import OCCU (occupation) events', async () => {
        const GEDCOM = `
0 HEAD
1 SOUR Test
0 @I1@ INDI
1 NAME John /Smith/
1 SEX M
1 OCCU Farmer
0 TRLR
`;
        const reader = new GedcomReader();
        const result = await reader.parse(GEDCOM);

        const john = result.people[0];
        const occupation = john.events.find(e => e.type === 'occupation');
        expect(occupation).toBeDefined();
        expect((occupation as any).title).toBe('Farmer');
    });

    it('should import DIV (divorce) from FAM record', async () => {
        const GEDCOM = `
0 HEAD
1 SOUR Test
0 @I1@ INDI
1 NAME John /Doe/
1 SEX M
1 FAMS @F1@
0 @I2@ INDI
1 NAME Jane /Doe/
1 SEX F
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 1 JUN 2000
1 DIV
2 DATE 15 MAR 2010
0 TRLR
`;
        const reader = new GedcomReader();
        const result = await reader.parse(GEDCOM);

        const john = result.people.find(p => p.names[0].first === 'John');
        const jane = result.people.find(p => p.names[0].first === 'Jane');
        expect(john).toBeDefined();
        expect(jane).toBeDefined();

        const johnDiv = john!.events.find(e => e.type === 'divorce');
        const janeDiv = jane!.events.find(e => e.type === 'divorce');
        expect(johnDiv).toBeDefined();
        expect(janeDiv).toBeDefined();
        expect(johnDiv!.date).toBe('15 MAR 2010');
        expect(johnDiv!.sort_date).toBe('2010-03-15');
        expect((johnDiv as any).partner_id).toBe(jane!.id);
        expect((janeDiv as any).partner_id).toBe(john!.id);
    });

    it('should assemble NOTE CONT/CONC continuations', async () => {
        const GEDCOM = `
0 HEAD
1 SOUR Test
0 @I1@ INDI
1 NAME Thomas /Berry/
1 SEX M
1 NOTE In Loving Remembrance of
2 CONT Thomas B. Berry
2 CONT Died July 25 1889
0 TRLR
`;
        const reader = new GedcomReader();
        const result = await reader.parse(GEDCOM);

        const thomas = result.people[0];
        expect(thomas.scrapbook_md).toContain("In Loving Remembrance of");
        expect(thomas.scrapbook_md).toContain("Thomas B. Berry");
        expect(thomas.scrapbook_md).toContain("Died July 25 1889");
    });

    it('should use Unknown name fallback when INDI has no NAME tag', async () => {
        const GEDCOM = `
0 HEAD
1 SOUR Test
0 @I1@ INDI
1 SEX M
0 TRLR
`;
        const reader = new GedcomReader();
        const result = await reader.parse(GEDCOM);

        expect(result.people).toHaveLength(1);
        const p = result.people[0];
        expect(p.names).toHaveLength(1);
        expect(p.names[0].first).toBe('Unknown');
    });

    it('should produce valid sort_date for Ancestry non-standard date formats', async () => {
        const GEDCOM = `
0 HEAD
1 SOUR Test
0 @I1@ INDI
1 NAME Thomas /Berry/
1 SEX M
1 BIRT
2 DATE Sep 28, 1873
1 DEAT
2 DATE July 25 1889
0 TRLR
`;
        const reader = new GedcomReader();
        const result = await reader.parse(GEDCOM);

        const thomas = result.people[0];
        const birth = thomas.events.find(e => e.type === 'birth');
        const death = thomas.events.find(e => e.type === 'death');
        expect(birth!.sort_date).toBe('1873-09-28');
        expect(death!.sort_date).toBe('1889-07-25');
    });
});
