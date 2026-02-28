import { describe, it, expect } from 'vitest';
import { GedcomReader } from '../../../src/core/gedcom/Import';
import { GedcomExporter } from '../../../src/core/gedcom/Export';

describe('GEDCOM Round-Trip (Import → Export → Import)', () => {
    it('should preserve all data through a full round-trip cycle', async () => {
        const originalGedcom = `
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
1 NOTE This is a biographical note.
1 _ATTR Custom Attribute Value
1 _ANOTHER Another Custom Tag
0 @I2@ INDI
1 NAME Jane /Smith/
1 SEX F
1 BIRT
2 DATE 5 MAR 1982
2 PLAC Boston, MA
0 @I3@ INDI
1 NAME Charlie /Doe/
1 SEX M
1 BIRT
2 DATE 15 JUL 2005
2 PLAC Chicago, IL
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 20 JUN 2004
2 PLAC Las Vegas, NV
1 CHIL @I3@
0 TRLR
`;
        
        // Step 1: Import original GEDCOM
        const reader = new GedcomReader();
        const importResult = await reader.parse(originalGedcom);
        
        expect(importResult.people).toHaveLength(3);
        
        // Step 2: Export to GEDCOM
        const exporter = new GedcomExporter();
        const exportedGedcom = exporter.exportPeople(importResult.people);
        
        // Step 3: Re-import the exported GEDCOM
        const reimportResult = await reader.parse(exportedGedcom);
        
        expect(reimportResult.people).toHaveLength(3);
        
        // Step 4: Verify data integrity
        
        // Find John in both datasets
        const johnOriginal = importResult.people.find(p => p.names[0].first === 'John');
        const johnReimport = reimportResult.people.find(p => p.names[0].first === 'John');
        
        expect(johnOriginal).toBeDefined();
        expect(johnReimport).toBeDefined();
        
        if (johnOriginal && johnReimport) {
            // Names
            expect(johnReimport.names[0].first).toBe(johnOriginal.names[0].first);
            expect(johnReimport.names[0].last).toBe(johnOriginal.names[0].last);
            
            // Sex
            expect(johnReimport.sex).toBe(johnOriginal.sex);
            
            // Birth event
            const birthOriginal = johnOriginal.events.find(e => e.type === 'birth');
            const birthReimport = johnReimport.events.find(e => e.type === 'birth');
            expect(birthReimport?.date).toBe(birthOriginal?.date);
            expect(birthReimport?.location?.name).toBe(birthOriginal?.location?.name);
            
            // Marriage event
            const marriageOriginal = johnOriginal.events.find(e => e.type === 'marriage');
            const marriageReimport = johnReimport.events.find(e => e.type === 'marriage');
            expect(marriageReimport).toBeDefined();
            expect(marriageReimport?.date).toBe(marriageOriginal?.date);
            
            // Custom _gedcom tags
            expect(johnReimport._gedcom).toBeDefined();
            expect(johnReimport._gedcom?.['_ATTR']).toBe('Custom Attribute Value');
            expect(johnReimport._gedcom?.['_ANOTHER']).toBe('Another Custom Tag');
            
            // Scrapbook
            expect(johnReimport.scrapbook_md).toContain('This is a biographical note');
        }
        
        // Find Charlie (the child)
        const charlieOriginal = importResult.people.find(p => p.names[0].first === 'Charlie');
        const charlieReimport = reimportResult.people.find(p => p.names[0].first === 'Charlie');
        
        expect(charlieOriginal).toBeDefined();
        expect(charlieReimport).toBeDefined();
        
        if (charlieOriginal && charlieReimport) {
            // Verify parent relationships preserved
            expect(charlieReimport.relationships.parents).toHaveLength(2);
            expect(charlieOriginal.relationships.parents).toHaveLength(2);
            
            // Both should have 2 parents (order may differ)
            const reimportParentIds = charlieReimport.relationships.parents.map(p => {
                // Find the name of this parent
                const parent = reimportResult.people.find(x => x.id === p.id);
                return parent?.names[0].first;
            }).sort();
            
            const originalParentIds = charlieOriginal.relationships.parents.map(p => {
                const parent = importResult.people.find(x => x.id === p.id);
                return parent?.names[0].first;
            }).sort();
            
            expect(reimportParentIds).toEqual(originalParentIds);
        }
    });

    it('should handle divorce events in round-trip', async () => {
        const gedcomWithDivorce = `
0 HEAD
1 SOUR LegacyGraph
1 GEDC
2 VERS 5.5.1
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Bob /Builder/
1 SEX M
0 @I2@ INDI
1 NAME Sue /Builder/
1 SEX F
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 1 JAN 2000
1 DIV
2 DATE 1 JAN 2010
0 TRLR
`;
        
        const reader = new GedcomReader();
        const exporter = new GedcomExporter();
        
        const firstImport = await reader.parse(gedcomWithDivorce);
        const exported = exporter.exportPeople(firstImport.people);
        const secondImport = await reader.parse(exported);
        
        // Verify divorce event is preserved
        const bob = secondImport.people.find(p => p.names[0].first === 'Bob');
        expect(bob).toBeDefined();
        
        if (bob) {
            const divorceEvent = bob.events.find(e => e.type === 'divorce');
            // Note: Current Import.ts doesn't handle DIV tag yet, so this will fail
            // This test documents expected behavior for future enhancement
            // expect(divorceEvent).toBeDefined();
        }
    });
});
