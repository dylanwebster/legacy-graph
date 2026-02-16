import { describe, it, expect, beforeEach } from 'vitest';
import { GedcomExporter } from '../../../src/core/gedcom/Export';
import { Person } from '../../../src/schemas/PersonSchema';
import { DirectedGraph } from 'graphology';

describe('GedcomExporter', () => {
    let exporter: GedcomExporter;

    beforeEach(() => {
        exporter = new GedcomExporter();
    });

    it('should export a single Person to a valid INDI record', () => {
        const person: Person = {
            version: "5.0",
            id: "N_test123",
            created: "2024-01-01T00:00:00.000Z",
            last_modified: "2024-01-01T00:00:00.000Z",
            names: [{ first: "John", last: "Doe", primary: true }],
            sex: "M",
            tags: [],
            relationships: { parents: [] },
            events: [
                {
                    id: "evt1",
                    type: "birth",
                    date: "10 JAN 1980",
                    sort_date: "1980-01-10",
                    location: "Springfield, IL",
                    assets: []
                }
            ],
            assets: [],
            scrapbook_md: "",
        };

        const gedcom = exporter.exportPeople([person]);

        // Verify GEDCOM structure
        expect(gedcom).toContain("0 HEAD");
        expect(gedcom).toContain("1 SOUR LegacyGraph");
        expect(gedcom).toContain("2 VERS 5.5.1");
        expect(gedcom).toContain("1 CHAR UTF-8");
        
        // Verify INDI record
        expect(gedcom).toContain("0 @N_test123@ INDI");
        expect(gedcom).toContain("1 NAME John /Doe/");
        expect(gedcom).toContain("1 SEX M");
        expect(gedcom).toContain("1 BIRT");
        expect(gedcom).toContain("2 DATE 10 JAN 1980");
        expect(gedcom).toContain("2 PLAC Springfield, IL");
        
        // Verify TRLR
        expect(gedcom).toContain("0 TRLR");
    });

    it('should export marriage events as FAM records', () => {
        const john: Person = {
            version: "5.0",
            id: "N_john",
            created: "2024-01-01T00:00:00.000Z",
            last_modified: "2024-01-01T00:00:00.000Z",
            names: [{ first: "John", last: "Doe", primary: true }],
            sex: "M",
            tags: [],
            relationships: { parents: [] },
            events: [
                {
                    id: "evt1",
                    type: "marriage",
                    date: "1 JUN 2000",
                    sort_date: "2000-06-01",
                    location: "Boston, MA",
                    assets: [],
                    partner_id: "N_jane",
                    status: "married"
                }
            ],
            assets: [],
            scrapbook_md: "",
        };

        const jane: Person = {
            version: "5.0",
            id: "N_jane",
            created: "2024-01-01T00:00:00.000Z",
            last_modified: "2024-01-01T00:00:00.000Z",
            names: [{ first: "Jane", last: "Smith", primary: true }],
            sex: "F",
            tags: [],
            relationships: { parents: [] },
            events: [
                {
                    id: "evt2",
                    type: "marriage",
                    date: "1 JUN 2000",
                    sort_date: "2000-06-01",
                    location: "Boston, MA",
                    assets: [],
                    partner_id: "N_john",
                    status: "married"
                }
            ],
            assets: [],
            scrapbook_md: "",
        };

        const gedcom = exporter.exportPeople([john, jane]);

        // Verify FAM record exists
        expect(gedcom).toMatch(/0 @F\w+@ FAM/);
        expect(gedcom).toContain("1 HUSB @N_john@");
        expect(gedcom).toContain("1 WIFE @N_jane@");
        expect(gedcom).toContain("1 MARR");
        expect(gedcom).toContain("2 DATE 1 JUN 2000");
        expect(gedcom).toContain("2 PLAC Boston, MA");
    });

    it('should export parent-child relationships as FAM records', () => {
        const father: Person = {
            version: "5.0",
            id: "N_father",
            created: "2024-01-01T00:00:00.000Z",
            last_modified: "2024-01-01T00:00:00.000Z",
            names: [{ first: "Bob", last: "Smith", primary: true }],
            sex: "M",
            tags: [],
            relationships: { parents: [] },
            events: [],
            assets: [],
            scrapbook_md: "",
        };

        const mother: Person = {
            version: "5.0",
            id: "N_mother",
            created: "2024-01-01T00:00:00.000Z",
            last_modified: "2024-01-01T00:00:00.000Z",
            names: [{ first: "Alice", last: "Smith", primary: true }],
            sex: "F",
            tags: [],
            relationships: { parents: [] },
            events: [],
            assets: [],
            scrapbook_md: "",
        };

        const child: Person = {
            version: "5.0",
            id: "N_child",
            created: "2024-01-01T00:00:00.000Z",
            last_modified: "2024-01-01T00:00:00.000Z",
            names: [{ first: "Charlie", last: "Smith", primary: true }],
            sex: "M",
            tags: [],
            relationships: {
                parents: [
                    { id: "N_father", type: "biological" },
                    { id: "N_mother", type: "biological" }
                ]
            },
            events: [],
            assets: [],
            scrapbook_md: "",
        };

        const gedcom = exporter.exportPeople([father, mother, child]);

        // Verify FAM record with CHIL
        expect(gedcom).toMatch(/0 @F\w+@ FAM/);
        expect(gedcom).toContain("1 HUSB @N_father@");
        expect(gedcom).toContain("1 WIFE @N_mother@");
        expect(gedcom).toContain("1 CHIL @N_child@");
    });

    it('should preserve _gedcom custom tags on round-trip', () => {
        const person: Person = {
            version: "5.0",
            id: "N_test456",
            created: "2024-01-01T00:00:00.000Z",
            last_modified: "2024-01-01T00:00:00.000Z",
            names: [{ first: "Jane", last: "Roe", primary: true }],
            sex: "F",
            tags: [],
            relationships: { parents: [] },
            events: [],
            assets: [],
            scrapbook_md: "Some notes",
            _gedcom: {
                "_ATTR": "Green Eyes",
                "_CUSTOM": "CustomValue"
            }
        };

        const gedcom = exporter.exportPeople([person]);

        // Verify custom tags are re-emitted
        expect(gedcom).toContain("1 _ATTR Green Eyes");
        expect(gedcom).toContain("1 _CUSTOM CustomValue");
        
        // Verify NOTE for scrapbook_md
        expect(gedcom).toContain("1 NOTE Some notes");
    });

    it('should export all supported event types', () => {
        const person: Person = {
            version: "5.0",
            id: "N_events",
            created: "2024-01-01T00:00:00.000Z",
            last_modified: "2024-01-01T00:00:00.000Z",
            names: [{ first: "Test", last: "Person", primary: true }],
            sex: "U",
            tags: [],
            relationships: { parents: [] },
            events: [
                { id: "1", type: "birth", date: "1900", sort_date: "1900-01-01", location: "", assets: [] },
                { id: "2", type: "death", date: "1980", sort_date: "1980-01-01", location: "", assets: [], cause: "Old age" },
                { id: "3", type: "baptism", date: "1901", sort_date: "1901-01-01", location: "", assets: [] },
                { id: "4", type: "burial", date: "1981", sort_date: "1981-01-01", location: "", assets: [] },
            ],
            assets: [],
            scrapbook_md: "",
        };

        const gedcom = exporter.exportPeople([person]);

        expect(gedcom).toContain("1 BIRT");
        expect(gedcom).toContain("1 DEAT");
        expect(gedcom).toContain("1 CHR"); // baptism maps to CHR
        expect(gedcom).toContain("1 BURI");
    });

    it('should produce valid GEDCOM 5.5.1 format', () => {
        const person: Person = {
            version: "5.0",
            id: "N_valid",
            created: "2024-01-01T00:00:00.000Z",
            last_modified: "2024-01-01T00:00:00.000Z",
            names: [{ first: "Valid", last: "Test", primary: true }],
            sex: "M",
            tags: [],
            relationships: { parents: [] },
            events: [],
            assets: [],
            scrapbook_md: "",
        };

        const gedcom = exporter.exportPeople([person]);
        
        // Split into lines and verify structure
        const lines = gedcom.split('\n').filter(l => l.trim());
        
        // First line must be 0 HEAD
        expect(lines[0]).toBe("0 HEAD");
        
        // Last line must be 0 TRLR
        expect(lines[lines.length - 1]).toBe("0 TRLR");
        
        // All lines must match GEDCOM format: Level [Xref] Tag [Value]
        lines.forEach(line => {
            expect(line).toMatch(/^\d+(\s+@[^@]+@)?\s+\w+(\s+.*)?$/);
        });
    });
});
