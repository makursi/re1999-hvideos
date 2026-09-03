---
name: re1999-video-clipping
description: re1999-hvideos 项目唯一本地技能，汇总本项目全部工作内容与踩坑。凡涉及视频批量剪辑（pnpm clip）、帧截图（pnpm snap）、规格文件编写（manifest.json / frames.json）、导出核验、产物重跑、或需要复用本项目既有技术决策（ADR-0001~0005）的任务，先读本文件。含素材规范化、命令速查、素材实测事实、从零搭建全踩坑记录与验证脚本用法。
---

# re1999-hvideos 视频批量剪辑与截图（项目全工作汇总）

把《重返未来：1999》官方短片素材（`media/raw`，只读）按清单批量裁剪为短视频片段、并按时间戳提取截图帧的 CLI 工具项目。本文件是项目从零到当前状态的完整复盘：两条管线（剪辑/截图）的流程、全部技术决策、以及与障碍搏斗的踩坑记录。本技能只在本仓库（`apps/re1999-hvideos`）本地使用。

## 目录速览

```
src/                      # CLI 与纯函数模块（clip/snap/discovery/ffmpeg/time/manifest/framespec/solid/shift）
tests/                    # vitest 用例（25 条全绿）
media/
  raw/videos/1999-Arcane-Incident-Department-Animation/ep01~ep07.mp4   # 素材（只读、无音轨）
  raw/videos/README.md              # epNN → 中文标题映射（防信息丢失）
  audios/                           # 预留：将来配乐/配音
  exports/ep1~ep7/                  # 剪辑产物 {id}.mp4 + 每集 manifest.json（跟随产物）
  screenshots/ep1~ep7/              # 截图产物 {id}.{jpg|png|webp} + 每集 frames.json（跟随产物）
  temp/ processed/ clips/           # 预留/中间目录
docs/adr/                 # 决策档案 0001~0005（决策的完整理由与权衡，改动前先对照）
CONTEXT.md                # 领域术语与规则（领域模型唯一事实来源）
CHANGELOG.md              # Keep a Changelog 风格变更记录
.agents/skills/re1999-video-clipping/   # 本技能 + scripts/verify-exports.mjs
```

## 领域模型速记

术语的完整定义在 `CONTEXT.md`（唯一事实来源），这里只列**最容易用错**的对照：

| 术语 | 含义 | Avoid |
|------|------|-------|
| 片段（clip） | 源视频 + 时间范围 `[in, out]`，产物是视频 | 剪辑段、segment |
| 截图（screenshot） | 源视频**单个时间点** `at` 的一帧，产物是图片 | 抓帧、定格帧 |
| 纯色帧（solid frame） | 整帧像素几乎同一亮度（黑场/频闪白），YAVG 极端 + 全帧均匀 | 坏帧、黑屏帧 |
| 有效帧 | 非纯色帧（静态但有内容的帧也算） | — |
| 纠偏（auto-shift） | `at` 落在纯色帧时自动向后逐帧找最近有效帧输出 | 偏移、补帧 |
| 截图规格（frames spec） | `frames.json`，一集截图处理的唯一输入 | 截图清单、任务 |

核心规则：**素材内容只读**（`media/raw` 永不修改也不删除，仅一次性规范化文件名）；**路径全 ASCII** `[A-Za-z0-9._-]`；**产物与规格同目录**（规格文件进 git，媒体产物不提交）；**目录映射显式优先**（条目 `dir` 显式优先，缺省 = 规格所在目录）。

## 完整工作流

### 0. 动手前先读这四样东西
- `CONTEXT.md`（术语/规则）
- `docs/adr/`（编码/工具链/结构/截图/纠偏决策；**改动任何行为前先对照**）
- 当前要处理的 `media/exports/epN/manifest.json` 或 `media/screenshots/epN/frames.json`
- `media/raw/videos/`（素材实况；涉及文件路径的命令**每次先 `ls` 验证磁盘真实路径**，环境视图可能滞后/被重命名）

### 1. 素材规范化（一次性）
中文文件名在 shell/ffmpeg 下会乱码（踩坑 #1），因此：
- 系列目录用 ASCII slug（本项目：`1999-Arcane-Incident-Department-Animation`）
- 每集重命名为 `epNN.mp4`（`ep01`~`ep07`），中文标题映射写进 `media/raw/videos/README.md`
- 重命名用 Node 脚本（`fs.renameSync` + UTF-8 映射表），**不要用 shell 通配符碰中文名**

