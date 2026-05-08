# Pet System Redesign — 设计文档

**日期**: 2026-05-08
**作者**: brainstorming with Claude
**状态**: 已批准，待 writing-plans 出施工计划

## 1. 背景与动机

当前 Notchi 的宠物子系统硬编码 6 个 Live2D Cubism 模型（mao / haru / hiyori / mark / natori / rice），全部是 Live2D 官方示例资产，存在以下问题：

1. **身份不清晰**：示例资产是动漫人物，与 Notchi 的「Apple-flavoured minimalism + 编程伴侣」品牌定位脱节
2. **扩展门槛高**：每加一只宠物要手写 `petModels.ts`，硬编码 motion 索引
3. **格式单一**：只支持 Live2D；Lottie / GIF / sprite 等更轻量、更易获取 CC0 资源的格式无法接入
4. **授权风险**：Live2D Free Material License 限定「个人 / 小企业」用途，未来 App Store 分发会受限

调研 LottieFiles 后发现：上面有上万个 CC0/MIT 编程主题动画（robot/cat/ghost/rocket 等），单文件 30-200KB，是绕开授权困境 + 快速丰富宠物多样性的金矿。

## 2. 范围

| 阶段 | 内容 | 是否在本次 plan 内 |
|---|---|---|
| 1 | 抽象统一 Pet 引擎接口；现有 6 只 Live2D 迁到 manifest 模式 | ✅ |
| 2 | 加 Lottie 引擎 + 1 只示范宠物 | ✅ |
| 3 | 加 Sprite (GIF/APNG) 引擎 + 1 只示范宠物 | ✅ |
| 4 | 加 5-10 只新 Lottie 宠物丰富度 | ❌ 后续 sprint |
| 5 | 用户上传 / marketplace / AI 生成 | ❌ v0.3+ |

**总工程量**：约 4.25 天

## 3. 关键决策

| 议题 | 决策 |
|---|---|
| 不满意点 | 当前宠物身份不清晰，不像「编程伴侣」 |
| 主题方向 | **不预设主题**，而是开放扩展（多种类） |
| 核心需求 | 开发者增加新宠物要丰富 + 低门槛 |
| 资产格式 | Live2D（保留现有） + Lottie + GIF/APNG |
| 新增宠物流程 | 放文件夹 + manifest.json，Vite 自动扫描 |
| Engine 接口 | 三个独立引擎，统一 React 组件签名 |
| 现有 PetCanvas | 保留为 Live2DEngine 的 alias，零回归 |
| 老 petModels.ts | 改 shim 兼容层不删，下版统一切走 |
| Sprite sheet 帧拆 | 不做（YAGNI），仅 GIF/APNG 浏览器原生解码 |

## 4. 架构

### 模块布局

```
src/components/pets/
├── PetRenderer.tsx               - 总调度，按 manifest.engine 选 engine
├── engines/
│   ├── Live2DEngine.tsx          - 现有 PetCanvas 内核搬家
│   ├── LottieEngine.tsx          - 新增（lottie-react 包装）
│   └── SpriteEngine.tsx          - 新增（GIF/APNG <img> 包装）
└── PetEngineProps.ts             - 共享 props 接口

src/lib/
├── petManifest.ts                - manifest schema + zod 校验
├── petRegistry.ts                - import.meta.glob 扫描注册中心
└── petModels.ts                  - deprecation shim，运行期从 registry 派生

public/assets/pets/
├── mao/, haru/, hiyori/, mark/, natori/, rice/   - [Live2D] 现有 + manifest
├── ghost-coder/                  - [Lottie] 示范
└── pixel-cat/                    - [Sprite/GIF] 示范
```

### Manifest schema

```ts
interface PetManifest {
  id: string;                     // 与目录名一致
  name: string;
  description?: string;
  engine: "live2d" | "lottie" | "sprite";
  thumbnail?: string;
  actions: Record<PetAction, ActionSpec>;
  credits?: { author?: string; license?: string; sourceUrl?: string };
}

interface ActionSpec {
  src: string;                    // 资产相对路径
  loop?: boolean;
  options?: Record<string, unknown>;  // engine-specific
}

type PetAction = "idle" | "coding" | "waiting" | "done" | "sleep";
```

