import { Document } from 'flexsearch';
import Graph from 'graphology';
import { Person } from '../schemas/PersonSchema';

export interface SearchResult {
    id: string;
    type: 'person' | 'story';
    name: string; // or Title
    snippet?: string;
}

export interface SearchResponse {
    people: SearchResult[];
    stories: SearchResult[];
}

// Define the shape of our doc
interface PersonIndexDoc {
    id: string;
    names: any[];
    bio: string;
    locations: string;
    [key: string]: any;
}

interface StoryIndexDoc {
    id: string;
    title: string;
    content: string;
    [key: string]: any;
}

export class SearchService {
    // FlexSearch Types are a bit tricky in TS, using loose typing for now to pass build
    private personIndex: Document<PersonIndexDoc, true>;
    private storyIndex: Document<StoryIndexDoc, true>;

    constructor() {
        // Document Index for structured data
        this.personIndex = new Document({
            document: {
                id: "id",
                index: [
                    "names:first", 
                    "names:last", 
                    "names:nickname",
                    "bio", 
                    "locations"
                ],
                store: true 
            },
            tokenize: "forward"
        });

        // Separate index for stories (different schema)
        this.storyIndex = new Document({
            document: {
                id: "id",
                index: ["title", "content"],
            },
            tokenize: "forward"
        });
    }

    /**
     * Completely rebuilds the in-memory index from the Graph.
     * Called on Hydration.
     */
    public async rebuild(graph: Graph): Promise<void> {
        // Clear is not easily supported in FlexSearch without re-creation or extensive deletion.
        // For now, we assume `rebuild` is called on fresh start or we define "nuclear" clear later.
        // For hot-patching, we use indexPerson/removePerson.
        
        graph.forEachNode((node, attributes) => {
            if (attributes.type === 'person') {
                this.indexPerson(attributes.data as Person);
            }
            // TODO: attributes.type === 'story'
        });
    }

    public indexPerson(p: Person) {
        // Flatten locations
        const locations = p.events
            .map(e => e.location)
            .filter(Boolean)
            .join(" ");

        // Flatten Bio
        const bio = p.scrapbook_md || "";

        const doc = {
            id: p.id,
            names: p.names,
            bio: bio,
            locations: locations
        };

        this.personIndex.add(doc);
    }

    public removePerson(id: string) {
        this.personIndex.remove(id);
    }

    public async search(query: string): Promise<SearchResponse> {
        const response: SearchResponse = { people: [], stories: [] };

        // Search People
        // index.search(query, options)
        const personResults = await this.personIndex.searchAsync(query, {
            enrich: true,
             // limit: 10
        });

        // FlexSearch "enrich: true" returns [{ field: 'names:first', result: [ { id: 'N_ALAN', doc: ... } ] }]
        // We need to deduplicate because a match in 'first name' and 'last name' returns two entries.
        const peopleMap = new Map<string, SearchResult>();

        personResults.forEach(fieldResult => {
            fieldResult.result.forEach((item: any) => {
                if (!peopleMap.has(item.id)) {
                    // Extract Name for display
                    // The 'doc' might not be fully stored unless we set store: ['names'] etc.
                    // But we set store: true globally in config.
                    
                    // We need to reconstruct a display name.
                    // Since 'item.doc' is the object passed to .add()
                    const rawNames = item.doc.names;
                    const primary = rawNames.find((n: any) => n.primary) || rawNames[0];
                    const displayName = `${primary.first} ${primary.last}`;

                    peopleMap.set(item.id, {
                        id: item.id as string,
                        type: 'person',
                        name: displayName
                    });
                }
            });
        });

        response.people = Array.from(peopleMap.values());
        
        return response;
    }
}
