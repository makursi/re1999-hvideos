# AGENTS.md

`re1999-hvideos` — batch media tool: clips raw videos into per-unit segments, extracts frame screenshots, and splits audio sources into per-song tracks, driven by per-unit specs. Started on *Reverse: 1999* (Arcane Incident Department), generalized to any input project via the three-stage `media/input → work → output` layout (ADR-0009). TypeScript 7 (tsgo via tsx), ESM, oxlint (not eslint), vitest. CLIs: `pnpm clip`, `pnpm snap`, `pnpm split`.

## Context pointers (load on demand)

- **Domain model** — unique authority for all terms (项目/单元/片段/截图/纯色帧/纠偏/导出产物…): `CONTEXT.md`. Load before discussing or changing domain semantics.
- **Technical decisions** — unique authority for pipeline behavior: `docs/adr/0001~0010` (re-encode-first clipping, ts7+oxlint, three-stage media layout + project-level generalization, frame-exact screenshots, solid-frame auto-shift, env-driven config surface, commit gate, cac CLI framework). ADR-0003 is superseded by ADR-0009; ADR-0006's commander statement is superseded by ADR-0010. Read the relevant ADR **before** changing clip/snap/split behavior.
- **Project reference & pitfalls** — `.agents/skills/re1999-common/PROJECT.md`: material facts (1080p25, keyframe gap 4–7s, no audio tracks), toolchain gotchas (Chinese-path mojibake, TS7 strict inference, pnpm `allowBuilds` map syntax, git large-file traps). Reached through the pipeline skills; not duplicated here.
- **Pipeline workflows** — `.agents/skills/re1999-video-clipping/SKILL.md` (clip: manifest → mp4 + `verify-exports.mjs`) and `.agents/skills/re1999-snap/SKILL.md` (snap: frames.json → images + auto-shift). Load when writing/editing specs, exporting, or verifying products.

## Guardrail rules (every task)

- **`media/input` is read-only** — never modify or delete source files; only filename normalization to ASCII (`epNN.mp4`) is allowed, per-project mapping lives in `media/input/<project>/README.md`.
- **Pipeline paths are ASCII-only** (`[A-Za-z0-9._-]`) — Chinese paths break ffprobe/Node cross-tool views.
- **Specs in git, media artifacts never** — `media/work/<project>/<clips|screenshots|split>/<unit>/manifest.json` / `frames.json` / `tracklist.json` are inputs and versioned; input sources and mp4/jpg/png/webp/m4a products are ignored (see `.gitignore`). Check `git ls-files` before committing.
- **Snapshots extract from `media/input` originals at absolute `at`** — never from clip products; `at` stays the intended moment, never rewritten on auto-shift.
- **Spec invariants**: clip ids unique per unit, `in < out`; `at` < source duration, `format` ∈ jpg/png/webp; track `start` timestamps strictly increasing and last track starts before source duration.
- **Commit gate is enforced by hooks** — simple-git-hooks installs them; pre-commit runs lint-staged (`oxlint --fix --deny-warnings` on staged source), pre-push runs `pnpm typecheck && pnpm test` (ADR-0008). When a commit is blocked by lint, fix it and retry — never bypass with `--no-verify`.

## Source map

- `src/main.ts` — single CLI entry (ADR-0006; CLI framework cac per ADR-0010): multicall program `re1999 clip|snap|split`; `pnpm clip` / `pnpm snap` / `pnpm split` forward here
- `src/program.ts` — `createProgram()` factory: cac root + single `--version`/`--help` source + wiring `registerClip` / `registerSnap` / `registerSplit` (ADR-0010)
- `src/clip/run.ts` / `src/snap/run.ts` / `src/split/run.ts` — per-pipeline registrars (`registerClip` / `registerSnap` / `registerSplit`; cac `clip [action]` / `snap [action]` / `split [action]` dispatching run/list, `--project`, `--unit`, `--dry-run`, `--strict`, `--copy`) plus that pipeline's orchestration (plan, probe, encode/extract/split, temp mgmt)
- `src/clip/` vs `src/snap/` vs `src/split/` — the three domain-decoupled pipelines (ADR-0004); each folder owns its spec parser (`src/clip/manifest.ts` / `src/snap/framespec.ts` / `src/split/tracklist.ts`); snap also owns `solid.ts` / `shift.ts` (its only consumers)
- `src/common/` — shared mechanics only, never domain models: `run-common.ts` spec-runner glue (`collectUnits`, `mirrorSpecDirToOutput` / `defaultProductDir`, `probeSourceDurations`, `makeListAction`, `wrapAction`, `loadSpec`, `elapsedSeconds`), `config.ts` env-driven config surface (ADR-0007 / ADR-0009, lazy getters, `vi.stubEnv`-tested), `ffmpeg.ts` arg builders/probing/signalstats, `time.ts` / `discovery.ts` time parse/format + project/unit dir scanning
- Tests mirror modules under `tests/clip/`, `tests/snap/`, `tests/split/`, `tests/common/` (one test file per module); `tests/cli.test.ts` covers the whole argv → options parse layer of `src/program.ts` + the shared dispatch (ADR-0010)
- `tests/` — vitest, one test file per module; run `pnpm test`, `pnpm lint`, `pnpm typecheck` before pushing

## Git conventions

- **Routine operational work commits straight to `main`** — per-unit
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

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles with default label strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.