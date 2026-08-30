# re1999-hvideos

Batch-clips *Reverse: 1999* (Arcane Incident Department) raw videos into segments via a single `manifest.json`, exporting to `media/exports` with frame-accurate re-encoding (`--copy` for draft mode).

```bash
pnpm clip        # run the batch clipping
pnpm test        # unit tests
pnpm lint / typecheck
```

## Directory Layout

| Path | Purpose |
|------|---------|
| `src/` + `tests/` | CLI, manifest/ffmpeg/time modules, unit tests |
| `media/raw/` | Read-only source videos/audios — never modified |
| `media/processed/` `clips/` `temp/` | Normalized / intermediate / scratch files |
| `media/exports/` | Final exported clips (one file per segment) |
| `manifest.json` | Single source of truth: `clips[]` with id, source, in, out |
| `docs/` | Docs & ADRs (e.g. re-encode-first clipping) |
| `scripts/` `public/` | Helpers & static assets |