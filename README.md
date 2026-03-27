# Character Builder (Vanilla SPA)

Single-page character builder with curated 5etools sources and modal-based advanced pickers.

## Data dependency (no submodule)

This project vendors `5etools-src` into `data/5etools-src` using a pinned clone workflow.

```bash
./scripts/vendor-5etools.sh
```

Optionally pin to a tag/branch:

```bash
./scripts/vendor-5etools.sh v2.25.4
```

## Run locally

Serve this directory with any static server:

```bash
python3 -m http.server 4173
```

Then open:

[http://localhost:4173](http://localhost:4173)

## Included workflow

- Source preset selection (`core`, `expanded`)
- Basics (name, level, notes)
- Ancestry/background selection
- Class/subclass + multiclass modal
- Ability score editing with derived stats
- Equipment modal picker
- Spell modal picker
- Review/import/export JSON

## Notes

- The app loads data from `data/5etools-src/data/...`.
- If data is unavailable, it falls back to a minimal sample catalog.
