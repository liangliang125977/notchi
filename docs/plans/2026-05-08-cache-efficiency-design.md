# Cache Efficiency 视图 + 宠物情绪挂钩 — 设计文档

**日期**: 2026-05-08
**作者**: brainstorming with Claude
**状态**: 已批准，待实施

## 1. 背景与动机

Claude / Codex 等 AI 工具用 prompt cache 复用上下文，cache 读取的计费仅为基准价的 10%。一个长会话有没有用对 cache，成本可以差 5-10 倍。

Notchi 当前已经在 SQLite 分别记录 `input_tokens` / `cache_read_input_tokens` / `cache_creation_input_tokens` / `output_tokens`，但 UI 只展示总和。**调研显示市面所有竞品（ccusage、Buddy、Codex Pets、tokscale）都没把 cache hit rate 做成主指标，更没人和宠物情绪挂钩**——这是 Notchi 当前差异化最大的空白格。

用户当前真实数据：
- Claude Code 7 天 cache hit rate **97.7%**（87.1M cache reads，估算省 ~$235）
- Codex 93.3%
- Claude Desktop 89.9%

## 2. 范围（v1）

| 编号 | 功能 | 工作量 |
|---|---|---|
| A | 概览页 Cache Efficiency KPI 卡片（含省钱估算） | 0.5 天 |
| B | By tool / By model BarList 加 cache hit % 列 | 0.5 天 |
| C | 宠物 mood 融合 cache 1h 滚动命中率 | 0.5 天 |

**不在 v1**: D（命中率骤降通知），E（cache 时序图），未来需要再加。

## 3. 关键决策

| 议题 | 决策 | 理由 |
|---|---|---|
| Savings 估算 | 展示 `Saved ~$X` | 传播性最强；现有 pricing 表已有 Anthropic+OpenAI seed |
| 时间维度 | 跟随 period（today/week/month）切换 | 与 Tokens / Sessions 卡片一致 |
| 宠物窗口 | 1h 滚动 | 反应及时不冷启动误判，需 ≥5 个事件样本才生效 |
| 宠物表达 | 复用 hungry/content/happy | 零新动画资产 |
| Savings 计算位置 | 后端 | 需要 JOIN pricing 表 |
| Hit rate 计算位置 | 前端 | TokenSummary 已含原始数字，做除法即可 |

## 4. 架构

```
                     period-aware                  per-1h
  ┌─────────────┐                                 ┌──────────────────┐
  │ OverviewPanel │── invoke('token_summary') ──▶  │ token_summary()  │
  │             │                                 │ + savings JOIN   │
  │ <CacheCard/>│ ◀──── TokenSummary ─────────── │                  │
  │             │                                 │ + cache_pulse_1h │
  │ BarList     │── invoke('token_by_source')─▶   │ group_by()       │
  │             │ ◀──── GroupRow[] ───────────── │ + cache_hit_pct  │
  └─────────────┘                                 └──────────────────┘

  ┌─────────────┐    每 30s 轮询                  ┌──────────────────┐
  │  PetCanvas  │── invoke('pet_status') ─────▶   │ pet_status()     │
  │             │                                 │ feed_mood +      │
  │ mood 渲染   │ ◀──── PetStatus { mood }─────── │ cache_pulse_1h   │
  └─────────────┘                                 │ → fuse_mood()    │
                                                  └──────────────────┘
```

**关键不变量**:
- `cache_pulse_1h` 不暴露给前端面板，仅参与 pet mood
- 前端面板的 cache 数据全部来自 period-aware 的 token_summary / group_by
- 派生指标（hit rate）放前端，原始指标 + 需要 JOIN 的（savings）放后端

## 5. 后端改动

### 5.1 `queries.rs::TokenSummary`

```rust
pub struct TokenSummary {
    // 现有字段保留 ...
    pub cache_savings_usd: String,   // 新增：~$X 估算
}
```