### 2. 编写每集剪辑清单 `media/exports/epN/manifest.json`
每条 = 一个片段（一对一裁剪；多段拼接是后续迭代，语义不变）：
```json
{ "clips": [ { "id": "ep01-c01", "source": "media/raw/videos/1999-Arcane-Incident-Department-Animation/ep01.mp4", "in": "00:00:00", "out": "00:00:23" } ] }
```
- `id` 该集内唯一，输出 = `media/exports/epN/{id}.mp4`（产物目录 = 清单所在目录）
- `in`/`out` 支持秒数（`30`）、`MM:SS`、`HH:MM:SS[.mmm]`；约束 `in < out`、`out ≤ 源时长`

### 3. 校验 + 预览（不编码）
```bash
pnpm clip run --dry-run
pnpm clip list       # 列出已发现的每集清单
```
打印每条起点→终点、时长、输出路径、模式；校验源存在、时长不越界。

### 4. 执行导出
```bash
pnpm clip run                 # 默认精确模式：扫描全部每集清单（重编码）
pnpm clip run --ep ep1        # 只跑某一集
pnpm clip run --copy          # 草稿模式（流拷贝，误差 ±3.5~7s，见 ADR-0001）
```
精确模式 ffmpeg 语义（ADR-0001）：`-ss <in>` 放 `-i` **之前**（快速 seek + 解码丢弃到精确帧）→ 帧级精确；`-t <dur>` 用时长而非 `-to`；`libx264 -crf 20 -preset fast -c:a aac -b:a 192k -movflags +faststart`。

### 5. 核验产物（导出后必做）
```bash
node .agents/skills/re1999-video-clipping/scripts/verify-exports.mjs               # 扫描全部每集清单
node .agents/skills/re1999-video-clipping/scripts/verify-exports.mjs <manifest.json> [dir]  # 单文件
```
按清单逐条对账：时长误差 < 0.05s、h264 视频轨、faststart（moov 在文件头 128KB 内）。本项目 11 条实测全部 0.000s 误差。

### 6. 截图帧导出与**重跑**
```bash
# 每集截图规格 media/screenshots/epN/frames.json：
#   { "screenshots": [ { "id", "source", "at", "format": jpg|png|webp, "dir"? } ] }
#   at = 原始素材的绝对时间戳；dir 缺省 = 规格所在目录
pnpm snap run --dry-run       # 校验 + 预览（含纯色帧纠偏预警，~84s/25 条是正常成本）
pnpm snap run                 # 提取全部每集截图
pnpm snap run --ep ep1        # 只跑某一集
pnpm snap run --strict        # 关闭自动纠偏：判坏即单条报错、跳过、退出码非零
pnpm snap list                # 列出已发现的截图规格
```
帧级精确语义（ADR-0004）：`-i` 在前、`-ss <at>` 在后（从关键帧精确解码到该帧），不做输入 seek；质量默认 png 无损 / jpg `-q:v 2` / webp `-quality 90`。
**防纯色帧自动纠偏（ADR-0005）**：`at` 是意图时刻；执行时若该帧被判为纯色帧（YAVG 极端 **且** `YMAX-YMIN ≤ 16` 近似 YSTD），自动向后逐帧找 64 帧（≈2.56s）窗口内最近有效帧输出；出窗无有效帧 → 单条报错。产物文件名不变、规格 `at` 不回写，实际取帧时刻与偏移量记在日志；`--dry-run` 逐条打印 `将自动纠偏至 ~HH:MM:SS.mmm`。

**重跑截图（改时间戳 / 换格式后的标准做法，本会话验证）**：
1. 产物可随时从原片 + `frames.json` 复现，删除旧产物零风险：`rm -f media/screenshots/epN/epNN-f*.{jpg,png,webp}`
2. 确认/更新 `frames.json` 时间戳（与用户核对，`at` 保持意图时刻）
3. `pnpm snap run --ep epN --dry-run` 预览（会警告纯色帧纠偏）
4. `pnpm snap run --ep epN` 执行
5. 核验：`ls media/screenshots/epN/ | wc -l` 与规格条目数一致；日志中 `auto-shift` 条数应与 dry-run 预警一致
   实测 ep01（25 条）：f12（00:02:45 黑场）→ 00:02:45.040（+1 帧）、f25（00:05:31 频闪白）→ 00:05:31.040（+1 帧），其余 23 条零偏移。

