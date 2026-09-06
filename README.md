# re1999-hvideos

Batch-clips *Reverse: 1999* (Arcane Incident Department) raw videos into per-episode segments via `manifest.json`, and extracts frame screenshots via `frames.json` — frame-accurate both ways.

```bash
pnpm clip                # batch clip all episodes (media/exports/epN/manifest.json)
pnpm clip run --ep ep1   # one episode; --dry-run preview; --copy draft (keyframe-snapped)
pnpm snap                # extract screenshots (media/screenshots/epN/frames.json)
pnpm snap run --ep ep1   # one episode; --dry-run warns about auto-shifts; --strict disables them
pnpm re1999              # combined entry: clip / snap subcommands (pnpm clip & pnpm snap are aliases)
pnpm test / lint / typecheck
```

## Layout

- `media/raw/` — read-only sources · `media/exports/epN/` — clips + `manifest.json` · `media/screenshots/epN/` — images + `frames.json`
- `src/main.ts` — single entry (ADR-0006) · `src/clip/` `src/snap/` — per-pipeline logic · `src/common/` — shared mechanics · `tests/` mirrors modules
- Domain glossary: `CONTEXT.md` · technical decisions: `docs/adr/` (0001~0006) · project reference: `.agents/skills/re1999-common/PROJECT.md`

## Key behavior

- Clips re-encode with libx264 (frame-exact); `--copy` is a draft mode that snaps cuts to keyframes (ADR-0001)
- Screenshots extract from raw sources at absolute timestamps; solid frames auto-shift to the next valid frame within a 64-frame window, `--strict` errors instead (ADR-0004 / ADR-0005)

## Configuration (environment variables)

Hardcoded paths are replaced by an environment-driven config surface (ADR-0007). All knobs are optional and keep the classic `media/` layout as defaults.

| Variable | Default | Purpose |
|---|---|---|
| `FFMPEG_BIN` | `ffmpeg` | ffmpeg binary path |
| `FFPROBE_BIN` | `ffprobe` | ffprobe binary path |
| `RE1999_EXPORTS_DIR` | `media/exports` | scan base for per-episode `manifest.json` |
| `RE1999_SCREENSHOTS_DIR` | `media/screenshots` | scan base for per-episode `frames.json` |
| `RE1999_TEMP_DIR` | `media/temp` | snap probe workspace |

Precedence: CLI flags > shell environment > `.env` file > defaults. Copy `.env.example` to `.env` to set values (`.env` is git-ignored, `.env.example` is versioned). Raw `media/raw` sources are **not** configurable — they live in the versioned spec JSONs and stay read-only.