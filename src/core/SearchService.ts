import { Document } from 'flexsearch';
import Graph from 'graphology';
import * as fs from 'fs/promises';
import { Person, SlimPerson } from '../schemas/PersonSchema';
import { Story } from './StoryLoader';
import { CACHE_SPEC_VERSION } from './GraphCache';

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

export interface PaginationOptions {
    limit?: number;  // Default: 50, max: 200
    offset?: number; // Default: 0
}

export interface SearchResponse {
    people: SearchResult[];
    stories: SearchResult[];
    places: PlaceResult[];
    totalCounts: {
        people: number;
        stories: number;
        places: number;
    };
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
     *
     * @param p - Person or SlimPerson data
     * @param bio - Scrapbook markdown for bio indexing. If omitted, falls back to
     *              p.scrapbook_md (when p is a full Person) or empty string (when p is SlimPerson).
     */
    public indexPerson(p: Person | SlimPerson, bio?: string) {
        // Remove old place entries for this person
        this.removePersonPlaces(p.id);

        // Remove old search entry (prevents stale matches on name change)
        try { this.personIndex.remove(p.id); } catch { /* might not exist */ }

        // Flatten locations for full-text search
        const locations = p.events
            .map(e => e.location)
            .filter(Boolean)
            .join(" ");

        const bioText = bio ?? ((p as any).scrapbook_md || '');

        this.personIndex.add({
            id: p.id,
            names: p.names,
            bio: bioText,
            locations: locations
        });

        // Update place map
        this.extractPlaces(p as Person);
        this.trackPerson(p.id);
    }

    /**
     * Remove a person from the search index and place map.
     */
    public removePerson(id: string) {
        try { this.personIndex.remove(id); } catch { /* might not exist */ }
        this.removePersonPlaces(id);
        this.untrackPerson(id);
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
        this.trackStory(story.id);
    }

    /**
     * Remove a story from the search index.
     */
    public removeStory(id: string) {
        try { this.storyIndex.remove(id); } catch { /* might not exist */ }
    }

    /**
     * Full-text search across people, stories, and places.
     * Supports pagination via optional limit/offset parameters.
     */
    public async search(query: string, options?: PaginationOptions): Promise<SearchResponse> {
        const limit = Math.min(options?.limit ?? 50, 200);
        const offset = options?.offset ?? 0;

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
        const allPeople = Array.from(peopleMap.values());

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
        const allStories = Array.from(storyMap.values());

        // 3. Search Places (case-insensitive substring match)
        const allPlaces: PlaceResult[] = [];
        const lowerQuery = query.toLowerCase();
        for (const [location, personIds] of this.placeMap) {
            if (location.toLowerCase().includes(lowerQuery)) {
                allPlaces.push({
                    location,
                    count: personIds.size
                });
            }
        }

        // 4. Build response with totalCounts and pagination
        return {
            people: allPeople.slice(offset, offset + limit),
            stories: allStories.slice(offset, offset + limit),
            places: allPlaces.slice(offset, offset + limit),
            totalCounts: {
                people: allPeople.length,
                stories: allStories.length,
                places: allPlaces.length
            }
        };
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

    /**
     * Export the search index to disk for persistence across boots.
     * Serializes FlexSearch person/story indexes, place map, and tracked IDs.
     */
    public async exportIndex(filePath: string): Promise<void> {
        const personExport: Record<string, any> = {};
        this.personIndex.export(function(key: string, data: any) {
            personExport[key] = data;
        });

        const storyExport: Record<string, any> = {};
        this.storyIndex.export(function(key: string, data: any) {
            storyExport[key] = data;
        });

        // FlexSearch export is synchronous — give a tick for completion
        await new Promise(r => setTimeout(r, 10));

        const placeMapSerialized: Array<[string, string[]]> = [];
        for (const [loc, ids] of this.placeMap) {
            placeMapSerialized.push([loc, Array.from(ids)]);
        }

        const data = {
            spec_version: CACHE_SPEC_VERSION,
            exportedAt: new Date().toISOString(),
            personIds: this.trackedPersonIds,
            storyIds: this.trackedStoryIds,
            personIndex: personExport,
            storyIndex: storyExport,
            placeMap: placeMapSerialized
        };

        const dir = filePath.substring(0, filePath.lastIndexOf('/'));
        if (dir) await fs.mkdir(dir, { recursive: true }).catch(() => {});
        await fs.writeFile(filePath, JSON.stringify(data), 'utf8');
    }

    /**
     * Import a previously exported search index from disk.
     * Returns the set of person IDs that were in the old index (for deletion tracking),
     * or null if the cache is invalid/missing.
     */
    public async importIndex(filePath: string): Promise<{ personIds: string[]; storyIds: string[] } | null> {
        try {
            const content = await fs.readFile(filePath, 'utf8');
            const data = JSON.parse(content);

            if (!data || data.spec_version !== CACHE_SPEC_VERSION) return null;
            if (!data.personIndex || !data.storyIndex) return null;

            // Import person index
            for (const [key, val] of Object.entries(data.personIndex)) {
                this.personIndex.import(key, val as any);
            }

            // Import story index
            for (const [key, val] of Object.entries(data.storyIndex)) {
                this.storyIndex.import(key, val as any);
            }

            // Import place map
            if (Array.isArray(data.placeMap)) {
                this.placeMap.clear();
                for (const [loc, ids] of data.placeMap) {
                    this.placeMap.set(loc, new Set(ids));
                }
            }

            // Restore tracked IDs
            this.trackedPersonIds = data.personIds || [];
            this.trackedStoryIds = data.storyIds || [];

            return {
                personIds: data.personIds || [],
                storyIds: data.storyIds || []
            };
        } catch {
            return null;
        }
    }

    private trackedPersonIds: string[] = [];
    private trackedStoryIds: string[] = [];

    /**
     * Track a person ID for export persistence.
     */
    public trackPerson(id: string): void {
        if (!this.trackedPersonIds.includes(id)) {
            this.trackedPersonIds.push(id);
        }
    }

    /**
     * Untrack a removed person ID.
     */
    public untrackPerson(id: string): void {
        this.trackedPersonIds = this.trackedPersonIds.filter(pid => pid !== id);
    }

    /**
     * Track a story ID for export persistence.
     */
    public trackStory(id: string): void {
        if (!this.trackedStoryIds.includes(id)) {
            this.trackedStoryIds.push(id);
        }
    }
}
