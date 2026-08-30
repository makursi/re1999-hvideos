# 保留 TypeScript 7（原生编译器），lint 改用 oxlint

工具链采用 TS 7.0.2（tsgo 原生编译器，typecheck 与 tsx 均兼容）。因其超出 `typescript-eslint 8.x` 的 peer 范围（`<6.1.0`），传统 ESLint 类型感知检查不可用，故弃用 @antfu/eslint-config + eslint，改用 **oxlint**：自带 TS 解析器、与 typescript-eslint 版本锁步无关、规则与 ESLint 同名兼容。这是"向前保持 TS 最新 + lint 解耦"的权衡。