各引擎对 ActionSpec.options 的解释：

| engine | options 字段 |
|---|---|
| live2d | `{ group: string, index: number }` 替代现有 actionMotions |
| lottie | `{ fps?: number, markers?: string[] }`（v1 只用 fps） |
| sprite | `{ duration?: number }`（仅一次性 action 估算播放时长） |

### Vite 注册机制

```ts
const manifests = import.meta.glob<PetManifest>(
  "/public/assets/pets/*/manifest.json",
  { eager: true, import: "default" }
);
```

构建时静态扫描，零运行时开销。删一个文件夹就少一只宠物。

### 引擎接口

```ts
interface PetEngineProps {
  size: number;
  action: PetAction;
  manifest: PetManifest;
  onActionEnd?: (action: PetAction) => void;
}

export const Live2DEngine: React.FC<PetEngineProps>;
export const LottieEngine: React.FC<PetEngineProps>;
export const SpriteEngine: React.FC<PetEngineProps>;
```

### Action 完成检测

| 引擎 | 一次性 action 完成 |
|---|---|
| Live2D | pixi-live2d-display 的 motion completion callback |
| Lottie | `onComplete` 回调 |
| Sprite/GIF | `setTimeout(spec.options.duration ?? 1500)` |

完成后调用 `onActionEnd(action)` → petStore 调度回 idle。

## 5. 迁移步骤

**阶段 1：架构搬家（零回归）**
- 6 只现有 Live2D 宠物自动生成 manifest（脚本读旧 petModels.ts）
- PetCanvas 内核 → Live2DEngine
- PetRenderer + petRegistry 上线
- 此时打包行为 = 今日体验

**阶段 2：新引擎 + 示范宠物**
- 装 `lottie-react` 依赖
- ghost-coder（Lottie 从 LottieFiles 拿 CC0 资源）
- pixel-cat（GIF 从 giphy CC0 资源）

## 6. 边界与降级

| 边界 | 处理 |
|---|---|
| manifest.json 损坏 | 跳过 + console warning |
| zod 校验失败 | 同上 |
| 资产 404 | engine 内 fetch 失败 → emit fallback event → 静态 PNG（v1.7 已实现） |
| Lottie 文件 > 1MB | 仅 warning |
| 同 id 多个 manifest | glob 字母序后者覆盖前者 |
| 切换到不存在的 id | 默认到注册表第一个 |
| engine 加载超时 | v1.7 fallback 计时器兜底 |

## 7. 测试

- 无 Rust 改动 → 无新单元测试
- 前端按项目 baseline 不加单元测试
- 手动 E2E：
  1. 启动 dev，6 只 Live2D 切换正常
  2. 切到 ghost-coder（Lottie），动画正常
  3. 切到 pixel-cat（GIF），图像正常
  4. 触发 done：3 种引擎各自正确「播一次回 idle」
  5. 故意改坏一个 manifest.json：app 不 crash，console warn

## 8. 不做清单（YAGNI）

- 用户上传宠物
- 宠物 marketplace / 社区分享
- AI 生成宠物
- Sprite sheet 帧拆解
- Lottie marker 片段
- 宠物预览面板里的动态预览（静态 thumbnail.png 即可）
- 跨设备同步选中宠物

## 9. 任务拆分（后续 plan 文件会展开）

| 任务 | 工作量 |
|---|---|
| 1. PetManifest schema + zod | 0.5 天 |
| 2. petRegistry + glob 扫描 | 0.5 天 |
| 3. PetRenderer + 抽 Live2DEngine | 1 天 |
| 4. 6 只现有宠物 manifest 生成 | 0.5 天 |
| 5. 老 petModels.ts shim | 0.25 天 |
| 6. LottieEngine + 1 只示范 | 0.75 天 |
| 7. SpriteEngine + 1 只 GIF 示范 | 0.5 天 |
| 8. 手动 E2E + push | 0.25 天 |

总计：约 4.25 天，单一 plan 文件 `docs/plans/2026-05-08-pet-system-redesign-plan.md` 涵盖全部任务。
