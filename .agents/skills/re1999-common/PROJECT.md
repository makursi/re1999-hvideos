# re1999-hvideos 项目共用参考

两条管线技能（`re1999-video-clipping` 剪辑、`re1999-snap` 截图）共用的项目级事实、规则与踩坑。**领域模型的唯一权威是 `../../../CONTEXT.md`，本文不替代**；技术决策的唯一权威是 `../../../docs/adr/`（0001~0005），改动任何行为前先读对应档案。

## 项目是什么

把《重返未来：1999》官方短片素材（`media/raw`，只读）按清单批量裁剪为片段 mp4（剪辑管线）、并按时间戳提取截图帧（截图管线）的 CLI 工具项目。

## 目录布局

```
src/ + tests/             # CLIs (clip, snap) + run-common 共享编排（发现/探测/list/错误处理/loadSpec，仅机制不涉领域模型，ADR-0004）+ 纯函数模块 + vitest 用例（61 条全绿）
media/raw/                # 源素材（只读，永不变更、永不提交 git）；audios/ 预留混音
media/exports/epN/        # 剪辑产物 {id}.mp4 + 该集 manifest.json（跟随产物）
media/screenshots/epN/    # 截图产物 {id}.{format} + 该集 frames.json（跟随产物）
docs/adr/ 0001~0005       # 全部技术决策档案
CONTEXT.md                # 领域模型唯一权威
CHANGELOG.md / README.md  # 变更记录 / 使用说明
.agents/skills/           # re1999-video-clipping/（剪辑 + scripts/verify-exports.mjs）、re1999-snap/（截图）、本文件
```

## 核心规则（速记；权威定义见 CONTEXT.md）

- **素材内容只读**：`media/raw` 源文件永不修改/删除；仅一次性规范化文件名为 ASCII（`epNN.mp4`），中文标题映射存 `media/raw/videos/README.md`
- **路径全 ASCII**：流水线所有路径只含 `[A-Za-z0-9._-]`，防中文乱码
- **产物与规格同目录**：`manifest.json` 跟随剪辑产物、`frames.json` 跟随截图产物；规格文件进 git，媒体产物永不提交
- **目录映射显式优先**：规格条目 `dir` 显式优先，缺省 = 规格所在目录
- **防坏帧自动纠偏**：截图 `at` 是意图时刻，纯色帧自动向后纠偏（默认开，`--strict` 关）

## 素材全局事实（实测）

- 全部 7 集：1080p25 h264，每集约 6.5 分钟（ep07 仅 50s，片头曲）
- **关键帧间隔 4~7 秒**（p95 3~5.5s）→ 流拷贝/快速 seek 的切点吸附误差不可接受（ADR-0001 成因）
- **全部无音轨** → 剪辑产物音频轨静音是正确行为
- 单集 25~150MB，合计 ~643MB → 媒体产物永不进 git
- ep01 截图 25 条实测：23 条 `at` 本身有效零偏移，2 条纯色帧自动纠偏（+1 帧 / +0.040s）

## git 约定

- commit message 用英文、Conventional Commits（如 `feat: ...` / `docs: ...`），**不用中文**
- **例行操作（写 spec、导出、截图）直接提交 main**；仅**项目迭代**（`src/`、`tests/`、CLI 行为、文档、ADR、skill 改动）走分支 → push → PR → merge → `git checkout main && git pull`
- `media` 媒体产物永不提交；`manifest.json` / `frames.json` 是输入，进版本库

## 项目级踩坑（工具链/仓库通用，与具体管线无关）

1. **中文路径乱码 / 工具视图不一致**：bash 下正常、ffprobe 报 `Illegal byte sequence`；Node `readdirSync` 与 `ls` 不一致。预防：全 ASCII 路径；一律用 Node `execFileSync` 传参数（不经 shell 转义）；涉及路径的命令先 `ls` 验证。
2. **TS7 × ESLint 生态不兼容**：`typescript-eslint` peer 要求 `<6.1.0`，TS 7 被拒 → 保留 TS7，lint 用 oxlint（自带 TS 解析器，规则同名兼容；ADR-0002）。
3. **pnpm 11 把"忽略构建脚本"当硬错误**：`ERR_PNPM_IGNORED_BUILDS` 会让所有 `pnpm run` 前置失败 → `pnpm-workspace.yaml` 的 `allowBuilds` 用 **map 语法** `esbuild: true`（数组写法解析成坏键值对）。
4. **git 大文件误暂存**：ignore 规则对**已在索引中**的文件无效 → `git rm --cached .../*.mp4`（磁盘保留）再 `git add -A`；提交前 `git ls-files | xargs du -ch` 验体积。
5. **TS7 类型推断更严格**：从 `Record<string, unknown>` 取值直接返回报类型错误 → 显式断言（如 `in: input as TimeInput`）；解析层保持纯函数 + 显式类型。
6. **目录被外部重命名（环境视图滞后）**：涉及文件路径的命令每次先 `ls`/`readdir` 确认；规格引用以磁盘实际为准。
7. **代码注释里的通配路径**：写 `media/exports/*/manifest.json` 会让 `*/` 提前闭合块注释导致 oxlint 解析报错 → 注释里用 `epN` 占位（`media/exports/epN/manifest.json`）。

## 工具链

`pnpm typecheck` / `pnpm lint` / `pnpm lint:fix` / `pnpm test`；`FFMPEG_BIN`/`FFPROBE_BIN` 可覆盖二进制。具体命令以 `package.json` 为准。