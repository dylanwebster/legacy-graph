import { Person } from '../../schemas/PersonSchema';
import * as crypto from 'crypto';
import { parseDate } from '../../utils/dateParser';
import { generatePersonId } from '../../utils/idGenerator';

// --- Custom GEDCOM Parser Types ---

interface GedcomLine {
    level: number;
    tag: string; // e.g. INDI, BIRT, DATE
    value?: string; // e.g. "10 JAN 1980" or "@I1@" if pointer is in value position? 
                   // Actually standard is: Level [Optional Xref] Tag [Optional LineValue]
    xref_id?: string; // The pointer @I1@ defined at start of line
}

interface GedcomNode {
    tag: string;
    value?: string;
    xref_id?: string;
    children: GedcomNode[];
}

export interface ImportResult {
    people: Person[];
    warnings: string[];
}

export class GedcomReader {
    
    /**
     * Parses a GEDCOM string (or buffer) into an in-memory graph of Person objects.
     */
    public async parse(input: string | Buffer): Promise<ImportResult> {
        const raw = input.toString();
        const lines = raw.split(/\r?\n/);
        
        const roots: GedcomNode[] = [];
        const stack: { node: GedcomNode, level: number }[] = [];

        // 1. Build CST (Tree)
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const parsed = this.parseLine(line);
            if (!parsed) continue;

            const node: GedcomNode = {
                tag: parsed.tag,
                value: parsed.value,
                xref_id: parsed.xref_id,
                children: []
            };

            if (parsed.level === 0) {
                roots.push(node);
                stack.length = 0; // Reset stack
                stack.push({ node, level: 0 });
            } else {
                // Find parent (first item in stack with level < current level)
                // Actually, standard is parent level = current - 1
                while (stack.length > 0 && stack[stack.length - 1].level >= parsed.level) {
                   stack.pop();
                }
                
                if (stack.length > 0) {
                    const parent = stack[stack.length - 1].node;
                    parent.children.push(node);
                    stack.push({ node, level: parsed.level });
                } else {
                    // Orphan node (shouldn't happen in valid GEDCOM)
                    // We ignore or treat as root? Treat as root for robustness.
                    roots.push(node);
                    stack.push({ node, level: parsed.level });
                }
            }
        }

