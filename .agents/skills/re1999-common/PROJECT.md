# re1999-hvideos 项目共用参考

两条管线技能（`re1999-video-clipping` 剪辑、`re1999-snap` 截图）共用的项目级事实、规则与踩坑。**领域模型的唯一权威是 `../../../CONTEXT.md`，本文不替代**；技术决策的唯一权威是 `../../../docs/adr/`（0001~0010），改动任何行为前先读对应档案。

## 项目是什么

把《重返未来：1999》官方短片（以及任意其他素材项目）按清单批量裁剪为片段 mp4（剪辑管线）、并按时间戳提取截图帧（截图管线）的通用媒体 CLI 工具项目。素材经过"输入 → 操作 → 输出"三段式布局（ADR-0009）。

## 目录布局

```
src/ + tests/             # 单一入口 src/main.ts（程序 re1999，clip/snap 命令，ADR-0006/0010，loadEnv 最先执行）+ src/program.ts（createProgram 工厂：cac 接线 + 全局 --version/--help，ADR-0010）+ src/clip|snap/（各流水线注册 registerClip/registerSnap——cac 只匹配 argv 首词，`clip [action]`/`snap [action]` 内部分发 run/list，ADR-0010——与编排）+ src/common/（run-common 共享机制：发现/项目=单元收集/镜像/探测/list/分发 dispatchCacAction/错误处理/loadSpec + config.ts 环境配置面，仅机制不涉领域模型，ADR-0004/0007/0009/0010）+ vitest 用例（含 tests/cli.test.ts argv 映射回归；90 条全绿）
media/input/<项目>/       # 输入层：源素材只读（videos/、audios/ 预留混音），不入 git；<项目>/README.md 锚定 + 中文映射
media/work/<项目>/        # 操作层：版本化规格——clips/<单元>/manifest.json 与 screenshots/<单元>/frames.json
media/output/<项目>/      # 输出层：产物（clips/<单元>/*.mp4、screenshots/<单元>/*.jpg|png|webp），不入 git；路径 = work 镜像
media/temp/               # snap 探针临时目录（可配，不入 git）
docs/adr/ 0001~0010       # 全部技术决策档案（0003 被 0009 取代；0006 的 commander 陈述被 0010 取代）
CONTEXT.md                # 领域模型唯一权威
CHANGELOG.md / README.md  # 变更记录 / 使用说明
.agents/skills/           # re1999-video-clipping/（剪辑 + scripts/verify-exports.mjs）、re1999-snap/（截图）、本文件
```

## 核心规则（速记；权威定义见 CONTEXT.md）

- **素材内容只读**：`media/input/<项目>` 源文件永不修改/删除；仅一次性规范化文件名为 ASCII（如 `epNN.mp4`），中文标题映射存 `media/input/<项目>/README.md`
- **路径全 ASCII**：流水线所有路径只含 `[A-Za-z0-9._-]`，防中文乱码
- **规格与产物分层（取代旧"同目录"规则，ADR-0009）**：规格归 `media/work/<项目>/<类>/<单元>`（进 git），产物默认落 `media/output/<项目>/<类>/<单元>`（work→output 镜像，不入 git）
- **目录映射显式优先**：规格条目 `dir` / CLI `-o` 显式优先，缺省 = work→output 镜像目录
- **项目/单元过滤**：CLI `--project <项目>` 缺省全量、`--unit <单元>` 缺省全量；`list` 按 项目→单元 两级展示
- **防坏帧自动纠偏**：截图 `at` 是意图时刻，纯色帧自动向后纠偏（默认开，`--strict` 关）
- **配置面五旋钮**（ADR-0007/0009）：规格扫描根 `RE1999_WORK_DIR`、产物默认根 `RE1999_OUTPUT_DIR`、探针临时 `RE1999_TEMP_DIR` + 二进制 `FFMPEG_BIN`/`FFPROBE_BIN`；优先级 CLI 显式参数 > shell 环境 > `.env` > 默认；空/非 ASCII 值首次使用时直接报错。**不是配置**：领域常量（帧率 25、纠偏窗口、纯色阈值）与规格 `source` 路径（数据，只读）

