import { Person } from '../../schemas/PersonSchema';

export interface FamilyRecord {
    id: string;
    husband?: string;
    wife?: string;
    children: string[];
    marriage?: {
        date: string;
        location: string;
    };
}

export class GedcomExporter {
    
    /**
     * Exports an array of Person objects to a valid GEDCOM 5.5.1 string.
     */
    public exportPeople(people: Person[]): string {
        const lines: string[] = [];
        
        // Header
        lines.push("0 HEAD");
        lines.push("1 SOUR LegacyGraph");
        lines.push("2 VERS 1.0.0");
        lines.push("2 NAME LegacyGraph");
        lines.push("1 GEDC");
        lines.push("2 VERS 5.5.1");
        lines.push("2 FORM LINEAGE-LINKED");
        lines.push("1 CHAR UTF-8");
        lines.push("1 DATE " + new Date().toISOString().split('T')[0]);
        
        // Individual Records
        people.forEach(person => {
            this.exportIndividual(person, lines);
        });
        
        // Family Records
        const families = this.buildFamilyRecords(people);
        families.forEach(family => {
            this.exportFamily(family, lines);
        });
        
        // Trailer
        lines.push("0 TRLR");
        
        return lines.join('\n');
    }
    
    private exportIndividual(person: Person, lines: string[]): void {
        lines.push(`0 @${person.id}@ INDI`);
        
        // Name
        const primaryName = person.names.find(n => n.primary) || person.names[0];
        if (primaryName) {
            const nameStr = `${primaryName.first} /${primaryName.last}/`;
            lines.push(`1 NAME ${nameStr}`);
            if (primaryName.nickname) {
                lines.push(`2 NICK ${primaryName.nickname}`);
            }
        }
        
        // Sex
        lines.push(`1 SEX ${person.sex}`);
        
        // Events (non-marriage)
        const eventMapping: Record<string, string> = {
            'birth': 'BIRT',
            'death': 'DEAT',
            'baptism': 'CHR',
            'burial': 'BURI',
            'census': 'CENS',
            'residence': 'RESI',
            'occupation': 'OCCU',
            'education': 'EDUC'
        };
        
        person.events.forEach(event => {
            if (event.type === 'marriage' || event.type === 'divorce') {
                // Handled in FAM records
                return;
            }
            
            const tag = eventMapping[event.type];
            if (tag) {
                lines.push(`1 ${tag}`);
                if (event.date) {
                    lines.push(`2 DATE ${event.date}`);
                }
                if (event.location?.name) {
                    lines.push(`2 PLAC ${event.location.name}`);
                }

                // Death cause
                if (event.type === 'death' && 'cause' in event && event.cause) {
                    lines.push(`2 CAUS ${event.cause}`);
                }
                
                // Occupation details
                if (event.type === 'occupation') {
                    if ('title' in event && event.title) {
                        lines.push(`2 NOTE Title: ${event.title}`);
                    }
                    if ('organization' in event && event.organization) {
                        lines.push(`2 NOTE Organization: ${event.organization}`);
                    }
                }
                
                // Education details
                if (event.type === 'education') {
                    if ('institution' in event && event.institution) {
                        lines.push(`2 NOTE Institution: ${event.institution}`);
                    }
                    if ('degree' in event && event.degree) {
                        lines.push(`2 NOTE Degree: ${event.degree}`);
                    }
                }
            } else if (event.type === 'generic') {
                // Generic events as EVEN
                lines.push(`1 EVEN`);
                if ('title' in event && event.title) {
                    lines.push(`2 TYPE ${event.title}`);
                }
                if (event.date) {
                    lines.push(`2 DATE ${event.date}`);
                }
                if (event.location?.name) {
                    lines.push(`2 PLAC ${event.location.name}`);
                }
            }
        });

        // Scrapbook as NOTE
        if (person.scrapbook_md && person.scrapbook_md.trim()) {
            lines.push(`1 NOTE ${person.scrapbook_md.trim()}`);
        }
        
        // Re-emit preserved _gedcom tags
        if (person._gedcom) {
            Object.entries(person._gedcom).forEach(([tag, value]) => {
                if (value !== undefined && value !== null) {
                    lines.push(`1 ${tag} ${value}`);
                }
            });
        }
        
        // Family links (references to FAM records)
        // These will be generated when we export FAM records
        // For now, we'll add FAMC (child) and FAMS (spouse) refs in the FAM export phase
    }
    
