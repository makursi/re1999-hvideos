---
name: re1999-video-clipping
description: re1999-hvideos 视频剪辑管线：按每集 manifest.json 把原始素材裁剪导出为片段 mp4（pnpm clip 清单编写、dry-run 预览、按集导出、--copy 草稿、verify-exports 核验）。截图/帧提取走 re1999-snap。
---

# 视频剪辑管线（pnpm clip）

本项目（re1999-hvideos，`apps/re1999-hvideos`）的**视频批量剪辑**技能，只在本仓库使用。把原始素材按每集剪辑清单裁剪导出为片段 mp4。截图/帧提取是另一条管线，见 `../re1999-snap/SKILL.md`。

## 领域模型

**片段（clip）** = 源视频 + 时间范围 `[in, out]`，一个剪辑产物 = 一个片段（一对一裁剪；多段拼接是后续迭代，不改变语义）。完整术语见 `../../../CONTEXT.md`。

## 素材与规格的存放约定

- 源素材 `media/raw/videos/<series>/epNN.mp4`（只读、ASCII 命名；epNN → 中文标题映射见 `media/raw/videos/README.md`）
- 每集清单 `media/exports/epN/manifest.json`（跟随产物目录）：`{ "clips": [ { "id", "source", "in", "out" } ] }`
- `id` 该集内唯一，产物 = `media/exports/epN/{id}.mp4`
- 时间支持秒数（`30`）/ `MM:SS` / `HH:MM:SS[.mmm]`；约束 `in < out`、`out ≤ 源时长`（CLI 校验）
- 项目级规则与全局素材事实（素材只读、路径全 ASCII、大文件不提交等）见 `../../re1999-common/PROJECT.md`

## 执行流程

1. **预检**：读 `../../../CONTEXT.md`（规则）、`../../../docs/adr/0001-重编码剪辑优先.md` 与 `../../../docs/adr/0003-每集清单跟随产物.md`（编码/结构决策）；用 `ls` 确认目标 manifest 与素材的磁盘真实路径。
2. **编写/修改 `media/exports/epN/manifest.json`**：按上节 schema，切点用素材真实时间戳。完成标准：每条 `id` 唯一、`in < out`、`out` 不超源时长。
3. **校验预览（不编码）**：`pnpm clip run --dry-run`（逐条打印起点→终点/时长/输出路径，校验源存在与时长越界）+ `pnpm clip list`。完成标准：dry-run 无报错，所有切点符合预期。
4. **执行导出**：`pnpm clip run [--ep epN]`，默认**精确模式**；`--copy` = 草稿模式（流拷贝，切点吸附关键帧 ±3.5~7s，仅快速预览）。
   - 精确模式 ffmpeg 语义（ADR-0001）：`-ss <in>` 放 `-i` **之前**（快速 seek + 解码丢弃到精确帧）→ 帧级精确；`-t <dur>` 用时长而非 `-to`；`libx264 -crf 20 -preset fast -c:a aac -b:a 192k -movflags +faststart`。
   - 完成标准：每条打印 `done -> 路径`，无 `ERROR`。
5. **核验产物（必做）**：
   ```bash
   node .agents/skills/re1999-video-clipping/scripts/verify-exports.mjs [manifest.json] [dir]
   ```
   无参 = 扫描全部每集清单；逐个对账：时长误差 < 0.05s、h264 视频轨、faststart（moov 在文件头 128KB 内）。完成标准：输出 `=== ALL PASS ===`（本项目 11 条实测全部 0.000s 误差）。

## 命令速查

| 命令 | 作用 |
|------|------|
| `pnpm clip run --dry-run` | 校验 + 打印计划，不编码 |
| `pnpm clip run` | 精确模式导出全部每集清单 |
| `pnpm clip run --ep epN` | 只跑某一集 |
| `pnpm clip run --copy [--crf N] [--preset P]` | 草稿模式 / 覆盖编码参数 |
| `pnpm clip run [-o dir] [-m x.json]` | 输出目录覆盖 / 显式单清单 |
| `pnpm clip list` | 列出已发现的每集清单 |

## 关键决策（详细权衡见 `docs/adr/`）

- **ADR-0001 重编码剪辑优先**：素材关键帧间隔 4~7s（实测）→ 流拷贝切点吸附误差不可接受；默认重编码帧级精确，`--copy` 仅草稿。
- **ADR-0003 每集清单跟随产物**：清单按集拆分、跟随产物目录，CLI 按集扫描；`.gitignore` 忽略媒体产物但保留规格文件进 git。
- 工具链决策（ts7-oxlint）与截图/纠偏决策分别见 PROJECT.md 与 `re1999-snap` 技能。

## 本管线易踩坑

- **关键帧吸附**：`--copy` 的切点落在最近关键帧上（±3.5~7s）——只作草稿，正式产物用默认精确模式。
- **无音轨素材**：产出的音频轨是静音为正确行为（源码全部无音轨）。怀疑参数错误前先查 `media/raw/videos/README.md`。
- **ffprobe CSV 行尾 `\r`**：解析 ffprobe 输出前必须 `line.replace(/\r$/, '')`（Windows CRLF），否则 keyframe 计数全为 0。
- 项目级坑（中文路径乱码、git 大文件、TS7 严格推断等）见 `../../re1999-common/PROJECT.md`。