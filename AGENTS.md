# AGENTS.md

`re1999-hvideos` — batch-clips *Reverse: 1999* (Arcane Incident Department) raw videos into per-episode segments and extracts frame screenshots, driven by per-episode specs. TypeScript 7 (tsgo via tsx), ESM, oxlint (not eslint), vitest. CLIs: `pnpm clip`, `pnpm snap`.

## Context pointers (load on demand)

- **Domain model** — unique authority for all terms (片段/截图/纯色帧/纠偏/导出产物…): `CONTEXT.md`. Load before discussing or changing domain semantics.
- **Technical decisions** — unique authority for pipeline behavior: `docs/adr/0001~0005` (re-encode-first clipping, ts7+oxlint, per-episode specs follow products, frame-exact screenshots, solid-frame auto-shift). Read the relevant ADR **before** changing clip/snap behavior.
- **Project reference & pitfalls** — `.agents/skills/re1999-common/PROJECT.md`: material facts (1080p25, keyframe gap 4–7s, no audio tracks), toolchain gotchas (Chinese-path mojibake, TS7 strict inference, pnpm `allowBuilds` map syntax, git large-file traps). Reached through the pipeline skills; not duplicated here.
- **Pipeline workflows** — `.agents/skills/re1999-video-clipping/SKILL.md` (clip: manifest → mp4 + `verify-exports.mjs`) and `.agents/skills/re1999-snap/SKILL.md` (snap: frames.json → images + auto-shift). Load when writing/editing specs, exporting, or verifying products.

## Guardrail rules (every task)

- **`media/raw` is read-only** — never modify or delete source files; only filename normalization to ASCII (`epNN.mp4`) is allowed, mapping lives in `media/raw/videos/README.md`.
- **Pipeline paths are ASCII-only** (`[A-Za-z0-9._-]`) — Chinese paths break ffprobe/Node cross-tool views.
- **Specs in git, media artifacts never** — `media/exports/epN/manifest.json` / `media/screenshots/epN/frames.json` are inputs and versioned; mp4/jpg/png/webp products are ignored (see `.gitignore` negation). Check `git ls-files` before committing.
- **Snapshots extract from `media/raw` originals at absolute `at`** — never from clip products; `at` stays the intended moment, never rewritten on auto-shift.
- **Spec invariants**: clip ids unique per episode, `in < out`, `at` < source duration, `format` ∈ jpg/png/webp.

## Source map

- `src/clip.ts` / `src/snap.ts` — CLI entrypoints (commander; run/list, `--dry-run`, `--ep`, `--strict`, `--copy`)
- `src/manifest.ts` / `src/framespec.ts` — spec parsers & validators (ASCII-id rule, time resolution)
- `src/ffmpeg.ts` — ffmpeg arg builders, duration probing, signalstats parsing
- `src/solid.ts` / `src/shift.ts` — solid-frame detection (YAVG ± YMAX−YMIN) and auto-shift window policy (64 frames @ 25fps)
- `src/time.ts` / `src/discovery.ts` — time parse/format, per-episode dir scanning
- `tests/` — vitest, one test file per module; run `pnpm test`, `pnpm lint`, `pnpm typecheck` before pushing

## Git conventions

- **Routine operational work commits straight to `main`** — per-episode
  specs (`frames.json` / `manifest.json`), product exports, screenshots,
  and other one-off data work. Commit in English, conventional style
  (never Chinese in commit messages).
- **Project iterations go through the PR flow** — pipeline/tooling changes
  (`src/`, `tests/`, CLI behavior, docs, ADRs, skills):
  1. `git checkout -b <type>/<short-slug>` — type: `feat` / `fix` / `refactor` / `docs` / `chore`
  2. Commit in English, conventional style (never Chinese in commit messages)
  3. `git push -u origin <branch>`
  4. `gh pr create --base main` (title = commit subject), then after review:
     `gh pr merge --squash --delete-branch`
  5. `git checkout main && git pull`