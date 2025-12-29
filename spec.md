# **LegacyGraph: Master Technical Specification (v5.0)**

---

## **1. Executive Summary & Core Axioms**

LegacyGraph is a professional-grade, self-hosted genealogy platform. It rejects proprietary database "lock-in", treating family history as a durable, version-controlled, human-readable file system.

### **1.1 Core Axioms**

1.  **The "Notepad" Rule**: The database **IS** the file system. A user must be able to navigate, read, and understand their entire family history using only a basic text editor (VS Code, Notepad). The application is an _enhancer_, not a gatekeeper.
2.  **Git is the Undo Button**: Every discrete save action in the UI results in a Git commit.
3.  **Event-Sourced Truth**: Relationships (Spouse) are computed from Events (Marriage - Divorce), not stored as static fields.
4.  **Local-First Security**: Authentication is local. No cloud dependencies.
5.  **Data Density**: The UI prioritizes information density over whitespace (VS Code aesthetic).

### **1.2 Rules of Engagement**

*   **Spec First**: Before any code is checked in for subsequent phases of implementation, this spec document must be updated and kept up to date. Discrepancies between Spec and Code are treated as critical bugs.
*   **Test-Driven Design (TDD) IS MANDATORY**: You must write a failing test case before writing any implementation code. This ensures all logic is verifiable and requirements are explicitly understood before coding.
*   **Hybrid Hydration**: We use "Nuclear" hydration (reload all) on boot for safety, but **Granular Hot-Patching** (update specific nodes) during live updates for sub-100ms feedback.

---

## **2. System Architecture: The "Dual-Head" Pattern**

### **2.1 Head 1: The Source of Truth (Persistence)**

- **Storage**: Local File System.
- **Format**:
  - **Data**: YAML (`/people/*.yaml`) - Structured Person Data.
  - **Narrative**: Markdown (`/stories/*.md`) - Rich text stories/articles.
  - **Media**: Binary (`/assets/*`) - JPG, PNG, WEBP, PDF, MP4.
  - **Meta**: Indices (`/_meta/*.yaml`) - Global configuration and caches.
- **Control**: Hidden `.git` directory managing the entire state.

### **2.2 Head 2: The Experience (Runtime)**

- **Engine**: Node.js (Fastify) + Graphology (In-Memory Graph).
- **Behavior**:
  - **Nuclear Hydration**: On boot, the engine reads **all** files to build the graph in RAM.
  - **Hot-Patching**: `chokidar` watches the disk. Granular handlers (`add`, `change`, `unlink`) update/patch specific nodes in <100ms without full reloads.
  - **Indexing**: FlexSearch (In-Memory) for full-text search. Rebuilt on hydration and incrementally updated during hot-patching.

---

## **3. Data Layer Specification**

All data ingestion must pass strict Zod schemas. This ensures data integrity before it enters the runtime graph.

### **3.1 Person Schema (`/people/*.yaml`)**

**File Naming**: `N_[nanoid].yaml` (e.g., `N_7x9aZ2.yaml`).

| Field           | Type          | Description                                          |
| :-------------- | :------------ | :--------------------------------------------------- |
| `version`       | Literal "5.0" | Schema version for migration safety.                 |
| `id`            | String        | Unique ID, prefix `N_` + NanoID.                     |
| `created`       | ISO-8601      | Timestamp of creation.                               |
| `last_modified` | ISO-8601      | Timestamp of last edit.                              |
| `names`         | Array         | List of name objects.                                |
| `sex`           | Enum          | `M`, `F`, `I` (Intersex), `U` (Unknown).             |
| `tags`          | Array<String> | User-defined tags (e.g., "Civil War", "Immigrant").  |
| `relationships` | Object        | Stores **ONLY** upstream parents.                    |
| `events`        | Array         | Chronological life events (See 3.2).                 |
| `assets`        | Array<String> | Filenames of associated media. First item is Avatar. |
| `scrapbook_md`  | String        | Free-form Markdown for unstructured notes/scrapbook. |
| `_gedcom`       | Object        | Preserved unmapped tags from GEDCOM import.          |

**Detailed Schema Definition (Zod Notation):**

```typescript
{
  names: [{
    first: string,
    last: string,
    nickname?: string,
    primary?: boolean
  }],
  relationships: {
    parents: [{
      id: string, // Reference to Person ID
      type: "biological" | "adopted" | "step" | "foster"
    }]
  }
}
```

### **3.2 Event Architecture**

Events are typed objects acting as state reducers. They determine the "current status" of a person (especially for marriages).

**Base Event Fields**:

