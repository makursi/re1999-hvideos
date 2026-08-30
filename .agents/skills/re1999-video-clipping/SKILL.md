---
name: re1999-video-clipping
description: re1999-hvideos 项目内视频批量剪辑技能。覆盖从 media/raw 素材规范化（epNN ASCII 命名）、编写 manifest.json（in/out 时间范围）、pnpm clip run 批量重编码导出到 media/exports，到导出后核验的完整流程。包含本项目切点编码决策（重编码精确 + --copy 草稿）、关键帧间隔/无音轨素材事实，以及从零搭建时的全部踩坑记录（TS7×oxlint、pnpm allowBuilds、中文路径乱码、git 大文件等）。用于本项目内任何剪辑、导出、验证、以及复用既有决策的任务。
---

# re1999-hvideos 视频批量剪辑

把《重返未来：1999》官方短片素材（`media/raw`）按清单批量裁剪导出为短视频的 CLI 工具技能。
本文件是项目从零到第一条剪辑产出的完整复盘：流程、决策、以及与障碍的搏斗记录。

## 目录速览

```
media/
  raw/videos/1999-Arcane-Incident-Department-Animation/ep01~ep07.mp4   # 素材（只读、无音轨）
  raw/videos/README.md          # epNN → 中文标题映射（防信息丢失）
  audios/                       # 预留：将来配乐/配音
  exports/ep1~ep7/              # 剪辑产物 {id}.mp4 + 每集 manifest.json（跟随产物）
  screenshots/ep1~ep7/          # 截图产物 {id}.{jpg|png|webp} + 每集 frames.json（跟随产物）
  temp/ processed/ clips/       # 预留/中间目录
src/time.ts    # 时间解析 [H:]MM:SS[.mmm] / 秒
src/manifest.ts# clip 清单形状校验（纯函数）
src/framespec.ts# 截图规格形状校验 + 产物路径解析（纯函数）
src/discovery.ts# 按集目录发现（clip/snap 共用）
src/ffmpeg.ts  # ffmpeg 参数构造 + 执行（可 FFMPEG_BIN 覆盖）
src/clip.ts    # 剪辑 CLI 入口（commander）
src/snap.ts    # 截图 CLI 入口（commander）
docs/adr/      # 决策档案（0001 编码策略、0002 TS7/oxlint、0003 每集清单、0004 截图）
CONTEXT.md     # 领域术语与规则
```

## 完整工作流

### 0. 先读这四样东西
- `CONTEXT.md`（术语/规则，尤其"路径全 ASCII"、"素材内容只读"、"产物与规格同目录"）
- `docs/adr/`（编码/工具链/结构决策，改动前先对照）
- `media/exports/epN/manifest.json`（当前要导出的内容，每集一份）
- `media/raw/videos/`（素材实况；**操作任何路径前先 `ls` 验证磁盘真实路径**，环境视图可能滞后/被重命名）

### 1. 素材规范化（一次性）
中文文件名在 shell/ffmpeg 下会乱码（见踩坑 #1），因此：
- 系列目录用 ASCII slug（本项目：`1999-Arcane-Incident-Department-Animation`）
- 每集重命名为 `epNN.mp4`（`ep01`~`ep07`）
- 中文标题映射写进 `media/raw/videos/README.md`
- 重命名用 Node 脚本（`fs.renameSync` + UTF-8 文件名映射表），**不要用 shell 通配符碰中文名**

### 2. 编写每集剪辑清单 media/exports/epN/manifest.json（ADR-0003：跟随产物目录）
每一条 = 一个片段（一对一裁剪；多段拼接是后续迭代，语义不变）：
```json
{ "id": "ep01-c01", "source": "media/raw/videos/1999-Arcane-Incident-Department-Animation/ep01.mp4", "in": "00:00:00", "out": "00:00:23" }
```
- `id` 在该集内唯一，输出即 `media/exports/epN/{id}.mp4`（产物目录 = 清单所在目录）
- `in`/`out` 支持秒数（`30`）、`MM:SS`、`HH:MM:SS[.mmm]`
- 约束：`in < out`，`out ≤ 源时长`；推荐先确认切点都在时长内

