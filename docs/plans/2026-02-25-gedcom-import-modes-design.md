# GEDCOM Import Modes — Design Doc

**Date**: 2026-02-25
**Status**: Approved

## Problem

`POST /api/import/gedcom` unconditionally wipes all `people/*.yaml` before writing imported records. There is no way to add GEDCOM data on top of an existing database without destroying it first. Stories referencing synthetic or hand-crafted people are left with dangling `@mention` IDs after a replace import.

## Solution

Give the user an explicit choice between **Replace** and **Additive** import modes, with clear warnings about the consequences of each.

---

## UI — Import Page (`import.lazy.tsx`)

A radio group is inserted between the drop zone and the Import button. Default selection is **Replace** (preserves current behavior).

### Mode descriptions shown below the radio group

**Replace selected:**
> All existing people will be permanently deleted and replaced with records from this file. Git history is preserved, so you can revert if needed.

**Add selected:**
> People from this file will be added to your existing data. Duplicates are detected by matching first name, last name, and birth year — matched records will be skipped to preserve any hand-crafted edits. Name or date discrepancies may still result in duplicates.

### Confirmation dialog

Adapts to selected mode:

| Mode | Title | Button |
|------|-------|--------|
| Replace | "Destructive Action" (AlertTriangle icon) | Destructive red "Yes, Replace All" |
| Add | "Add to Existing Data" | Standard "Yes, Import" |

Both dialogs show the relevant mode description again as confirmation text.

### Post-import feedback

- **Replace**: navigates immediately to `/` after hydration completes (unchanged).
- **Additive**: shows a result banner (`"Imported 47 people, skipped 12 duplicates"`) briefly before navigating to `/`.

---

## Backend — `POST /api/import/gedcom`

### New parameter

`mode` field in the multipart form data. Accepted values: `"replace"` | `"additive"`. Defaults to `"replace"` if absent (backwards compatible).

### Replace mode

Unchanged — wipe all `people/*.yaml`, write all imported people.

### Additive mode

1. Read all existing YAML filenames from `peopleDir` via `fs.readdir`.
2. Parse each file with `js-yaml` to extract `names` and `events` fields.
3. Build a `Set<string>` of dedup keys from existing people.
4. For each GEDCOM-parsed person, compute their dedup key and check against the set.
   - **Match found**: skip (do not write — preserves hand-crafted edits).
   - **No match**: write as new person.

### Response shape change

Additive mode adds a `skipped` count:

```json
{ "imported": 47, "skipped": 12, "warnings": [] }
```

Replace mode response is unchanged: `{ "imported": N, "warnings": [] }`.

---

## Dedup Matching Logic

**Match key**: `"${normalizedFirst}|${normalizedLast}|${birthYear}"`

- **Normalization**: lowercase + trim whitespace on first and last name.
- **Birth year**: extracted via `/(\d{4})/` regex from the `sort_date` or `date` field of the person's `birth` event.
- **Fallback — no birth year on either side**: match on name only (`"${first}|${last}"`).
- **Fallback — no name on either side**: no match attempt; treat as new person.

Existing people's keys are built by reading and lightly parsing each YAML file directly (no graph/memory access).

---

## Files Affected

| File | Change |
|------|--------|
| `client/src/routes/import.lazy.tsx` | Add mode radio group, adapt dialog, show additive result banner |
| `src/api/routes/gedcom.ts` | Accept `mode` field, conditional wipe, dedup logic, updated response |
