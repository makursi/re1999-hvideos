---
name: re1999-video-clipping
description: re1999-hvideos 视频剪辑管线：按项目/单元的 manifest.json 把输入素材裁剪导出为片段 mp4（pnpm clip 清单编写、dry-run 预览、按项目/单元导出、--copy 草稿、verify-exports 核验）。截图/帧提取走 re1999-snap。
---

# 视频剪辑管线（pnpm clip）

本项目（re1999-hvideos，`apps/re1999-hvideos`）的**视频批量剪辑**技能，只在本仓库使用。把输入素材按项目/单元的剪辑清单裁剪导出为片段 mp4。截图/帧提取是另一条管线，见 `../re1999-snap/SKILL.md`。

## 领域模型

**片段（clip）** = 源视频 + 时间范围 `[in, out]`，一个剪辑产物 = 一个片段（一对一裁剪；多段拼接是后续迭代，不改变语义）。**项目（project）** = 三段布局顶层分组，**单元（unit）** = 项目内最小处理单位（1999 项目的单元名是 `ep1`~`ep7`）。完整术语见 `../../../CONTEXT.md`。

## 素材与规格的存放约定（三段式布局，ADR-0009）

- 源素材 `media/input/<项目>/videos/epNN.mp4`（只读、ASCII 命名；epNN → 中文标题映射见 `media/input/<项目>/README.md`）
- 每单元清单 `media/work/<项目>/clips/<单元>/manifest.json`：`{ "clips": [ { "id", "source", "in", "out" } ] }`
- 扫描根默认 `media/work`，可用 `RE1999_WORK_DIR` 覆盖（ADR-0007/0009 环境配置面，详见 `../../re1999-common/PROJECT.md`）；CLI 显式参数（`-m`/`-o`/`--project`/`--unit`）仍优先
- `id` 该单元内唯一，产物默认 = `media/output/<项目>/clips/<单元>/{id}.mp4`（work→output 镜像），`-o` 显式覆盖
- 时间支持秒数（`30`）/ `MM:SS` / `HH:MM:SS[.mmm]`；约束 `in < out`、`out ≤ 源时长`（CLI 校验）
- 项目级规则与全局素材事实（素材只读、路径全 ASCII、大文件不提交等）见 `../../re1999-common/PROJECT.md`

## 执行流程

1. **预检**：读 `../../../CONTEXT.md`（规则）、`../../../docs/adr/0001-重编码剪辑优先.md` 与 `../../../docs/adr/0009-三段式媒体目录与项目级泛化.md`（编码/结构决策）；用 `ls` 确认目标 manifest 与素材的磁盘真实路径。
2. **编写/修改 `media/work/<项目>/clips/<单元>/manifest.json`**：按上节 schema，切点用素材真实时间戳。完成标准：每条 `id` 唯一、`in < out`、`out` 不超源时长。
3. **校验预览（不编码）**：`pnpm clip run --dry-run`（逐条打印起点→终点/时长/输出路径，校验源存在与时长越界）+ `pnpm clip list`。完成标准：dry-run 无报错，所有切点符合预期。
4. **执行导出**：`pnpm clip run [--project <项目>] [--unit <单元>]`，默认**精确模式**；`--copy` = 草稿模式（流拷贝，切点吸附关键帧 ±3.5~7s，仅快速预览）。
   - 精确模式 ffmpeg 语义（ADR-0001）：`-ss <in>` 放 `-i` **之前**（快速 seek + 解码丢弃到精确帧）→ 帧级精确；`-t <dur>` 用时长而非 `-to`；`libx264 -crf 20 -preset fast -c:a aac -b:a 192k -movflags +faststart`。
   - 完成标准：每条打印 `done -> 路径`，无 `ERROR`。
5. **核验产物（必做）**：
   ```bash
   node .agents/skills/re1999-video-clipping/scripts/verify-exports.mjs [manifest.json] [output-dir]
   ```
   无参 = 扫描全部项目/单元的每单元清单（产物在 `media/output` 镜像目录）；逐个对账：时长误差 < 0.05s、h264 视频轨、faststart（moov 在文件头 128KB 内）。完成标准：输出 `=== ALL PASS ===`（1999 项目 ep1 的 11 条实测全部 0.000s 误差）。

## 命令速查

| 命令 | 作用 |
|------|------|
| `pnpm clip run --dry-run` | 校验 + 打印计划，不编码 |
| `pnpm clip run` | 精确模式导出全部项目/单元的清单 |
| `pnpm clip run --project 1999 --unit ep1` | 只跑某项目某单元（旗标均可省略 = 全量） |
| `pnpm clip run --copy [--crf N] [--preset P]` | 草稿模式 / 覆盖编码参数 |
| `pnpm clip run [-o dir] [-m x.json]` | 输出目录覆盖 / 显式单清单 |
| `pnpm clip list` | 按 项目→单元 两级别出已发现的清单 |

## 关键决策（详细权衡见 `docs/adr/`）

- **ADR-0001 重编码剪辑优先**：素材关键帧间隔 4~7s（实测）→ 流拷贝切点吸附误差不可接受；默认重编码帧级精确，`--copy` 仅草稿。
- **ADR-0009 三段式媒体目录 + 项目级泛化**：取代 ADR-0003"产物与规格同目录"——规格归 `media/work`，产物默认落 `media/output` 镜像，CLI 引入 `--project`/`--unit`；`RE1999_WORK_DIR`/`RE1999_OUTPUT_DIR` 取代旧旋钮。
- **ADR-0007 环境驱动配置面**：规格扫描根等旋钮可环境变量覆盖（默认即 `media/` 三段布局）；规格 `source` 仍是数据、非配置。
- 工具链决策（ts7-oxlint）与截图/纠偏决策分别见 PROJECT.md 与 `re1999-snap` 技能。

## 本管线易踩坑

- **关键帧吸附**：`--copy` 的切点落在最近关键帧上（±3.5~7s）——只作草稿，正式产物用默认精确模式。
- **无音轨素材**：产出的音频轨是静音为正确行为（源码全部无音轨）。怀疑参数错误前先查 `media/input/1999/README.md`。
- **ffprobe CSV 行尾 `\r`**：解析 ffprobe 输出前必须 `line.replace(/\r$/, '')`（Windows CRLF），否则 keyframe 计数全为 0。
- 项目级坑（中文路径乱码、git 大文件、TS7 严格推断等）见 `../../re1999-common/PROJECT.md`。