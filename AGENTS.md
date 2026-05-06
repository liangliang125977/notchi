# AGENTS.md

> 本文件是 AI 编程助手在本项目工作时的硬约束。
> 详细规则按文件路径分散在 `.Codex/rules/`（v1.x 启用）。
> 本文件总长度 ≤ 200 行。

## 项目概述

**Coding Pet** — macOS Apple Silicon 桌面 Live2D 编程宠物，住在刘海下方/虚拟刘海岛位置，被动可视化 AI 编程工具的 token 用量与会话状态。

详见 [SPEC.md](./SPEC.md)。

## 技术栈

> ✅ 已在人工检查点 ② 选定（2026-05-05）。详见 [SPEC.md §6.6](./SPEC.md)。

- **桌面壳**：Tauri 2.x（Rust 主进程 + WKWebView）
- **前端**：React 19 + TypeScript + Vite
- **样式**：Tailwind CSS 4（fallback 3.4）+ shadcn/ui
- **动效**：Framer Motion
- **Live2D**：`pixi-live2d-display` + PIXI.js v7
- **图标**：Lucide React
- **图表**：Recharts
- **状态**：Zustand
- **后端（Rust）**：`notify`（fsevents）、`rusqlite`、`tauri-plugin-sql`、`rust_decimal`
- **打包**：`tauri build` → 签名 + 公证 → .dmg

## 构建与运行

```bash
# 首次安装
pnpm install
cargo --version  # 需 Rust 1.77+
rustup target add aarch64-apple-darwin

# 开发（前端 HMR + Tauri 主进程）
pnpm tauri dev

# 测试
pnpm test          # 前端 Vitest
cargo test         # Rust 单元 + 集成

# Lint
pnpm lint          # ESLint + Prettier
cargo clippy -- -D warnings

# 类型检查
pnpm typecheck

# 打包 dmg（仅 Apple Silicon）
pnpm tauri build --target aarch64-apple-darwin
# 产物：src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/*.dmg
```

## 项目结构

> 待项目脚手架搭建后由 Codex 扫描自动填写。

## AI 角色边界（硬约束）

### 需求发现阶段
- 禁止提及具体技术栈或实现方案
- 禁止替用户做产品判断
- 只能提问、记录、结构化整理
- 可以指出遗漏场景，但必须以提问形式

### 技术设计阶段
- 必须提供 2-3 个方案并分析利弊
- 禁止在用户选定前开始实现
- 架构复杂度必须匹配项目实际规模（一周 MVP 不要给企业级架构）

### 编码实现阶段
- **不得偏离已确认的 SPEC.md**（19 个验收场景）
- **不得增加 SPEC 中未定义的功能**
- 遇到 SPEC 中的歧义，记录到 CHANGELOG.md 并跳过，不要猜测
- 自动修复循环最多 3 次，3 次后跳过并记录
- 每个任务一个 commit，commit message 引用任务编号（如 T1.3）

### Code Review 阶段
- 不得自动合并 PR
- 不得修改已有测试以适配新代码

## 编码规范

- 使用最简单的实现方式，避免过度抽象
- 不预留"为未来扩展"的口子（YAGNI）；当前任务不需要的不写
- 默认不写注释；只在 WHY 非显而易见时写一行
- 不写"修复了什么 bug"风格的注释，那属于 commit message
- 函数 / 文件命名遵循所选技术栈的社区惯例

## 禁止操作

- 不得删除已有测试文件
- 不得直接修改 main 分支（用 `Codex/<task>` 分支）
- 不得修改 `.env` 文件
- 不得在没有手测验证的情况下声称功能完成
- 不得提交 Live2D 商业授权资产到仓库
- 不得在代码或日志中泄露用户的 API key、token 内容、代码内容
- 不得发起任何外部网络请求（除 SPEC.md S12 允许的两类）

## Git 规范

- 分支命名：`feature/<描述>`、`fix/<描述>`、`Codex/<task-id>`
- Commit message：`type(scope): description`
  - type：feat / fix / refactor / chore / docs / test / perf
  - scope：阶段编号或模块（如 `T1.3` / `notch` / `live2d`）
- 所有改动通过 Draft PR 合并到 main
- PR 描述必须列出：覆盖的 SPEC 场景编号、测试结果、截图（UI 改动）

## 隐私底线（SPEC.md S12 镜像）

- 不上传任何 token 数据到外部服务器
- 不上传代码内容、会话内容、用户路径
- 仅允许：版本检查（可关）、首次 Live2D 资源下载（一次性）
- 任何新增网络请求都必须在 PR 描述中显式声明并被 review 批准

## 性能预算（SPEC.md S10 镜像）

- 空闲 CPU 平均 < 2%
- 常驻内存 < 200MB
- 启动时间 < 2s
- 数据回填 < 30s

任何 PR 必须不引入预算回归。怀疑会回归时跑性能 smoke。

## 已知环境限制

- macOS Live2D 渲染必须在主线程；后台线程操作会崩溃
- `NSScreen.safeAreaInsets` 仅在 macOS 12+ 可用，本项目最低 macOS 13
- fsevents 在外接 SMB / NFS 卷上不可靠（`~/.Codex/projects` 默认本地，不影响）
- Apple 公证需要开发者账号（$99/年）；MVP 阶段允许"右键打开"绕过
- Live2D Cubism SDK 4.x 与早期版本不兼容，必须锁定版本

## 详细规则

后续按文件路径匹配的细则放 `.Codex/rules/`（v1.x）：

```
.Codex/rules/
├── ui.md           # globs: ["src/ui/**", "**/*.swift", "**/*.tsx"]
├── data.md         # globs: ["src/data/**", "**/*.sql", "**/migrations/**"]
├── live2d.md       # globs: ["src/live2d/**", "assets/live2d/**"]
└── packaging.md    # globs: ["scripts/build/**", "*.entitlements"]
```

每个规则文件格式：

```markdown
---
globs: ["匹配模式"]
---

# 规则标题
- 具体规则
```