## 命令速查

| 命令 | 作用 |
|------|------|
| `pnpm clip run [--dry-run] [--copy] [--ep epN] [-m x.json] [--crf N] [--preset P] [-o dir]` | 批量导出（每集清单） |
| `pnpm clip list` | 列出已发现的每集清单 |
| `pnpm snap run [--dry-run] [--strict] [--ep epN] [-m x.json]` | 批量截图（每集截图规格，自动纠偏） |
| `pnpm snap list` | 列出已发现的截图规格 |
| `pnpm typecheck` / `pnpm lint` / `pnpm lint:fix` / `pnpm test` | TS 7 / oxlint / vitest（25 条用例） |
| `FFMPEG_BIN=/path/ffmpeg pnpm clip run` / `pnpm snap run` | 指定 ffmpeg 二进制 |

## 关键决策档案（详细权衡见 `docs/adr/`，先读再改）

- **ADR-0001 重编码剪辑优先**：关键帧间隔 4~7s（实测）否掉默认流拷贝 → 默认 libx264 重编码帧级精确，`--copy` 降级草稿模式。
- **ADR-0002 ts7-oxlint**：TS 7（tsgo 原生编译器）超出 typescript-eslint peer 范围 → 弃 eslint/@antfu，lint 用 oxlint（自带 TS 解析器、规则同名兼容）。
- **ADR-0003 每集清单跟随产物**：剪辑清单拆到 `media/exports/epN/manifest.json`、截图规格拆到 `media/screenshots/epN/frames.json`；CLI 无参按集扫描，`--ep` 过滤单集；`.gitignore` 忽略媒体产物但 negate 保留规格文件进 git。
- **ADR-0004 截图帧导出**：独立 `pnpm snap` 脚本（时点 `at` 而非范围）；来源 = 原始素材的绝对时间戳；`-ss` 置后帧级精确；每条一个 format；质量 jpg `-q:v 2`/png 无损/webp `-quality 90` 先写死不参数化。
- **ADR-0005 防纯色帧自动纠偏**：YAVG 极端 + 均匀性双信号判纯色帧（只防纯色，静帧不判坏）；向后逐帧纠偏、64 帧窗口上限、出窗报错；默认开启、`--strict` 关闭；规格 `at` 不回写（意图时刻 → 产物名字不变，实际取帧记日志）；实现注记：YSTD 用 `YMAX-YMIN ≤ 16` 近似、本构建 ffmpeg `-ss` 输出 seek × filtergraph 失效必须"先抽帧成图再探测"、纠偏窗口一次解码 65 帧。

## 素材事实（实测）

- 全部 7 集：1080p25 h264，每集约 6.5 分钟（ep07 仅 50s，片头曲）
- **关键帧间隔 4~7 秒**（p95 3~5.5s）→ 流拷贝切点吸附误差不可接受（ADR-0001 成因）
- **全部无音轨** → 导出的音频轨是静音为正确行为；将来混音是独立能力（`media/raw/audios` 预留）
- 单集 25~150MB；合计 ~643MB → **不进入 git 历史**（.gitignore）
- ep01 截图 25 条实测：帧级精确，23 条 `at` 本身有效零偏移，2 条纯色帧自动纠偏（+1 帧 / +0.040s）

## 仓库与 git 约定

- 本仓库独立于 `W/` 根目录（非 pnpm workspace），git remote → `github.com/makursi/re1999-hvideos`
- commit message 用英文、Conventional Commits（如 `feat: auto-shift solid-frame screenshots…`），**不用中文**
- 功能开发走分支 → push → PR → merge → `git checkout main && git pull`（本仓库的既有工作流）
- `media` 下的媒体产物永不提交；规格文件（manifest.json / frames.json）是输入，进版本库

## 全部踩坑记录（从零搭建全过程，按发生顺序）