        // 2. Process Tree
        return this.processTree(roots);
    }

    private parseLine(line: string): GedcomLine | null {
        // Format: Level [Optional Xref] Tag [Optional LineValue]
        // Regex: ^(\d+)\s+(@\w+@)?\s*(\w+)(\s+(.*))?$
        // Note: Xref IDs can contain anything, usually alphanum. Tag is alphanum.
        
        const match = line.match(/^(\d+)\s+(?:(@[^@]+@)\s+)?(\w+)(?:\s+(.*))?$/);
        if (!match) return null;

        return {
            level: parseInt(match[1], 10),
            xref_id: match[2],     // @I1@
            tag: match[3],         // INDI
            value: match[4]        // Rest of line
        };
    }

    private processTree(roots: GedcomNode[]): ImportResult {
        const people: Person[] = [];
        const warnings: string[] = [];
        const idMap = new Map<string, string>(); // @I1@ -> N_...

        // Pass 1: INDI records -> Persons
        roots.filter(n => n.tag === 'INDI').forEach(node => {
            if (!node.xref_id) return;

            const p: Person = {
                version: "5.0",
                id: '', // filled after mapIndi so we have name + events
                created: new Date().toISOString(),
                last_modified: new Date().toISOString(),
                names: [],
                events: [],
                assets: [],
                relationships: { parents: [] },
                sex: "U",
                tags: ["gedcom"],
                scrapbook_md: "",
                _gedcom: {}
            };

            this.mapIndi(node, p);

            const newId = generatePersonId(p);
            p.id = newId;
            idMap.set(node.xref_id, newId);
            people.push(p);
        });

        // Pass 2: FAM records -> Marriages and Parent-Child Links
        roots.filter(n => n.tag === 'FAM').forEach(node => {
            const husbRef = this.getChildValue(node, 'HUSB'); // @I1@
            const wifeRef = this.getChildValue(node, 'WIFE'); // @I2@
            
            const fatherId = husbRef ? idMap.get(husbRef) : undefined;
            const motherId = wifeRef ? idMap.get(wifeRef) : undefined;

            // 2a. Marriage Event — create even when no MARR record exists (use empty date)
            const marrNode = node.children.find(c => c.tag === 'MARR');
            if (fatherId && motherId) {
                const date = marrNode ? (this.getChildValue(marrNode, 'DATE') || "") : "";
                const place = marrNode ? (this.getChildValue(marrNode, 'PLAC') || "") : "";
                const sortDate = parseDate(date);

                // Add to Husband
                const h = people.find(x => x.id === fatherId);
                if (h) {
                    h.events.push({
                        id: crypto.randomUUID(), type: 'marriage', date, sort_date: sortDate, location: place, assets: [],
                        partner_id: motherId, status: 'married'
                    });
                }

                // Add to Wife
                const w = people.find(x => x.id === motherId);
                if (w) {
                    w.events.push({
                        id: crypto.randomUUID(), type: 'marriage', date, sort_date: sortDate, location: place, assets: [],
                        partner_id: fatherId, status: 'married'
                    });
                }
            }

            // 2b. Parent-Child Relationships (The new robust logic)
            // Iterate all CHIL tags
            node.children.filter(c => c.tag === 'CHIL').forEach(childNode => {
                 const childRef = childNode.value;
                 const childId = childRef ? idMap.get(childRef) : undefined;
                 
                 if (childId) {
                     const child = people.find(p => p.id === childId);
                     if (child) {
                         if (fatherId) {
                             child.relationships.parents.push({ id: fatherId, type: 'biological' });
                         }
                         if (motherId) {
                             child.relationships.parents.push({ id: motherId, type: 'biological' });
                         }
                     }
                 }
            });
        });

        return { people, warnings };
    }

    private mapIndi(node: GedcomNode, p: Person) {
        // Name
        const nameVal = this.getChildValue(node, 'NAME');
        if (nameVal) {
             // "John /Doe/"
             const parts = nameVal.split('/').map(s => s.trim());
             p.names.push({
                 first: parts[0] || "?",
                 last: parts[1] || "?",
                 primary: true
             });
        }

        // Sex
        const sex = this.getChildValue(node, 'SEX');
        if (sex === 'M') p.sex = 'M';
        if (sex === 'F') p.sex = 'F';

        // Events
        const eventTags: Record<string, string> = {
            'BIRT': 'birth', 'DEAT': 'death', 'CHR': 'baptism', 'BURI': 'burial'
        };

        node.children.forEach(child => {
            if (eventTags[child.tag]) {
                const date = this.getChildValue(child, 'DATE') || "";
                const place = this.getChildValue(child, 'PLAC') || "";
                p.events.push({
                    id: crypto.randomUUID(),
                    type: eventTags[child.tag] as any,
                    date: date,
                    sort_date: parseDate(date),
                    location: place,
                    assets: []
                });
            } else if (child.tag === 'NOTE') {
                if (child.value) {
                    p.scrapbook_md += (p.scrapbook_md ? "\n\n" : "") + child.value;
                }
                // Handle CONC/CONT if they exist as children of NOTE
                // For simplicity, ignoring deep concatenation now, but it's important for robustness.
            } else if (!['NAME', 'SEX', 'FAMC', 'FAMS'].includes(child.tag)) {
                // Capture generic attributes
                if (p._gedcom) {
                    p._gedcom[child.tag] = child.value;
                }
            }
        });
    }

    private getChildValue(node: GedcomNode, tag: string): string | undefined {
        const child = node.children.find(c => c.tag === tag);
        return child ? child.value : undefined;
    }

    // parseDate removed in favor of shared utility
}
