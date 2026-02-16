import { Document } from 'flexsearch';
import Graph from 'graphology';
import { Person } from '../schemas/PersonSchema';
import { Story } from './StoryLoader';

export interface SearchResult {
    id: string;
    type: 'person' | 'story';
    name: string;
    snippet?: string;
}

export interface PlaceResult {
    location: string;
    count: number;
}

export interface SearchResponse {
    people: SearchResult[];
    stories: SearchResult[];
    places: PlaceResult[];
}

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
    private personIndex: Document<PersonIndexDoc, true>;
    private storyIndex: Document<StoryIndexDoc, true>;
    private placeMap: Map<string, Set<string>> = new Map(); // location -> set of personIds

    constructor() {
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

        this.storyIndex = new Document({
            document: {
                id: "id",
                index: ["title", "content"],
                store: true
            },
            tokenize: "forward"
        });
    }

    /**
     * Completely rebuilds all indices from the Graph.
     * Called on Hydration.
     */
    public async rebuild(graph: Graph): Promise<void> {
        this.placeMap.clear();

        graph.forEachNode((node, attributes) => {
            if (attributes.type === 'person') {
                this.indexPerson(attributes.data as Person);
            } else if (attributes.type === 'story') {
                this.indexStory(attributes.data as Story);
            }
        });
    }

    /**
     * Index or update a person in the search index and place map.
     * Removes stale entries first to prevent ghost matches.
     */
    public indexPerson(p: Person) {
        // Remove old place entries for this person
        this.removePersonPlaces(p.id);

        // Remove old search entry (prevents stale matches on name change)
        try { this.personIndex.remove(p.id); } catch { /* might not exist */ }

        // Flatten locations for full-text search
        const locations = p.events
            .map(e => e.location)
            .filter(Boolean)
            .join(" ");

        const bio = p.scrapbook_md || "";

        this.personIndex.add({
            id: p.id,
            names: p.names,
            bio: bio,
            locations: locations
        });

        // Update place map
        this.extractPlaces(p);
    }

    /**
     * Remove a person from the search index and place map.
     */
    public removePerson(id: string) {
        try { this.personIndex.remove(id); } catch { /* might not exist */ }
        this.removePersonPlaces(id);
    }

    /**
     * Index a story in the search index.
     */
    public indexStory(story: Story) {
        try { this.storyIndex.remove(story.id); } catch { /* might not exist */ }

        this.storyIndex.add({
            id: story.id,
            title: story.metadata.title,
            content: story.content
        });
    }

    /**
     * Remove a story from the search index.
     */
    public removeStory(id: string) {
        try { this.storyIndex.remove(id); } catch { /* might not exist */ }
    }

    /**
     * Full-text search across people, stories, and places.
     */
    public async search(query: string): Promise<SearchResponse> {
        const response: SearchResponse = { people: [], stories: [], places: [] };

        // 1. Search People
        const personResults = await this.personIndex.searchAsync(query, {
            enrich: true,
        });

        const peopleMap = new Map<string, SearchResult>();
        personResults.forEach(fieldResult => {
            fieldResult.result.forEach((item: any) => {
                if (!peopleMap.has(item.id)) {
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

        // 2. Search Stories
        const storyResults = await this.storyIndex.searchAsync(query, {
            enrich: true,
        });

        const storyMap = new Map<string, SearchResult>();
        storyResults.forEach(fieldResult => {
            fieldResult.result.forEach((item: any) => {
                if (!storyMap.has(item.id)) {
                    storyMap.set(item.id, {
                        id: item.id as string,
                        type: 'story',
                        name: item.doc.title || item.id
                    });
                }
            });
        });
        response.stories = Array.from(storyMap.values());

        // 3. Search Places (case-insensitive substring match)
        const lowerQuery = query.toLowerCase();
        for (const [location, personIds] of this.placeMap) {
            if (location.toLowerCase().includes(lowerQuery)) {
                response.places.push({
                    location,
                    count: personIds.size
                });
            }
        }

        return response;
    }

    /**
     * Extract unique locations from a person's events and add to the place map.
     */
    private extractPlaces(p: Person): void {
        p.events.forEach(e => {
            if (e.location) {
                if (!this.placeMap.has(e.location)) {
                    this.placeMap.set(e.location, new Set());
                }
                this.placeMap.get(e.location)!.add(p.id);
            }
        });
    }

    /**
     * Remove a person's entries from the place map.
     */
    private removePersonPlaces(personId: string): void {
        const toDelete: string[] = [];
        for (const [location, personIds] of this.placeMap) {
            personIds.delete(personId);
            if (personIds.size === 0) {
                toDelete.push(location);
            }
        }
        toDelete.forEach(loc => this.placeMap.delete(loc));
    }
}