### 3. 校验 + 预览（不编码）
```bash
pnpm clip run --dry-run
pnpm clip list     # 列出已发现的每集清单
```
打印每条：起点→终点、时长、输出路径、模式，并校验所有源存在、时长不越界。

### 4. 执行导出
```bash
pnpm clip run                 # 默认精确模式：扫描全部每集清单（重编码）
pnpm clip run --ep ep1        # 只跑某一集
pnpm clip run --copy          # 草稿模式（流拷贝，误差 ±3.5~7s，见 ADR-0001）
```
精确模式的 ffmpeg 语义（ADR-0001）：
`-ss <in>` 放 `-i` **之前**（快速 seek + 解码丢弃到精确帧）→ 帧级精确；
`-t <dur>` 用时长而非 `-to`（避免预 seek 下的歧义）；
`libx264 -crf 20 -preset fast -c:a aac -b:a 192k -movflags +faststart`。
关闭 moov 需要 `-movflags +faststart`（网页/手机秒开）。

### 5. 核验产物（导出后必做）
```bash
node .agents/skills/re1999-video-clipping/scripts/verify-exports.mjs   # 扫描全部每集清单，产物目录=清单所在目录
node .agents/skills/re1999-video-clipping/scripts/verify-exports.mjs <manifest.json> [dir]  # 单文件模式
```
按清单逐条对账：时长误差 < 0.05s、h264 视频轨、faststart（moov 在文件头 128KB 内）。
本项目 11 条实测全部 0.000s 误差。

### 6. 截图帧导出（独立能力，ADR-0004）
```bash
# 每集截图规格 media/screenshots/epN/frames.json：
#   { "id", "source", "at", "format": jpg|png|webp, "dir"? }
#   at = 原始素材的绝对时间戳；dir 缺省 = 规格所在目录
pnpm snap run --dry-run       # 校验 + 预览
pnpm snap run                 # 提取全部每集截图
pnpm snap run --ep ep1        # 只跑某一集
pnpm snap list                # 列出已发现的截图规格
```
帧级精确语义（ADR-0004）：`-i` 在前、`-ss <at>` 在后（从关键帧精确解码到该帧），不做输入 seek；
质量默认 png 无损 / jpg `-q:v 2` / webp `-quality 90`。

## 命令速查

| 命令 | 作用 |
|------|------|
| `pnpm clip run [--dry-run] [--copy] [--ep epN] [-m x.json] [--crf N] [--preset P] [-o dir]` | 批量导出（每集清单） |
| `pnpm clip list` | 列出已发现的每集清单 |
| `pnpm snap run [--dry-run] [--ep epN] [-m x.json]` | 批量截图（每集截图规格） |
| `pnpm snap list` | 列出已发现的截图规格 |
| `pnpm typecheck` / `pnpm lint` / `pnpm lint:fix` / `pnpm test` | TS7 / oxlint / vitest |
| `FFMPEG_BIN=/path/ffmpeg pnpm clip run` | 指定 ffmpeg 二进制 |

## 关键决策档案
- `../../../docs/adr/0001-重编码剪辑优先.md`：默认重编码、流拷贝仅草稿（关键帧 4~7s 实测驱动）
- `../../../docs/adr/0002-ts7-oxlint.md`：保留 TS 7 原生编译器，lint 用 oxlint（typescript-eslint 未跟进）
- `../../../docs/adr/0003-每集清单跟随产物.md`：清单/规格按集拆分、跟随产物目录，CLI 按集扫描
- `../../../docs/adr/0004-截图帧导出.md`：独立 snap 脚本、原始素材绝对时间戳、`-ss` 置后帧级精确
- `../../../CONTEXT.md`：片段/截图/导出产物/manifest 术语，"素材内容只读 + 产物与规格同目录"规则

## 易踩注释坑
- 块注释里写 `media/exports/*/manifest.json` 会让 `*/` 提前闭合注释导致 oxlint 解析报错（`Expected , or )`）；写注释里的通配路径时改用 `epN` 占位（如 `media/exports/epN/manifest.json`）。

