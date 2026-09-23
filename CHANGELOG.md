# CHANGELOG

本文件记录 re1999-hvideos 项目的全部变更，遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格。版本号语义参考 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增（Added）

- **音频切分管线 `pnpm split`（第三类 类 `split`）**：把一段纯音频源按 `tracklist.json` 的时间戳切成若干首 `.m4a` 歌曲（stream copy `-c:a copy -vn`，不重编码）：
  - 规格 `media/work/<项目>/split/<单元>/tracklist.json`，结构 `{ source, tracks: [{ start, title }] }`；`start` 是每首歌开始时刻，`end` 由下一首 `start` 推导、末首 `end` = 音源实际时长（`probeDuration` 读 `format.duration`），**不落盘**；
  - 产物文件名 `NN - Title.m4a`（两位补零序号，宽度随歌数），`title` 校验 ASCII `[A-Za-z0-9._ -]` 外字符报错、不自动 sanitize；
  - `split run` / `split list` 与 clip/snap 同构（cac multicall），复用 `run-common`（collectUnits / probeSourceDurations / defaultProductDir / dispatchCacAction / wrapAction / makeListAction）；`--project` / `--unit` / `-t <path>`（单文件）/ `--dry-run`（纯预览不写）/ `--strict`（末首尾差超阈值时报错而非告警）；
  - 导出记录清单 `tracklist.csv`（`index,title,start,end,duration,output_file`），逐产物 ffprobe 时长核验由既有 `verify` 思路承接；
  - 领域真值 vs 配置分层：末首尾差告警阈值 60s、seek 摆放（`-ss` 在 `-i` 前）为领域常量；配置旋钮全走 `config.ts`，`source` 路径是 spec 数据。
- 首个真实项目 `mix`：输入 `media/input/mix/audios/old-school-90s.mkv`（ASCII 规范化，源码 146MB、纯 AAC、无视频流），规格 `media/work/mix/split/old-school-90s/tracklist.json` 共 38 首歌（与 `media/input/mix/tracklist.md` 逐字逐时间戳一致）。

### 文档（Docs）

- `CONTEXT.md` 新增术语：切歌清单（tracklist）、音源（audio source）、歌曲（song/track）、切分（split）；「输入/操作/输出目录」词条的 类 枚举补 `split`。

### 变更（Changed）

- `src/common/discovery.ts` 的 `SpecKind` 联合类型补 `split`；`src/common/ffmpeg.ts` 新增 `buildAudioCopyArgs`；测试 90 → 106 条全绿（typecheck / oxlint 通过）。

- **三段式媒体目录与项目级泛化（ADR-0009）**：定位从"1999 专用"放宽为**通用媒体工具**；`media` 重构为 输入(`media/input/<项目>`) → 操作(`media/work/<项目>/<类(clips|screenshots)>/<单元>`) → 输出(`media/output/<项目>/<类>/<单元>`) 三段式；CLI 新增可选 `--project`（缺省全量）、`--ep` 更名 `--unit`，`list` 按 项目→单元 两级展示；产物默认 = work→output 镜像（显式 `dir`/`-o` 仍优先）；配置旋钮 `RE1999_EXPORTS_DIR`/`RE1999_SCREENSHOTS_DIR` → `RE1999_WORK_DIR`/`RE1999_OUTPUT_DIR`；1999 现有素材零删除零转码迁入 `media/input/1999/`（`videos/` + `audios/` + README 映射），规格 git mv 至 `media/work/1999/` 并改写 `source` 为 `media/input/1999/videos/...`；仓库名/CLI 程序名 `re1999` 不变。

### 变更（Changed）