## 素材全局事实（实测，1999 项目）

- 全部 7 集：1080p25 h264，每集约 6.5 分钟（ep07 仅 50s，片头曲）
- **关键帧间隔 4~7 秒**（p95 3~5.5s）→ 流拷贝/快速 seek 的切点吸附误差不可接受（ADR-0001 成因）
- **全部无音轨** → 剪辑产物音频轨静音是正确行为
- 单集 25~150MB，合计 ~643MB → 媒体产物永不进 git
- ep01 截图 25 条实测：23 条 `at` 本身有效零偏移，2 条纯色帧自动纠偏（+1 帧 / +0.040s）

## git 约定

- commit message 用英文、Conventional Commits（如 `feat: ...` / `docs: ...`），**不用中文**
- **例行操作（写 spec、导出、截图）直接提交 main**；仅**项目迭代**（`src/`、`tests/`、CLI 行为、文档、ADR、skill 改动）走分支 → push → PR → merge → `git checkout main && git pull`
- `media` 媒体产物永不提交；`media/work` 下的 `manifest.json` / `frames.json` 是输入，进版本库

## 项目级踩坑（工具链/仓库通用，与具体管线无关）

1. **中文路径乱码 / 工具视图不一致**：bash 下正常、ffprobe 报 `Illegal byte sequence`；Node `readdirSync` 与 `ls` 不一致。预防：全 ASCII 路径；一律用 Node `execFileSync` 传参数（不经 shell 转义）；涉及路径的命令先 `ls` 验证。
2. **TS7 × ESLint 生态不兼容**：`typescript-eslint` peer 要求 `<6.1.0`，TS 7 被拒 → 保留 TS7，lint 用 oxlint（自带 TS 解析器，规则同名兼容；ADR-0002）。
3. **pnpm 11 把"忽略构建脚本"当硬错误**：`ERR_PNPM_IGNORED_BUILDS` 会让所有 `pnpm run` 前置失败 → `pnpm-workspace.yaml` 的 `allowBuilds` 用 **map 语法** `esbuild: true`（数组写法解析成坏键值对）。
4. **git 大文件误暂存**：ignore 规则对**已在索引中**的文件无效 → `git rm --cached .../*.mp4`（磁盘保留）再 `git add -A`；提交前 `git ls-files | xargs du -ch` 验体积。
5. **TS7 类型推断更严格**：从 `Record<string, unknown>` 取值直接返回报类型错误 → 显式断言（如 `in: input as TimeInput`）；解析层保持纯函数 + 显式类型。另有 `noUncheckedIndexedAccess`：数组/元组解构会得到 `T | undefined`，测试里用 `as const` 元组解决。
6. **目录被外部重命名（环境视图滞后）**：涉及文件路径的命令每次先 `ls`/`readdir` 确认；规格引用以磁盘实际为准。
7. **代码注释里的通配路径**：写 `media/work/*/clips/epN/manifest.json` 会让 `*/` 提前闭合块注释导致 oxlint 解析报错 → 注释里用 `<项目>`/`<单元>` 或 `epN` 占位（本技能里统一写成 `media/work/<项目>/clips/<单元>/manifest.json`）。
8. **git mv 后内容需改写**：把版本化规格搬目录（git mv）后，规格里的 `source` 相对路径必须同步改写，否则管线找错素材（ADR-0009 迁移时全量改写为 `media/input/...`）。

## 工具链

`pnpm typecheck` / `pnpm lint` / `pnpm lint:fix` / `pnpm test`；配置面（ADR-0007/0009）：`RE1999_WORK_DIR`/`RE1999_OUTPUT_DIR`/`RE1999_TEMP_DIR` 覆盖扫描根/产物根/临时目录、`FFMPEG_BIN`/`FFPROBE_BIN` 覆盖二进制；优先级 CLI > shell 环境 > `.env`（`process.loadEnvFile` 不覆盖已设变量，含空串）> 默认；改法 = `cp .env.example .env` 后编辑（`.env` 不提交）；Node ≥ 20.6。具体命令以 `package.json` 为准。