- `id`: String (NanoID).
- `date`: String (Fuzzy, e.g., "Bet. 1900 and 1910").
- `sort_date`: String (ISO-8601 strict: `YYYY-MM-DD`). Used for chronological ordering.
- `location`: String (Optional).
- `description`: String (Markdown supported, Optional).
- `assets`: Array<String> (Filenames).

**Supported Event Types**:

| Type         | Computed Logic / Extra Fields                                                         |
| :----------- | :------------------------------------------------------------------------------------ |
| `birth`      | Defines start of timeline.                                                            |
| `death`      | Defines end of timeline. Field: `cause` (string).                                     |
| `marriage`   | Links two people. Fields: `partner_id` (string), `status` (married/divorced/widowed). |
| `divorce`    | Terminates a marriage. Field: `partner_id` (string).                                  |
| `residence`  | Location history.                                                                     |
| `census`     | Census record. Field: `household_id` (string).                                        |
| `occupation` | Work history. Fields: `title`, `organization`.                                        |
| `education`  | Academic history. Fields: `institution`, `degree`.                                    |
| `baptism`    | Religious event.                                                                      |
| `burial`     | Final resting place.                                                                  |
| `generic`    | Custom events. Field: `title`.                                                        |

### **3.3 Asset Index (`/_meta/assets.yaml`)**

To avoid scanning thousands of binaries on boot, metadata is cached.

- **Structure**: Map of `Filename -> Metadata`.
- **Metadata**:
  - `id`: NanoID.
  - `caption`: String.
  - `date_taken`: ISO-8601.
  - `location`: String.
  - `type`: `image | video | pdf`.

---

## **4. Core Logic & Algorithms (The Brain)**

### **4.0 BootLoader & Integrity**

- **Responsibility**: Loads YAML files from disk.
- **Validation**:
  - **Schema**: Validates against Zod Schemas.
  - **Asset Integrity**: Verifies existence of files referenced in `assets` array. Logs warnings for missing files.

### **4.1 The Graph Engine (Runtime)**

- **Library**: `graphology`.
- **Graph Type**: Directed MultiGraph.
- **Nodes**: `Person`, `Story`.
- **Edges**:
  - `child_of`: From Person -> Parent.
  - `mentions`: From Story -> Person.

**Computed Relationships (Runtime)**:
These are **NOT** stored in YAML. They are derived via graph traversal.

1.  **Siblings**: `getSiblings(id)`.
    - Logic: Find parents -> Find all children of parents -> Filter `self`.
2.  **Spouses**: `getCurrentSpouse(id)`.
    - **"Henry VIII Algorithm"**:
      1.  Fetch all `marriage`, `divorce` events for Person.
      2  Sort by `sort_date`.
      3.  Replay timeline: Marriage sets `current_spouse`, Divorce clears it.
      4.  Final check: If `current_spouse` exists, check their `death` events. If dead -> Status `widowed`.

### **4.2 Timeline Slicer**

Pre-computes the "Integrated Feed" for the UI Person Detail page.

- **Input**: Person ID.
- **Process**:
  1.  **Collection**: Merge Person Events + Story Mentions (Stories mentioning this person).
  2.  **Sorting**: Strict Sort by `sort_date`.
  3.  **Gap Detection**: Iterate sorted list. If `Item[i+1].year - Item[i].year > 10`, insert a `Gap` object: `{ type: 'gap', years: diff }`.
- **Output**: `Array<Event | Story | Gap>`.

### **4.3 GEDCOM Engine**

- **Logic**:
  - **Import**: Stream Read -> Parse 5.5.1/7.0 -> Map Tags to Legacy Schemas -> Write YAMLs.
  - **Robustness Rules**:
    - **Date Parsing**: Must support standard formats (`DD MMM YYYY`, `MMM YYYY`, `YYYY`) and modifiers (`ABT`, `EST`, `CAL`, `BEF`, `AFT`, `BET`, `FROM`/`TO`). Invalid dates fallback to original string or safe default.
    - **Relationships**: Must fully reconstruct parent-child links.
      - Iterate `FAM` records.
      - Map `HUSB` -> Father, `WIFE` -> Mother.
      - Iterate `CHIL` children.
      - Update Child's `relationships.parents` array with Father and Mother IDs.
  - **Export**: Walk Graph -> Serialize to strict GEDCOM format.
  - **Loss Prevention**: Unhandled tags go into `Person._gedcom`.

---

## **5. API Specification (Head 2 Server)**

**Framework**: Fastify.
**Base URL**: `/api`.
**Errors**: Standard JSON: `{ error: string, code: string, details?: any }`.

