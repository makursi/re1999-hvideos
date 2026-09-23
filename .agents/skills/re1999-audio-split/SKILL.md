---
name: re1999-audio-split
description: re1999-hvideos 音频切分管线：按项目/单元的 tracklist.json 把音频源切成多首 .m4a 歌曲（pnpm split 清单编写、--dry-run 预览、--strict 尾差告警、按项目/单元切分、产物 tracklist.csv 核验）。视频剪辑走 re1999-video-clipping，截图走 re1999-snap。
---

# 音频切分管线（pnpm split）

本项目（re1999-hvideos，`apps/re1999-hvideos`）的**音频切分**技能，只在本仓库使用：按项目/单元的切歌清单 `tracklist.json` 把一个音频源切成多首 `.m4a` 歌曲（stream copy，无损不重编码）。视频剪辑是另一条管线，见 `../re1999-video-clipping/SKILL.md`；帧截图见 `../re1999-snap/SKILL.md`。

## 领域模型

- **音源（audio source）** = 一个含音轨的媒体文件（本阶段只支持纯音频、无视频流）；一个 tracklist 恰好对应一个音源。
- **切歌清单（tracklist）** = 描述一个音源切分内容的唯一事实来源（`tracklist.json`）。
- **歌曲（song/track）** = 清单里的一条：`start`（开始时间戳）+ `title`（歌名）。**`end` 不落盘**，由相邻 `start` 推导：一首歌的 `end` = 下一首的 `start`，**末首 `end` = 音源实际时长**（`probeDuration` 读 `format.duration`）。
- 完整术语见 `../../../CONTEXT.md`。

## 规格与存放约定（三段式布局，ADR-0009）

- 每单元清单 `media/work/<项目>/split/<单元>/tracklist.json`：`{ "source", "tracks": [ { "start", "title" } ] }`
- `source` = 源素材 ASCII 相对路径（如 `media/input/mix/audios/old-school-90s.mkv`），是**数据不是配置**
- `start` = 每首歌开始时刻（秒数 / `MM:SS` / `HH:MM:SS[.mmm]`），必须**严格递增**，且末首 `start` < 源时长（CLI 校验）
- `title` = 歌名，只含 ASCII `[A-Za-z0-9._ -]`（空格/连字符允许，其它字符报错、不自动 sanitize）；产物文件名 = `NN - {title}.m4a`（`NN` 两位补零，宽度随歌数）
- 产物默认 = `media/output/<项目>/split/<单元>/NN - {title}.m4a`（work→output 镜像）；同一目录生成 `tracklist.csv` 记录（`index,title,start,end,duration,output_file`）
- 扫描根默认 `media/work`（split 类），可用 `RE1999_WORK_DIR` 覆盖（ADR-0007/0009 环境配置面，详见 `../../re1999-common/PROJECT.md`）；CLI 显式参数（`-t`/`--project`/`--unit`）仍优先
- 项目级规则与全局素材事实见 `../../re1999-common/PROJECT.md`

## 执行流程

1. **预检**：读 `../../../CONTEXT.md`（规则）；`ls` 确认目标 `tracklist.json` 与音源磁盘真实路径。
2. **编写/修改 `media/work/<项目>/split/<单元>/tracklist.json`**：按上节 schema，`start` 用音源真实时间戳、`title` 用最终文件名要用的命名。完成标准：`start` 严格递增、末首不超源时长、`title` 全 ASCII。
3. **校验预览（不切分）**：`pnpm split run --dry-run`（逐首打印 start→end/时长/输出文件名，校验源存在与时长）+ `pnpm split list`。完成标准：dry-run 无报错、所有边界符合预期；留意末首尾差告警（见下）。
4. **执行切分**：`pnpm split run [--project <项目>] [--unit <单元>]`。
   - stream copy 语义：`-ss <start>` 放 `-i` **之前**（input seek）+ `-vn` + `-c:a copy`，切点吸附最近 AAC 帧边界（毫秒级，无损不重编码）。
   - 完成标准：每首打印 `done -> 路径`，无 `ERROR`；产物目录同时出现 `tracklist.csv`。
5. **核验产物（必做）**：
   ```bash
   node .agents/skills/re1999-audio-split/scripts/verify-splits.mjs [tracklist.json] [output-dir]
   ```
   无参 = 扫描全部项目/单元的每单元清单（产物在 `media/output` 镜像目录）；逐个对账：产物存在、时长误差 < 0.5s、音频 codec = aac、产物数量 = tracks 数。完成标准：输出 `=== ALL PASS ===`。

## 命令速查

| 命令 | 作用 |
|------|------|
| `pnpm split run --dry-run` | 校验 + 打印计划，不切分 |
| `pnpm split run` | 切分全部项目/单元的清单 |
| `pnpm split run --project mix --unit old-school-90s` | 只跑某项目某单元（旗标均可省略 = 全量） |
| `pnpm split run --strict` | 末首尾差等边界可疑时报错而非告警 |
| `pnpm split run [-t x.json]` | 显式单清单（单文件模式） |
| `pnpm split list` | 按 项目→单元 两级别出已发现的清单 |

## 关键决策（详细权衡见 `docs/adr/`）

- **stream copy 而非重编码**：切分目标是「无损、秒级完成」，`-c:a copy` 只切容器/帧边界不重编码（与 clip 的「重编码帧级精确」取向相反——切歌不需帧精确，混音场景毫秒级吸附人耳无感）。
- **`end` 不落盘**：只存 `start`+`title` 最小事实集，边界由相邻推导、末首到源时长，避免同一边界两处维护。
- **ADR-0009 三段式媒体目录 + 项目级泛化**：规格归 `media/work/<项目>/split/<单元>`，产物默认落 `media/output` 镜像，CLI 引入 `--project`/`--unit`。
- **ADR-0007 环境驱动配置面**：规格扫描根可配，默认即 `media/` 三段布局；末首尾差阈值 60s、seek 摆放是领域常量，不是配置。

## 本管线易踩坑

- **末首尾差（tracklist 末点 < 音源实际时长）**：末首 `end` 忠实切到音源结尾，但若末首 `start` 之后还跟着一段非歌曲内容（如 outro），末首会把这段也包进去，`--dry-run` 会打印 `[split] warn: last track ... runs HH:MM:SS past it`。默认静默切到结尾；`--strict` 会把这条告警变成报错。示例：mix 项目末首《Palm Breeze Night Sessions》02:01:19 起、音源 02:04:53 止，尾差约 3m34s——确认尾部要保留就照默认切，不要就改 `tracklist.json` 或另加一首尾曲。
- **`.mkv` 不一定是视频**：源可能是纯音频却用 `.mkv` 容器（mix 项目即如此，ffprobe 实测无 video stream 仅 AAC）。切分走 `-vn` + `-c:a copy` 不受影响，产物仍是 `.m4a`；怀疑参数前先 `ffprobe` 确认源流。
- **`-ss` 前 seek 是帧级近似**：stream copy 无法逐采样精确，切点吸附 AAC 帧边界（毫秒级）；这与 clip 的帧级精确是**不同取向**，别把 clip 的 `-ss` 置后语义套到 split 上。
- 项目级坑（中文路径乱码、git 大文件、TS7 严格推断等）见 `../../re1999-common/PROJECT.md`。