`token_summary()` SQL 加 savings 子查询，按 model JOIN pricing 表，公式：
```
savings = SUM(cache_read_tokens / 1_000_000 × (input_per_mtok - cache_read_per_mtok))
```

pricing 表无该 model → 用全表 input 价中位数 fallback。

### 5.2 `queries.rs::GroupRow`

```rust
pub struct GroupRow {
    // 现有字段保留 ...
    pub cache_hit_pct: f64,   // 新增
}
```

`group_by()` SUM 加 cache_read / cache_creation / input 三列，前端用即可，但放后端方便后续按列排序。

### 5.3 新增 `queries.rs::cache_pulse_1h()`

```rust
pub struct CachePulse {
    pub hit_pct: f64,
    pub samples: i64,
}

pub async fn cache_pulse_1h(pool: &SqlitePool) -> Result<CachePulse, sqlx::Error>;
```

不暴露为 Tauri 命令——仅由 `pet_status` 内部调用。

### 5.4 `evolution.rs::pet_status`

```rust
fn fuse_mood(feed_mood: Mood, cache: &CachePulse) -> Mood {
    if cache.samples < 5 { return feed_mood; }
    let cache_mood = match cache.hit_pct {
        p if p >= 90.0 => Mood::Happy,
        p if p >= 70.0 => Mood::Content,
        _              => Mood::Hungry,
    };
    feed_mood.min(cache_mood)
}
```

## 6. 前端改动

### 6.1 `OverviewPanel.tsx`

`<CacheCard>` 复用现有 `.ov-card` 类，渲染：
- 主数字: `${hitPct.toFixed(1)}%`
- delta（仅 today period）: `↑${delta}% vs ${t.overview.yesterday}`
- 子行 1: `Saved` ↔ `~$${cache_savings_usd}`
- 子行 2: `Cache reads` ↔ `${formatTokens(cache_read)}`

加权平均公式（前端）:
```ts
const hitPct = cache_read / (input + cache_read + cache_creation) * 100;
```

### 6.2 `BarList`

`ov-bar-row` 末尾加 `<span class="ov-bar-cache">cache ${pct}%</span>`，font-size 11px，color: var(--sp-muted)。

仅 By tool / By model 显示，By project 不显示。

### 6.3 `locales.ts`

新增 5 条 i18n 文案（中英）：
- `overview.cacheEfficiency`
- `overview.cacheSaved`
- `overview.cacheReads`
- `overview.cacheVsYesterday(d)`
- `overview.cacheLabel(p)`

## 7. 边界与降级

| 边界 | 处理 |
|---|---|
| period 内零事件 | hitPct = 0，savings = 0，UI 显示 `—` |
| 1h 内零事件 | `samples=0` → 不影响 mood（沿用 feed_mood） |
| input + cache 全 0 | hitPct = NaN → 视为 100% |
| pricing 表缺该模型 | savings 用 fallback 中位数，前缀 `~` |
| 跨 source 聚合 | 按 input + cache 总量加权平均，不是算术平均 |

## 8. 测试

仅 1 个 Rust 单元测试：`fuse_mood` 真值表 5 条关键交叉点。

前端不加测试（baseline 无前端测试，YAGNI）。

E2E 验证：手动 `pnpm tauri dev`，确认：
1. 概览页 Cache Card 显示数字与手算一致
2. BarList 末尾 cache % 与每行原始数据匹配
3. 宠物在 cache hit < 70% 时变 hungry（开发期可用 SQL 直接构造异常事件验证）

## 9. 不做清单（YAGNI）

- 命中率骤降通知（D）
- Cache 时序图
- By project 维度 cache 列
- Cache miss 原因诊断（"是不是切了模型？"）
- 历史命中率趋势线

## 10. 后续可能扩展

- D（通知）：1h 命中率掉超过 30 个百分点 → 触发 macOS 通知 + 24h 抑制
- 进化挂钩：连续 7 天 hit rate ≥ 90% → 解锁"Cache Master"形态
- 博文素材：发布时配合一篇 "How Notchi caught my Claude cache leak" 的故事性文章
