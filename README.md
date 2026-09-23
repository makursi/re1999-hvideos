# re1999-hvideos

Batch media tool: clips raw videos into per-unit segments via `manifest.json`, extracts frame screenshots via `frames.json`, and splits audio sources into per-song tracks via `tracklist.json` — frame-accurate clips/screenshots, lossless (stream-copy) splits. Started on *Reverse: 1999* (Arcane Incident Department), generalized to any input project (ADR-0009).

```bash
pnpm clip                        # batch clip all projects/units (media/work/<project>/clips/<unit>/manifest.json)
pnpm clip run --project 1999 --unit ep1   # one unit; --dry-run preview; --copy draft (keyframe-snapped)
pnpm snap                        # extract screenshots (media/work/<project>/screenshots/<unit>/frames.json)
pnpm snap run --project 1999 --unit ep1   # one unit; --dry-run warns about auto-shifts; --strict disables them
pnpm split                       # split audio into per-song .m4a tracks (media/work/<project>/split/<unit>/tracklist.json)
pnpm split run --project mix --unit old-school-90s   # stream-copy split; --dry-run preview; --strict tail warning
pnpm re1999                      # combined entry: clip / snap / split subcommands (pnpm clip/snap/split are aliases)
pnpm test / lint / typecheck
```

## Layout (input → work → output, ADR-0009)

- `media/input/<project>/` — read-only raw sources (+ `README.md` mapping per project), never in git
- `media/work/<project>/<clips|screenshots|split>/<unit>/` — versioned specs (`manifest.json` / `frames.json` / `tracklist.json`)
- `media/output/<project>/<clips|screenshots|split>/<unit>/` — products (mp4 / jpg/png/webp / m4a), never in git
- `src/main.ts` — single entry (ADR-0006) · `src/clip/` `src/snap/` `src/split/` — per-pipeline logic · `src/common/` — shared mechanics · `tests/` mirrors modules
- Domain glossary: `CONTEXT.md` · technical decisions: `docs/adr/` (0001~0009) · project reference: `.agents/skills/re1999-common/PROJECT.md`

## Key behavior

- Clips re-encode with libx264 (frame-exact); `--copy` is a draft mode that snaps cuts to keyframes (ADR-0001)
- Product dirs default to the work→output mirror of each spec (explicit `dir` / `-o` overrides still win, ADR-0009)
- Screenshots extract from input sources at absolute timestamps; solid frames auto-shift to the next valid frame within a 64-frame window, `--strict` errors instead (ADR-0004 / ADR-0005)
- Splits stream-copy audio (`-c:a copy -vn`) into `.m4a` at tracklist timestamps — lossless; each song ends where the next begins, the last ends at source duration; `--strict` errors when the last track leaves a suspiciously long tail

## Configuration (environment variables)

Environment-driven config surface (ADR-0007, revised by ADR-0009). All knobs are optional and keep the three-stage `media/` layout as defaults.

| Variable | Default | Purpose |
|---|---|---|
| `FFMPEG_BIN` | `ffmpeg` | ffmpeg binary path |
| `FFPROBE_BIN` | `ffprobe` | ffprobe binary path |
| `RE1999_WORK_DIR` | `media/work` | spec scan root (`<work>/<project>/<clips|screenshots>/<unit>/`) |
| `RE1999_OUTPUT_DIR` | `media/output` | default product root (work→output mirror) |
| `RE1999_TEMP_DIR` | `media/temp` | snap probe workspace |

Precedence: CLI flags > shell environment > `.env` file > defaults. Copy `.env.example` to `.env` to set values (`.env` is git-ignored, `.env.example` is versioned). Raw `media/input` sources are **not** configurable — they live in the versioned spec JSONs and stay read-only.