1. **中文路径乱码 / 工具视图不一致**
   - bash 下文件名正常、ffprobe 报 `Illegal byte sequence`；Node `readdirSync` 与 `ls` 看到的文件不一致；偶发 `Permission denied`（把目录当文件探测）。
   - 解决：素材重命名全 ASCII（`epNN.mp4`）；一律用 Node + `execFileSync` 传参数（不经 shell 转义）操作文件。预防：路径全 ASCII 规则；操作前先 `ls`。

2. **关键帧稀疏否掉"默认流拷贝"**
   - 原计划 `-c copy` 快速无损剪辑，实测关键帧间隔 4~7s，剪"台词/名场面"会跑偏 ±3.5~7s → 默认重编码帧级精确，`--copy` 仅草稿（ADR-0001）。

3. **TypeScript 7.0.2 × ESLint 生态不兼容**
   - `typescript-eslint 8.x` peer 要求 `<6.1.0`，TS 7 被拒；`pnpm peers check` 报 unmet → 保留 TS7，弃 eslint，换 oxlint（ADR-0002）。

4. **pnpm 11 把"忽略构建脚本"当硬错误**
   - `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.28.2` 导致所有 `pnpm run` 前置检查直接失败 → 建 `pnpm-workspace.yaml`，`allowBuilds` 必须用 **map 语法** `esbuild: true`（数组写法会被解析成坏键值对）。

5. **ffprobe CSV 行尾 `\r` 破坏解析**
   - `-of csv=p=0` 输出行尾带 `\r`（Windows CRLF），awk 数 keyframe 全为 0 → 解析前 `line.replace(/\r$/,'')`；且不要在 heredoc 里写长脚本（CRLF 污染代码），改用 `node -e` 单行或正式文件。

6. **git 大文件误暂存**
   - 650MB 的 mp4 全部 `A` 进索引，`.gitignore` 更新后依然暂存。根因：ignore 规则对**已在索引中**的文件无效 → `git rm --cached .../*.mp4`（磁盘保留）再 `git add -A`；提交前 `git ls-files | xargs du -ch` 验体积。

7. **TS 7 类型推断更严格**
   - 从 `Record<string, unknown>` 取出 `in`/`out` 直接返回，报 `Type 'unknown' is not assignable to type 'TimeInput'` → 显式断言 `in: input as TimeInput`。清单解析层保持纯函数 + 显式类型。

8. **目录被外部重命名（环境视图滞后）**
   - 会话中系列目录从 `1999! Arcane Incident Department Animation` 变为 `1999-Arcane-Incident-Department-Animation` → 涉及文件路径的命令每次先 `ls`/`readdir` 确认；manifest 引用以磁盘实际为准。

9. **素材无音轨 → 输出静音**
   - 11 条产物 `h264/-`（无音频流），一度怀疑参数错误；实测所有源 `-select_streams a` 为空 → 素材本身无声，属正常，已写入 `media/raw/videos/README.md`。

10. **ffmpeg n9.0.1：`-ss` 输出 seek × filtergraph = 从片头解码并出错误帧**
    - `-i V -ss 165 -frames:v 1 -vf signalstats,metadata=print -f null -` 本应探一帧，实测解码 4127+ 帧（17~37s）、元数据从片头印起、输出帧错位；去掉 filter 抽 jpg 则帧级精确（黑场 165.00 YAVG=0、165.04 YAVG=146.39）。`-f null` / `-vf`（哪怕只是 `metadata=print`）与 `-ss` 置后组合在 n9.0.1 均失效。
    - 另外 `signalstats` 根本不输出 YSTD（ADR-0005 的"标准差"以 `YMAX-YMIN ≤ 16` 实现）。
    - 解决：探测一律"先无 filter 抽帧成图 → 再单图 signalstats"（单张 ~0.08s）；纠偏窗口用 `-ss at -frames:v 65` 一次解码连续 65 帧，文件序号即相对 `at` 的帧号。
    - 教训：ffmpeg 行为必须对当前二进制实测，别信版本——前一个会话留下的 select 网格方案从未对真实视频验证，本次直接重构掉了。

## 验证脚本

`scripts/verify-exports.mjs`：Node 原生（fs + child_process），按 manifest 对账导出产物。用法见[工作流第 5 步](#5-核验产物导出后必做)。截图侧核验：产物数量对照规格条目数 + 日志 `auto-shift` 条数与 dry-run 预警一致（见[工作流第 6 步](#6-截图帧导出与重跑)）。