### **5.1 Entity Endpoints**

- `GET /people/:id`: Returns hydrated Person object (Schema Data + Computed Relations + Timeline).
  - _404_: Person not found.
- `POST /people`: Create new Person.
  - _Body_: Partial Person Schema.
  - _Effect_: Writes new YAML, returns ID.
- `PUT /people/:id`: Update Person.
  - _Body_: Replacement Person Schema.
  - _Effect_: Overwrites YAML. Triggers Git Commit.
- `PUT /people/:id/media`: Upload asset.
  - _Multipart_: File data.
  - _Effect_: Saves to `/assets`, updates Person YAML `assets` array.

### **5.2 Search & Discovery**

- `GET /search`:
  - **Query**: `?q=string`.
  - **Engine**: FlexSearch.
  - **Returns**: `{ people: [], stories: [], places: [] }`.

### **5.3 System Operations**

- `POST /system/snapshot`: Create a Git Tag.
  - _Body_: `{ name: string }`.
- `POST /import/gedcom`: Bulk Import.
  - _Warning_: Destructive. Wipes current data directory (except `.git`).

---

## **6. User Experience (UI) Roadmap**

_Note: UI implementation is Phase 4. This section is a design reference._

### **6.1 Layout Strategy**

- **Theme**: Dark Mode default (High Contrast).
- **Global Command Palette (Cmd+K)**: The primary navigation tool.

### **6.2 "The Holy Grail" Detail Page**

A dense, 3-column layout:

1.  **Identity (Left)**: Static bio, stats, relationship chips (Parents/Spouses/Children).
2.  **Timeline (Center)**: The "Feed" of life events, stories, and gaps.
3.  **Context (Right)**: Assets grid, Markdown Notebook (`scrapbook_md`), Raw YAML tab.

---

## **7. Operational & Security Layer**

### **7.1 Git Operations**

- **Middleware**: "Auto-Commit". Every write operation (`PUT`, `POST`) is wrapped in a Git sequence: `add .` -> `commit -m "Update Person X"`.

### **7.2 Authentication**

- **Local-First Auth**:
  - Credentials stored in `/_meta/auth.yaml` (BCrypt).
  - JWT Session (HttpOnly Cookie).

---

## **8. Implementation Roadmap**

### **Phase 1 & 2: Core Logic (Completed)**

The foundation is built. The graph engine hydrates from disk, and schemas are strictly defined.

- [x] **BootLoader**: Implements `src/core/BootLoader.ts` to parse YAMLs via Zod.
- [x] **GraphEngine**: Implements `src/core/GraphEngine.ts` with `grapphology`, including `hydrate()` and `startWatcher()`.
- [x] **Schemas**:
  - [x] `PersonSchema.ts`: Includes `relationships` (upstream only), `scrapbook_md`, and `_gedcom`.
  - [x] `EventSchema.ts`: detailed Discriminated Unions for all event types.
- [x] **GraphLogic**: Implements `src/core/GraphLogic.ts` containing the "Henry VIII" algorithm for spouse calculation and `getSiblings`.
- [x] **TransactionManager**: Safe implementation of atomic file + git writes.

### **Phase 3: Data Services & API Layer (Backend)**

This phase turns the CLI-like core into a functioning server.

#### **3.1 Search Infrastructure (TDD STRICT)**

- [x] **Install Deps**: `flexsearch`.
- [x] **SearchService Class** (`src/core/SearchService.ts`):
  - [x] **Test Case**: `tests/core/SearchService.test.ts`. Create mock Graph, index it, assert `search("Turing")` returns Alan.
  - [x] **Index Config**: Create a "Document" index.
    - Fields to Index: `names.first`, `names.last`, `names.nickname`, `events.location` (flattened), `stories.title`, `stories.content`.
  - [x] Implement `rebuild(graph)`: Iterate all nodes in graph, push to FlexSearch.
  - [x] Integration: Call `searchService.rebuild()` at the end of `GraphEngine.hydrate()`.

#### **3.2 GEDCOM Interchange**

- [x] **GEDCOM Parser** (`src/core/gedcom/Import.ts`):
  - [x] **Library**: Custom simple parser implementing required mappings.
  - [x] **TDD**: `tests/core/gedcom/Import.test.ts`.
  - [x] **Mapping Logic**:
    - `INDI` -> `PersonSchema`.
    - `FAM` -> `Marriage Event` + `Parent Relationship`.
  - [x] **Loss Prevention**: Capture all `_ATTR` tags into `_gedcom`.
- [ ] **GEDCOM Exporter** (`src/core/gedcom/Export.ts`):
  - [ ] Traverse Graph -> Generate valid GEDCOM string.

