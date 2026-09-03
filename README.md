# re1999-hvideos

Batch-clips *Reverse: 1999* (Arcane Incident Department) raw videos into segments via per-episode `manifest.json` files, and extracts frame screenshots via per-episode `frames.json` specs — all with frame-accurate encoding (`--copy` for draft clip mode).

```bash
pnpm clip run            # batch-clip ALL episodes (media/exports/epN/manifest.json)
pnpm clip run --ep ep1   # one episode
pnpm clip run --dry-run  # validate + print plan, no encoding
pnpm clip list           # list discovered per-episode manifests
pnpm snap run            # extract screenshots (media/screenshots/epN/frames.json)
pnpm snap run --ep ep1   # one episode
pnpm snap run --strict   # error on solid frames instead of auto-shifting
pnpm snap run --dry-run  # validate + print plan (warns about auto-shifts)
pnpm snap list           # list discovered frames specs
pnpm test                # unit tests
pnpm lint / typecheck
```

## Directory Layout

| Path | Purpose |
|------|---------|
| `src/` + `tests/` | CLIs (clip, snap), manifest/framespec/ffmpeg/time/discovery modules, unit tests |
| `media/raw/` | Read-only source videos/audios — never modified |
| `media/processed/` `clips/` `temp/` | Normalized / intermediate / scratch files |
| `media/exports/epN/` | Exported clips (episode dirs) + this episode's `manifest.json` |
| `media/screenshots/epN/` | Screenshot images (episode dirs) + this episode's `frames.json` |
| `CHANGELOG.md` | Change log (Keep a Changelog style) |
| `docs/` | Docs & ADRs (re-encode-first clipping, per-episode manifests, frame screenshots) |
| `.agents/skills/` | Project skills: `re1999-video-clipping/` (clip pipeline + `scripts/verify-exports.mjs`), `re1999-snap/` (screenshot pipeline), `re1999-common/PROJECT.md` (shared project reference) |

## Clips (pnpm clip)

- Spec: `media/exports/epN/manifest.json` → `{ "clips": [{ "id", "source", "in", "out" }] }`
- Output: `media/exports/epN/{id}.mp4` (one file per segment); `-o <dir>` overrides the output dir
- Accurate mode: libx264 re-encode, `-ss` before `-i` (frame-exact), `-crf 20 -preset fast`; `--copy` = draft mode (snaps to keyframes, ±3.5–7s — see ADR-0001)

## Screenshots (pnpm snap)

- Spec: `media/screenshots/epN/frames.json` → `{ "screenshots": [{ "id", "source", "at", "format", "dir?" }] }`
  - `format`: `jpg` | `png` | `webp`; `dir` optional, defaults to the spec's own directory
- Output: `media/screenshots/epN/{id}.{format}`
- Extracts from **raw sources at absolute timestamps** with frame-exact `-ss`-after-`-i` decoding (ADR-0004)
- Quality defaults: png lossless, jpg `-q:v 2`, webp `-quality 90`
- **Auto-shift（ADR-0005）**：若 `at` 恰好落在纯色帧（黑场 / 频闪白帧），自动向后逐帧搜索 64 帧窗口内最近有效帧并输出（默认开启）；`--strict` 关闭并改为单条报错。实际取帧时刻与偏移量记录在日志，规格 `at` 不回写；`--dry-run` 逐条预警 `将自动纠偏至 ~…`