## 素材事实（实测）
- 全部 7 集：1080p25 h264，每集约 6.5 分钟（ep07 仅 50s，片头曲）
- **关键帧间隔 4~7 秒**（p95 3~5.5s）→ 流拷贝切点吸附误差不可接受（ADR-0001 的成因）
- **全部无音轨** → 导出静音是正确行为；将来混音是独立能力（`media/raw/audios` 预留）
- 单集 25~150MB；合计 ~643MB，**不进入 git 历史**（.gitignore）

## 踩坑记录（从零搭建全过程，按发生顺序）

1. **中文路径乱码 / 工具视图不一致**
   - 现象：bash 下文件名正常，ffprobe 报 `Illegal byte sequence`；Node `readdirSync` 与 `ls` 看到的文件不一致；偶发 `Permission denied`（把目录当文件探测）。
   - 根因：不同工具对 UTF-8/中文路径的编码处理与沙箱视图不同步。
   - 解决：素材重命名全 ASCII（`epNN.mp4`）；一律用 Node + `execFileSync` 传参数（不经 shell 转义）操作文件。
   - 预防：`CONTEXT.md` 规则"路径全 ASCII [A-Za-z0-9._-]"；操作前先 `ls` 验证。

2. **关键帧稀疏否掉"默认流拷贝"**
   - 现象：原计划 `-c copy` 快速无损裁剪，实测关键帧间隔 4~7s，剪"台词/名场面"会跑偏 ±3.5~7s。
   - 解决：默认重编码帧级精确，`--copy` 降级为草稿模式 → ADR-0001。

3. **TypeScript 7.0.2 × ESLint 生态不兼容**
   - 现象：`typescript-eslint 8.x` peer 要求 `>=4.8.4 <6.1.0`，TS 7（Go 原生）被拒；`pnpm peers check` 报 unmet。
   - 决策：听从用户保留 TS7 → 卸载 `@antfu/eslint-config` + eslint，换 **oxlint**（自带 TS 解析器、规则同名兼容）→ ADR-0002。

4. **pnpm 11 把"忽略构建脚本"当硬错误**
   - 现象：`[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.28.2`，导致**所有** `pnpm run` 前置 deps 检查直接失败（exit 1）。
   - 解决：建 `pnpm-workspace.yaml`，注意 `allowBuilds` 必须用 **map 语法** `esbuild: true`（数组写法会被解析成坏的键值对）。

5. **ffprobe CSV 行尾 `\r` 破坏解析**
   - 现象：`-of csv=p=0` 输出行尾带 `\r`（Windows CRLF），awk 数 keyframe 全为 0。
   - 解决：解析前 `line.replace(/\r$/,'')`；且**不要在 heredoc 里写长脚本**（CRLF 会污染代码），改用 `node -e` 单行或正式文件。

6. **git 大文件误暂存**
   - 现象：650MB 的 mp4 全部 `A` 进索引，`.gitignore` 更新后依然暂存。
   - 根因：ignore 规则对**已在索引中**的文件无效。
   - 解决：`git rm --cached media/raw/videos/.../*.mp4`（磁盘保留），再 `git add -A`；提交前 `git ls-files | xargs du -ch` 验体积。

7. **TS 7 类型推断更严格**
   - 现象：从 `Record<string, unknown>` 取出 `in`/`out` 后直接返回，报 `Type 'unknown' is not assignable to type 'TimeInput'`。
   - 解决：显式断言 `in: input as TimeInput`。（这也提示：清单解析层保持纯函数 + 显式类型，别依赖隐式收窄。）

8. **目录被外部重命名（环境视图滞后）**
   - 现象：会话中系列目录从 `1999! Arcane Incident Department Animation` 变为 `1999-Arcane-Incident-Department-Animation`（空格/`!` → 短横线）。
   - 教训：涉及文件路径的命令**每次先 `ls`/`readdir` 确认**；manifest 引用以磁盘实际为准。

9. **素材无音轨 → 输出静音**
   - 现象：11 条产物 `h264/-`（无音频流），一度怀疑参数错误；实测所有源 `-select_streams a` 为空。
   - 结论：素材本身无声，属正常；已写入 `media/raw/videos/README.md`。

## 验证脚本

`scripts/verify-exports.mjs`：Node 原生（fs + child_process），按 manifest 对账导出产物。
用法见 [工作流第 5 步](#5-核验产物导出后必做)。