- 领域模型：术语「集/每集」→「单元（unit）」；规则"产物与规格同目录"（ADR-0003）→"规格与产物分层（work→output 镜像）"（被 ADR-0009 取代）。
- discovery 升级为项目级双层扫描 `<work>/<项目>/<类>/<单元>/<规格>`；`verify-exports.mjs` 适配新布局（扫描 `media/work`、核验 `media/output` 镜像产物）。
- **CLI 框架 commander → cac（ADR-0010）**：运行时依赖 `commander ^15` 替换为 `cac ^7.0.0`（零依赖、更轻，vite/vitest 系 CLI 同款）；`build*Command`（返回 Command）改为 `registerClip` / `registerSnap`（直接注册 cac 实例），run/list 子命令并入 `clip [action]` / `snap [action]` 内部分发——cac 只匹配 argv 首词、多词命令永不命中，用户侧 `pnpm clip run --dry-run` / `pnpm snap list` 等用法不变；新增 `src/program.ts` 工厂（`createProgram()`，`--version` 单一来源 = package.json）；解析边界统一字符串化（cac 的 mri 把 `--project 1999` 强转 number，`type: [String]` 转换有缺陷故不用）；错误兜底移至入口（未知命令 / 未知选项 / 缺值 / 多余参数均非零退出，`clip run --version` 守卫为只输出版本不再误跑管线）；帮助文本换为 cac 原生格式；新增 `tests/cli.test.ts`（11 条：argv → 选项映射 + 分发层回归）；锁文件以 pnpm 11.27 重写（cac 入、commander 出）。
- 测试 72 → 79 条全绿（typecheck / oxlint 通过）；`package.json` 版本对齐 0.3.0。

### 文档（Docs）

- 新 ADR `0009-三段式媒体目录与项目级泛化.md`；ADR-0003 标注被 0009 取代。
- `CONTEXT.md`（项目/单元/三段式词条 + 规则更新）、`README.md`（布局与命令速查）、`AGENTS.md`（guardrail 路径）、两管线 `SKILL.md`、`re1999-common/PROJECT.md`、`.env.example`、`.gitignore` 全部同步。

> 以下为 0.3.0 之前积累的未发布条目：

### 新增（Added）

- **环境变量驱动的配置面（ADR-0007）**：硬编码路径常量（`EXPORTS_DIR`/`SCREENSHOTS_DIR`/`TEMP_DIR`）与工具二进制（`FFMPEG_BIN`/`FFPROBE_BIN`）统一收进 `src/common/config.ts` 惰性 getter；`loadEnv()` 在 `src/main.ts` 入口加载 `.env`（Node 原生 `process.loadEnvFile`，不引入 dotenv）。新旋钮 `RE1999_EXPORTS_DIR`/`RE1999_SCREENSHOTS_DIR`/`RE1999_TEMP_DIR` 加 `FFMPEG_BIN`/`FFPROBE_BIN`，默认值即旧常量、行为完全兼容；优先级 CLI 旗标 > shell 环境 > `.env` > 默认；空值/非 ASCII 值拒绝并报错；`.env` 进 `.gitignore`，`.env.example` 进 git。规格 `source` 路径是数据而非配置，`media/raw` 只读不变；新测试 `tests/common/config.test.ts`（`vi.stubEnv` 注入，不读真实环境）。

### 文档（Docs）

- ADR-0007；`CONTEXT.md` 新增“配置项（config knob）”词条；`README.md` 新增 Configuration 环境变量表。

### 新增（Added）

- **防纯色帧自动纠偏（ADR-0005）**：截图执行时若 `at` 落在纯色帧（整帧同亮度：黑场 / 频闪白帧），自动向后逐帧搜索窗口内最近有效帧并输出：
  - 判定双信号：YAVG 处于极端区间（黑 ≈0、白 ≈255）**且**全帧亮度均匀——本机 ffmpeg（n9.0.1）signalstats 不输出 YSTD，均匀性以 `YMAX-YMIN ≤ 16` 实现；
  - 窗口上限 64 帧（≈2.56s），纠偏窗口一次解码抽取 65 帧逐张探测，首个有效帧即产物；出窗无有效帧 → 单条报错、跳过其余继续、汇总非零退出码，绝不悄悄输出远处帧；
  - `--strict` 关闭自动纠偏（判坏即单条报错不产出）；`--dry-run` 逐条预警 `将自动纠偏至 ~HH:MM:SS.mmm`；
  - 规格 `at` 保持意图时刻不回写，产物文件名不变，实际取帧时刻与偏移量记录在日志；复现由确定性算法保证（相同 `at` + 相同判定 → 相同产物）。
