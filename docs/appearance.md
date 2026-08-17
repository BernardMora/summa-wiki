# Appearance system

Summa's appearance belongs to the vault and is stored in `.summa/appearance.json`.
The server resolves it before rendering `<html>`, so navigation does not flash the
default design while client JavaScript loads.

## Resolution order

1. Official or custom design package.
2. Optional curated typography override.
3. Optional curated palette override.
4. Optional curated button override.

Packages own density, spacing, reading width, radii, shadows and motion. These are
not exposed as individual settings: they are part of the package's design intent.

Official packages and curated options live in `src/appearance/catalog.ts`. A saved
custom package references those stable IDs instead of storing arbitrary CSS. Unknown
or removed IDs fall back to Summa Clásico.

## Files

- `src/appearance/catalog.ts`: public types, official catalog and resolver.
- `src/appearance/store.ts`: validation and atomic vault persistence.
- `app/appearance.css`: semantic tokens and visual recipes.
- `app/api/appearance/route.ts`: client read/write boundary.
- `components/AppearanceDesigner.tsx`: reversible preview and package management.
- `components/AppearanceMigration.tsx`: one-time migration from `wiki.theme`.

## Adding an official package

1. Add the stable ID and recipe to `PRESETS`.
2. Add its structural token rules under `data-preset` in `appearance.css`.
3. Ensure its palette has explicit light and dark values.
4. Exercise the resolver tests and production build.
5. Check reading, navigation, editor, graph, canvas, PDF and terminal surfaces.

Use semantic tokens (`--accent`, `--surface-content`, `--font-ui`) in application
chrome. Do not theme colors that encode user data: file-type colors, graph node
types, PDF highlighter colors and Obsidian Canvas color IDs intentionally keep their
meaning across packages.