    private buildFamilyRecords(people: Person[]): FamilyRecord[] {
        const families: FamilyRecord[] = [];
        const familyMap = new Map<string, FamilyRecord>();
        
        // Pass 1: Build parent-child families
        people.forEach(person => {
            if (person.relationships.parents.length > 0) {
                // Find or create a family for this person's parents
                const parents = person.relationships.parents;
                const father = parents.find(p => {
                    const parent = people.find(x => x.id === p.id);
                    return parent?.sex === 'M';
                });
                const mother = parents.find(p => {
                    const parent = people.find(x => x.id === p.id);
                    return parent?.sex === 'F';
                });
                
                const familyKey = `${father?.id || 'none'}_${mother?.id || 'none'}`;
                
                let family = familyMap.get(familyKey);
                if (!family) {
                    family = {
                        id: `F${Math.random().toString(36).substring(2, 9)}`,
                        husband: father?.id,
                        wife: mother?.id,
                        children: []
                    };
                    familyMap.set(familyKey, family);
                    families.push(family);
                }
                
                if (!family.children.includes(person.id)) {
                    family.children.push(person.id);
                }
            }
        });
        
        // Pass 2: Add marriage events to families or create new ones
        const processedMarriages = new Set<string>();
        
        people.forEach(person => {
            person.events.forEach(event => {
                if (event.type === 'marriage' && 'partner_id' in event && event.partner_id) {
                    const partnerId = event.partner_id;
                    const partner = people.find(p => p.id === partnerId);
                    
                    // Create a unique key for this marriage (sorted to avoid duplicates)
                    const marriageKey = [person.id, partnerId].sort().join('_');
                    
                    if (processedMarriages.has(marriageKey)) {
                        return; // Already processed
                    }
                    processedMarriages.add(marriageKey);
                    
                    // Find if there's already a family for these parents
                    const husband = person.sex === 'M' ? person.id : partnerId;
                    const wife = person.sex === 'F' ? person.id : partnerId;
                    
                    const familyKey = `${husband}_${wife}`;
                    let family = familyMap.get(familyKey);
                    
                    if (!family) {
                        // Create new family record
                        family = {
                            id: `F${Math.random().toString(36).substring(2, 9)}`,
                            husband: husband,
                            wife: wife,
                            children: [],
                            marriage: {
                                date: event.date || '',
                                location: event.location?.name || ''
                            }
                        };
                        familyMap.set(familyKey, family);
                        families.push(family);
                    } else if (!family.marriage) {
                        // Add marriage data to existing family
                        family.marriage = {
                            date: event.date || '',
                            location: event.location?.name || ''
                        };
                    }
                }
            });
        });
        
        return families;
    }
    
    private exportFamily(family: FamilyRecord, lines: string[]): void {
        lines.push(`0 @${family.id}@ FAM`);
        
        if (family.husband) {
            lines.push(`1 HUSB @${family.husband}@`);
        }
        
        if (family.wife) {
            lines.push(`1 WIFE @${family.wife}@`);
        }
        
        if (family.marriage) {
            lines.push(`1 MARR`);
            if (family.marriage.date) {
                lines.push(`2 DATE ${family.marriage.date}`);
            }
            if (family.marriage.location) {
                lines.push(`2 PLAC ${family.marriage.location}`);
            }
        }
        
        family.children.forEach(childId => {
            lines.push(`1 CHIL @${childId}@`);
        });
    }
}