- 新纯函数模块 `src/shift.ts`（`firstValidFrame` + `planExtraction`）与 `tests/shift.test.ts`：黑/白判定、暗场景不误杀、纠偏命中、出窗报错、`--strict` 行为全覆盖。

### 变更（Changed）

- **src 目录按流水线重组 + 单一入口（ADR-0006）**：源码由平铺 10 文件改为 `src/clip/`、`src/snap/`、`src/common/` 三目录；新增单一入口 `src/main.ts`（程序名 `re1999`，`clip`/`snap` 为子命令，`pnpm clip`/`pnpm snap` 保留为转发别名）；原 `clip.ts`/`snap.ts` 的命令构建与编排逻辑迁入 `src/clip/run.ts`/`src/snap/run.ts`（`buildClipCommand`/`buildSnapCommand`）。纯组织重构，CLI 语义与导出行为不变；测试镜像为 `tests/clip|snap|common/`。
- `media/screenshots/ep1/frames.json` 的 f12/f25 恢复意图时刻（00:02:45 / 00:05:31）——此前被手工 +1s 规避纯色帧，现交由自动纠偏处理。
- `src/ffmpeg.ts`：以 `buildSequenceArgs`（无 filter 的帧序列抽取，`count=1` 即单帧抽取）取代此前未经验证的 select 网格方案，取消 `buildBurstArgs` + `burst` schema 扩展（维持 "frames.json schema 不变"），并废弃不再生产引用的 `buildFrameArgs`。
- `src/snap.ts`：纠偏搜索与 `src/shift.ts` 的 `firstValidFrame` 合并为同一实现（探测谓词注入，纯函数即执行算法）；`--strict --dry-run` 预测到失败时同样置非零退出码，与严格模式"退出码非零汇总"一致；源结束导致的窗口截断以 `WindowEndError` 给出精确报错信息。

### 文档（Docs）

- ADR-0005 补充"实现注记"：YSTD 近似、filtergraph × 输出 seek 在本构建失效的事实、窗口单次抽取、ep01 实测结果。
- `README.md` 与项目技能 `SKILL.md` 补充 snap 自动纠偏与 `--strict` 用法。

## 0.2.0 - 2026-08-30

### 新增（Added）

- **截图帧导出能力（独立脚本 `pnpm snap`）**，从原始素材按绝对时间戳提取单帧为 jpg/png/webp 图片：
  - 规格文件：`media/screenshots/epN/frames.json`，条目为 `{ id, source, at, format, dir? }`；
  - `source` 指向原始素材（`media/raw`）而非导出产物，母版未压缩、不依赖导出产物存留，可随时复现；
  - `at` 复用 `parseTimeToSeconds`（支持秒数 / `MM:SS` / `HH:MM:SS[.mmm]`），越界（≥ 源时长）校验拦截；
  - `format` 每条一个：`jpg`（`-q:v 2` 高质量）/ `png`（无损）/ `webp`（`-quality 90`）；
  - 帧级精确取帧：`-ss` 置于 `-i` 之后（输出 seek），从目标前最近关键帧精确解码（ADR-0004）。
- **每集截图规格发现**：`pnpm snap run` 无参扫描全部 `media/screenshots/epN/frames.json`，`--ep epN` 过滤单集，`--dry-run` 校验预览，`pnpm snap list` 列出现有规格；`-m <path>` 保留显式单文件模式。
- **每集剪辑/截图目录骨架**：`media/screenshots/ep1~ep7` 与 `media/exports/ep1~ep7` 镜像对应。

### 变更（Changed）

- **剪辑清单从单根 manifest 重构为每集清单（ADR-0003）**：
  - 根级 `manifest.json` 移除，11 条 ep01 剪辑迁移至 `media/exports/ep1/manifest.json`（git 识别为 100% rename），清单跟随该集产物目录；
  - `pnpm clip run` 无参扫描 `media/exports/*/manifest.json` 逐集执行，`--ep epN` 只跑一集，`--dry-run` 按集打印计划，新增 `pnpm clip list`；
  - 输出目录默认 = 清单所在目录，`-o <path>` 保留覆盖；
  - `-m <path>` 显式单文件模式保留。
