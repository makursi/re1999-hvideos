# CLI 框架：commander 换成 cac（零依赖、更轻的解析层）

## 背景

`commander` 是本项目唯一运行时依赖。它功能面广但体积与维护面都偏重；项目实际只用到了"多命令 + 选项 + 默认值 + 子命令版本"这些基础能力。换成 `cac`（egoist 维护，vite/vitest 系 CLI 的选择）：零运行时依赖、API 更简单、帮助文本自动生成——换取更薄的解析层，代价是下文记录的几处适配。

## 决策

- **依赖替换**：`commander ^15` → `cac ^7.0.0`；`package.json` 的 `pnpm clip` / `pnpm snap` / `pnpm re1999` 脚本不变。
- **注册形态**：`buildClipCommand(): Command` / `buildSnapCommand()` 改为 `registerClip(cli: CAC)` / `registerSnap(cli)` 直接向 cac 实例注册；新增 `src/program.ts` 工厂 `createProgram()`（`cac('re1999')` + 两管线注册 + `cli.help()`），`src/main.ts` 只保留入口职责（`loadEnv` + `parse` + 错误兜底）。
- **命令形态**——cac 的匹配只比较 argv 首词，`command('clip run')` 这类多词命令**永远不会命中**。因此 commander 时代的 `clip run` / `clip list` 子命令并入**单个 `clip [action]` 命令内部分发**（`snap [action]` 同构）。用户侧 CLI 表面不变：`pnpm clip run --dry-run`、`pnpm clip list`、`pnpm snap run --strict` 用法照旧。
- **解析边界字符串化**：cac 的 mri 把数字样值强转成 number（`--project 1999` → `1999`，会破坏对项目/单元名的字符串比较）；同时 cac 7 的 `option(…, { type: [String] })` 转换存在缺陷（未传选项变成 `["undefined"]`、顺带废掉缺值校验）。因此**不使用 type 配置**，改为在分发层经 `toRunOptions` / `toSnapOptions`（共用 `asString`）统一字符串化。
- **错误与退出码兜底在入口**：cac 7 把解析期 `CACError`（未知选项 / 缺值 / 多余参数）直接抛给宿主，未知命令与裸调用甚至静默 `exit 0`。`src/main.ts` 三件事补齐：
  - `try/catch` 包住 `parse()`，报错打印 `[re1999] error: …` 并置 `exitCode = 1`；
  - 监听 `command:*` 事件：未匹配的裸词 = 未知命令，报错置 1；
  - 无匹配命令且无参数时补 `outputHelp()`（裸 `pnpm re1999` 显示帮助、exit 0）。
- **`--version` 单点**：cac 只支持全局版本旗标（`-v, --version`），版本号单一来源 = `package.json`（`src/program.ts` 读取）；子命令级 `--version` 随 ADR-0006 的"原样保留"陈述一并废弃。另，cac 会把全局 `--version` 当作已知选项放行进 action——`clip run --version` 会**真的跑管线**；分发层在每个 action 前守卫 `options.version`，拦截为只输出版本。
- **帮助文本**：接受 cac 原生渲染（`$ re1999 <command> [options]`、命令/选项表、`(default: 20)` 标注）；`--version` 输出含运行环境信息（`re1999/0.3.0 win32-x64 node-v24.9.0`）。

## 后果

- **语义放宽**：`clip` / `clip run` 合并为一张 `clip` 帮助页（含全部 run 选项）；`clip list --dry-run` 这类对 list 无意义的选项被静默接受（commander 时代会当作未知选项报错）；裸 `clip` / `snap` 打印一行 usage 提示（commander 时代显示整页帮助）。
- **语义收紧（fail-fast）**：多余位置参数现在报 `Unused args` 并非零退出（commander 静默忽略）；未知命令 / 未知选项 / 缺值均非零退出——根级未知旗标（`re1999 --bogus`）经 `globalCommand.checkUnknownOptions()` 挂在裸调用分支同样非零退出。
- **清爽点**：`version` 三处硬编码收敛为 package.json 单一来源；`src/program.ts` 让测试可以 `parse(argv, { run: false })` 锁定 argv → 选项映射（`tests/cli.test.ts`，11 条）。
- **锁文件**：仓库锁文件此前以 pnpm 11 双文档格式提交（harness 自带 pnpm v10 解析报"broken lockfile"，属工具版本差异而非文件损坏）；本次用 pnpm 11.27 重写（cac 入、commander 出、管理器版本 11.24 → 11.27），`git diff` 约 45 行。
- **取代关系**：ADR-0006 中"一个 commander 程序、各自保留 run/list 子命令"的陈述被本 ADR 取代；"单一入口 + pnpm clip/snap 转发别名"仍成立。