#### **3.3 Media Services**

- [ ] **Thumbnail Service** (`src/core/Thumbnailer.ts`):
  - [ ] **Library**: `sharp`.
  - [ ] **TDD**: Test resizing a sample JPG.
  - [ ] Implement `getThumbnail(filename, width)`. Check cache -> Generate -> Save -> Return path.

#### **3.4 The API Server**

- [ ] **Fastify Setup** (`src/server.ts`):
  - [ ] **TDD**: `tests/api/Server.test.ts` using `supertest`.
  - [ ] Configure `fastify-cors`.
  - [ ] Inject `GraphEngine` singleton.
- [ ] **Route Structure**:
  - `src/api/routes/people.ts`
  - `src/api/routes/search.ts`
  - `src/api/routes/system.ts`

### **Phase 4: The Experience (Frontend)**

Building the "VS Code for Genealogy" interface.

#### **4.1 Scaffolding & Design System**
- [ ] **Init**: Vite + React + TypeScript + TanStack Router (for type-safe routing).
- [ ] **State Management**: Install `TanStack Query` (React Query) for caching and optimistic updates.
- [ ] **Tailwind Config**: Define the "Dark Mode" palette (Slate/Zinc/Neutral).
- [ ] **Typography**: Set up `Inter` (UI), `Fira Code` (Data), `Merriweather` (Stories).
- [ ] **Components**:
  - [ ] `Button`, `Input`, `Modal` (using `radix-ui` primitives).
  - [ ] `Avatar` (displaying image or initials).
  - [ ] `CmdK` (Command Palette) implementation.

#### **4.2 The Dashboard**
- [ ] **Stats Panel**: Total People, Total Families, Last Edited File.
- [ ] **Force Graph**:
  - [ ] Integrate `react-force-graph-2d`.
  - [ ] Map API graph data to visualization nodes.
  - [ ] Implement "Gravity Bands" (positioning nodes by birth year on Y-axis).

#### **4.3 The "Holy Grail" (Person Detail)**
- [ ] **Layout**: CSS Grid 3-column (Fixed Left, Scrollable Center, Collapsible Right).
- [ ] **Timeline Feed**:
  - [ ] Implement `TimelineSlicer` (logic to merge events + stories).
  - [ ] Render `EventCard` components.
  - [ ] Render `Gap` components (visualizing missing years).
- [ ] **Editors**:
  - [ ] Implement Inline Editing for simple fields (Name, Birth Date).
  - [ ] Embed a Markdown Editor for `scrapbook_md`.

### **Phase 5: Immersion & Polish**

#### **5.1 Rich Story Editor**
- [ ] Integrate `Tiptap` editor.
- [ ] Custom Extension: `@Mention` support (searches Graph for people).
- [ ] Custom Extension: `/Asset` support (inserts image from `/assets`).

#### **5.2 The 3D Time Tunnel**
- [ ] Setup `react-three-fiber`.
- [ ] Create a "Tunnel" geometry.
- [ ] Map timeline events to Z-depth coordinates.
- [ ] Implement scroll-based camera movement.

### **Phase 6: Distribution & Deployment**

- [ ] **Dockerization**: Create multi-stage `Dockerfile` (Build Frontend -> Serve Backend).
- [ ] **Desktop Wrapper**: Wrap web-app in `Electron` for true local-file-system access (bypass browser sandboxing).
- [ ] **CI/CD**: Github Action to run Vitest + Playwright on PRs.

---

## **9. Comprehensive Test Strategy**

### **9.1 Unit Tests (Vitest)**

*   **GEDCOM**: Verify parsing of 5.5.1 and 7.0 specific tags.
*   **Search**: Verify fuzzy matching for typos in names.
*   **Timeline**: Verify Gap Detection logic.
*   **Schemas**: Verify Zod schemas reject invalid data and accept new fields (`scrapbook_md`, `_gedcom`).

### **9.2 Integration Tests (Supertest)**

*   **Media Upload**: Test multipart upload -> FS write -> YAML update.
*   **Snapshots**: Trigger snapshot -> Verify git tag exists.
*   **Graph Hydration**: Verify `BootLoader` correctly populates the `GraphEngine`.

### **9.3 E2E Tests (Playwright)**

*   **CUJ: Import Flow**: Upload GEDCOM -> Wait for Hydration -> Verify Node Count.
*   **CUJ: Holy Grail**: Navigate to Person -> Edit Note -> Save -> Verify Persistence.
*   **CUJ: Time Tunnel**: Load view -> Scroll -> Verify Camera Z position changes.