- **领域模型与约束更新（CONTEXT.md）**：新增"截图""截图规格"术语；"导出产物"泛化为剪辑产物（视频）/截图产物（图片）；新增规则"产物与规格同目录""目录映射显式优先"（规格条目 `dir` 显式优先，缺省 = 规格所在目录）。
- **.gitignore 精细化**：`media/exports`、`media/screenshots` 的媒体产物（mp4/jpg/png/webp）保持忽略，但通过 negate 规则保留规格文件（`manifest.json` / `frames.json`）进版本库；原始视频仍不进入 git。
- **校验加固**：`manifest.ts` 与 `framespec.ts` 统一按"路径全 ASCII"规则校验 `id` / `source` / `dir`（input 路径同样受 ASCII 约束）。
- **错误信息可读性**：清单/规格 JSON 解析失败报错携带文件路径上下文；`clip list` / `snap list` 对损坏的规格文件容错（按集报 ERROR 不中断）。

### 修复（Fixed）

- 块注释中出现 `media/exports/*/...` 之类的通配路径时，`*/` 会提前闭合注释导致 oxlint 解析报错（已记入项目技能踩坑记录）。

### 文档（Docs）

- 新增 ADR：`docs/adr/0003-每集清单跟随产物.md`、`docs/adr/0004-截图帧导出.md`。
- 更新 `README.md`（双管线命令速查）、项目技能 `SKILL.md`（每集工作流 + 截图流程 + 注释坑）。
- `verify-exports.mjs` 适配按集扫描：无参时扫描 `media/exports/*/manifest.json`（产物目录 = 清单所在目录），单文件模式保留。

### 测试

- 新增 `tests/framespec.test.ts`（规格解析校验、`dir` 缺省/显式覆盖）、`tests/discovery.test.ts`（按集发现与数字排序）、`tests/ffmpeg.test.ts`（`-ss` 置后 + 格式参数表）；
- `tests/manifest.test.ts` 补 ASCII id 校验用例；
- 共 25 条用例全绿（vitest），typecheck / oxlint 通过；
- 截图管线经真实素材 end-to-end 验证：jpg/png/webp 三格式各 1920×1080 产出；间隔 1 帧的 4 个时间点输出 4 张不同画面（帧级精确性实证）。

---

## 0.1.0 - 2026-08-30

### 新增（Added）

- 项目脚手架：TS7 工具链（TS 兼容 typecheck / tsx）、oxlint（ADR-0002）、vitest、pnpm 工作区配置。
- **剪辑管线 `pnpm clip run`**：以 `manifest.json` 为唯一输入，批量裁剪原始素材：
  - 每条约 `{ id, source, in, out }`，支持秒数 / `MM:SS` / `HH:MM:SS[.mmm]` 时间；`id` 去重、`in < out`、`out ≤ 源时长` 校验；
  - 默认重编码精确模式（`libx264` + `-ss` 前置帧级精确 + `-crf 20 -preset fast` + `-movflags +faststart`），流拷贝 `--copy` 仅作草稿（ADR-0001）；
  - `--dry-run` 校验预览；`FFMPEG_BIN` / `FFPROBE_BIN` 环境变量覆盖。
- **ep01 首批 11 条剪辑**（`ep01-c01` ~ `ep01-c11`）导出至 `media/exports`，实测全部 0.000s 时长误差。
- **素材规范化约定**：原始素材重命名为 `epNN.mp4` ASCII 命名，中文标题映射保存在 `media/raw/videos/README.md`；`media/raw` 内容只读、永不进入 git。
- **核验脚本** `verify-exports.mjs`：按清单对账时长 / h264 / faststart。

### 文档（Docs）

- `CONTEXT.md` 领域术语与规则、ADR `0001-重编码剪辑优先`、ADR `0002-ts7-oxlint`、项目技能 `SKILL.md`（含从零搭建全部踩坑记录）、`README.md`。