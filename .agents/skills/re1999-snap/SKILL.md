---
name: re1999-snap
description: re1999-hvideos 帧截图管线：按每集 frames.json 从原始素材按时间戳提取截图帧（pnpm snap 规格编写、dry-run 纯色帧纠偏预警、按集提取、--strict、产物核验）。剪辑/导出走 re1999-video-clipping。
---

# 帧截图管线（pnpm snap）

本项目（re1999-hvideos，`apps/re1999-hvideos`）的**帧截图**技能，只在本仓库使用：按每集截图规格 `frames.json` 从原始素材按绝对时间戳提取单帧图片。视频剪辑/导出是另一条管线，见 `../re1999-video-clipping/SKILL.md`。

## 领域模型

- **截图（screenshot）** = 源视频**单个时间点** `at` 的一帧，产物是图片（与"片段"的时间范围是不同概念）。
- **纯色帧（solid frame）** = 整帧几乎同一亮度的无内容帧（黑场 / 频闪白帧）。判据（`src/snap/solid.ts`）：YAVG ≤ 20 或 ≥ 235，**且**全帧亮度范围 `YMAX-YMIN ≤ 16`（本机 ffmpeg 的 signalstats 不输出 YSTD，用范围近似）。
- **有效帧** = 非纯色帧（静态但有内容的帧也算有效）。
- **纠偏（auto-shift）** = `at` 落在纯色帧时，自动**向后**逐帧找窗口内最近有效帧输出。
- 完整术语见 `../../../CONTEXT.md`。

## 规格与存放约定

- 每集规格 `media/screenshots/epN/frames.json`（跟随产物目录）：`{ "screenshots": [ { "id", "source", "at", "format", "dir?" } ] }`
- `at` = 原始素材的**绝对时间戳**（秒数 / `MM:SS` / `HH:MM:SS[.mmm]`），不能 ≥ 源时长（CLI 校验）
- `format`：`jpg`（`-q:v 2`）/ `png`（无损）/ `webp`（`-quality 90`），每条一个
- `dir` 缺省 = 规格所在目录，产物 = `media/screenshots/epN/{id}.{format}`
- `at` 保持**意图时刻**不回写：纠偏后产物文件名不变，实际取帧时刻记在日志
- 项目级规则/素材事实见 `../../re1999-common/PROJECT.md`；截图来源永远是 `media/raw` 原片，不是剪辑产物

## 执行流程

1. **预检**：读 `../../../CONTEXT.md`（规则）；`../../../docs/adr/0004-截图帧导出.md` 与 `../../../docs/adr/0005-防纯色帧自动纠偏.md`（取帧/纠偏决策）；`ls` 确认 `frames.json` 与素材路径。
2. **编写/更新 `media/screenshots/epN/frames.json`**。完成标准：每条 `id` 唯一、`at` 在源时长内、`format` 合法。
3. **dry-run 预览（必做）**：`pnpm snap run --ep epN --dry-run`。逐条判定 `at` 帧内容并预警 `将自动纠偏至 ~HH:MM:SS.mmm`（25 条约 ~84s，属正常探测成本）。完成标准：无 `WARN/ERROR`；纠偏预警数量与意图一致。
4. **执行提取**：`pnpm snap run [--ep epN]`。
   - 帧级精确语义（ADR-0004）：`-i` 在前、`-ss <at>` 在后（输出 seek，从目标前最近关键帧解码到该帧）；抽取**不带 filtergraph**（本构建 ffmpeg 组合输出 seek × filter 会从片头解码出错误帧）。
   - 自动纠偏（ADR-0005，默认开启）：`at` 判纯色 → 向后逐帧找 64 帧窗口（25fps ≈ 2.56s）内最近有效帧；出窗无有效帧 → 该条报错跳过；`--strict` 关闭纠偏（判坏即单条报错、退出码非零）。
   - 完成标准：每条打印 `done -> 路径` 或明确的 `ERROR ... skipped`；日志 `auto-shift` 条数与 dry-run 预警一致。
5. **核验产物**：`ls media/screenshots/epN/` 产物数量 = 规格条目数；抽查画面内容与预期场景一致。

## 重跑截图（改时间戳/换格式后的标准做法）

1. 产物可从原片 + 规格随时复现，删除零风险：`rm -f media/screenshots/epN/epNN-f*.{jpg,png,webp}`
2. 与用户核对/更新 `frames.json`（`at` 保持意图时刻）
3. `pnpm snap run --ep epN --dry-run` 预览
4. `pnpm snap run --ep epN` 执行
5. 核验数量与纠偏日志
   实测 ep01（25 条）：f12（00:02:45 黑场）→ 00:02:45.040（+1 帧）、f25（00:05:31 频闪白）→ 00:05:31.040（+1 帧），其余 23 条零偏移。

## 命令速查

| 命令 | 作用 |
|------|------|
| `pnpm snap run --dry-run` | 校验 + 预览（含纠偏预警），不写产物 |
| `pnpm snap run` | 提取全部每集截图（自动纠偏） |
| `pnpm snap run --ep epN` | 只跑某一集 |
| `pnpm snap run --strict` | 关闭自动纠偏：判坏即单条报错、退出码非零 |
| `pnpm snap list` | 列出已发现的截图规格 |

## 关键决策（详细权衡见 `docs/adr/`）

- **ADR-0004 截图帧导出**：独立 snap 管线（时点而非范围）；来源 = 原始素材绝对时间戳；`-ss` 置后帧级精确；质量先写死不参数化。
- **ADR-0005 防纯色帧自动纠偏**：双信号判定（YAVG 极端 + 全帧均匀）；只防纯色帧、静帧不判坏；向后逐帧纠偏、64 帧窗口上限、出窗报错；`at` 不回写；`--strict` 兜底。
- 实现注记：纠偏窗口 = `-ss at -frames:v 65` 一次解码 65 帧（`f-01` = `at` 帧、序号即相对帧号），逐张探测；探测 = 先无 filter 抽帧成图 → 单图 signalstats（单张 ~0.08s）。

## 本管线易踩坑

- **`-ss` 输出 seek × filtergraph 失效（本机 n9.0.1 实测）**：给抽取命令加任何 filter（哪怕 `metadata=print`）或 `-f null` 会导致从片头解码、输出错帧。因此探测/抽取一律"无 filter 先抽帧成图 → 单图再 signalstats"。
- **纯色转场帧不是精度问题**：帧级精确工作正常，是时间点自身落在黑场/频闪上——这正是默认纠偏存在的原因；不要在 `frames.json` 里手工 +1s 规避（ADR-0005 要消灭的做法），交给纠偏。
- 项目级坑（中文路径乱码、git 大文件、TS7 严格推断等）见 `../../re1999-common/PROJECT.md`。