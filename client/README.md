# LegacyGraph — Frontend

React 19 + Vite 7 + TypeScript client for the LegacyGraph genealogy platform.

## Stack

- **Framework**: React 19 + Vite 7 + TypeScript
- **Routing**: TanStack Router (file-based, `src/routes/`)
- **Data fetching**: TanStack Query with optimistic updates
- **UI state**: Zustand (`src/store/uiStore.ts`)
- **Components**: shadcn/ui (Radix + Tailwind v4)
- **Icons**: Lucide React
- **Toasts**: Sonner
- **Virtualization**: `@tanstack/react-virtual` (Timeline, People table, Stories feed, Search results, Asset gallery)
- **Resizable panels**: `react-resizable-panels` (Holy Grail 3-column layout)
- **Rich text editor**: Milkdown Crepe (`@milkdown/crepe`) with `@mention` support
- **Map**: `react-leaflet` + OpenStreetMap
- **Graph viz**: `react-force-graph-2d` (Force Graph); D3 (Fan Chart, Pedigree)

## Commands

```bash
npm run dev       # Vite dev server at http://localhost:5173 (proxies /api → localhost:3000)
npm run build     # TypeScript check + production build → dist/
npm run lint      # ESLint
```

> The backend must be running on port 3000 for API calls to work. See the root `README.md` for backend setup.

## Structure

```
src/
  api/           client.ts, hooks.ts (TanStack Query), people.ts, stories.ts
  components/    Shared UI components (PersonChip, EventEditorDialog, MilkdownEditor, ...)
  components/ui/ shadcn/ui primitives (Button, Dialog, Command, Tabs, ...)
  routes/        File-based TanStack Router pages
  store/         uiStore.ts — sidebar, modals, theme, Stories feed state
```

## Key Routes

| Path | Description |
|:-----|:------------|
| `/` | Dashboard — stats, Force Graph / Fan Chart / Pedigree |
| `/people` | Virtualised searchable table of all people |
| `/people/:id` | Person detail — Holy Grail 3-column layout |
| `/stories` | Blog-style story feed |
| `/stories/:id` | Story view + Milkdown Crepe editor |
| `/map` | Interactive world map of geocoded event locations |
| `/assets` | Universal asset gallery + orphan detection |
| `/import` | GEDCOM import with SSE progress stream |
| `/settings` | System status, auth, cache, Git state |
| `/search` | Full-text search across people, stories, and places |

## Dark Mode

Toggled via the theme button in the top bar. The active theme (`"dark"` or `"light"`) is persisted to `localStorage.theme`. An inline script in `index.html` applies the `.dark` class to `<html>` before React mounts to prevent flash of unstyled content.
