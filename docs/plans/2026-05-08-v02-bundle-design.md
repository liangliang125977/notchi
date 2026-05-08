# Notchi v0.2 Bundle — 设计文档

**日期**: 2026-05-08
**作者**: brainstorming with Claude
**状态**: 已批准，待 writing-plans 出施工计划

## 1. 背景与动机

v0.1.0 已发布（包含 Live2D + 多源采集 + 进化系统 + Cache Hit Rate + 宠物情绪）。v0.2 围绕**"AI 信号 → 宠物表情"**的核心定位，把三个互补的能力整合成一个 bundle：

1. **Subagent 雷达**：Claude Code subagent 数据（`agent-*.jsonl`）已在硬盘，但社区 [issue #22625](https://github.com/anthropics/claude-code/issues/22625) 显示 Anthropic 还没出官方聚合视图。本机 446 个 subagent 文件 / 21 项目 / 120 会话——金矿。
2. **Burn-rate 预警**：v2.1.89 之后社区焦虑达峰值，[Claude-Code-Usage-Monitor](https://claudefa.st/blog/tools/monitors/claude-code-usage-monitor) 等终端工具已验证需求，但没人把它转成"被动呈现 + 情感反馈"。
3. **Hooks 接收器**：v2.1+ 官方支持 [HTTP hooks](https://code.claude.com/docs/en/hooks)，没人把 hook 接到桌宠表情上。Notchi 与 Anthropic 生态绑定的最强 brand 动作。

调研详见 `(2026-05-08 deep research, 内嵌于会话历史)`。

## 2. 范围（v0.2）

| 编号 | 功能 | 工作量 |
|---|---|---|
| #1 | Subagent 轨道点雷达 + token 颜色映射 + 60s 活跃判定 | 4 天 |
| #2 | 30min 滚动 burn-rate + 月度预算外推 + 胶囊预警 | 3 天 |
| #3 | 内嵌 HTTP server + Hooks 一键安装 + 临时表情 | 3 天 |

**不在 v0.2**: 国内 Coding Plan / 多 Key 分账 / MCP 健康度（后续 sprint）

## 3. 已批准的关键决策

| 议题 | 决策 |
|---|---|
| #1 视觉 | 主宠周围 12px 彩色点，半径 100px 圆周 30s 转一圈 |
| #1 活跃判定 | 对应 jsonl 最后一行 60s 内写入 |
| #1 颜色 | 该 subagent 会话 token 总量（绿 < 10K，橙 10–100K，红 > 100K） |
| #2 算法 | 最近 30 分钟 tokens/min · 线性外推到月底 |
| #2 阈值参考 | 月度成本预算（用户设定，默认 $50） |
| #2 status | calm / warm / hot / scorching（按 projected/budget 比） |
| #3 接受机制 | 内嵌 HTTP server（127.0.0.1 + 随机端口） |
| #3 监听事件 | PreToolUse / PostToolUse / Stop |
| #3 安装 UX | Settings 一键开关，自动备份 + 合并写 settings.json |
| 架构 | 方案 A — 三个独立子系统共享 Tauri 事件总线 |
| Hook 事件 | 不入 SQLite，仅触发 600ms 瞬态前端动画 |
| Mood 融合 | feed × cache × burn 三路取最差；hooks 临时表情不进 mood |

## 4. 总架构

```
┌──────────────────────────────────────────────────────────┐
│                  src-tauri (Rust 后端)                    │
│                                                            │
│  data/sources/claude_code.rs  ─ 扩展：识别 subagents/      │
│  data/subagents.rs            ─ 新：active_subagents()    │
│  data/burn_rate.rs            ─ 新：burn_rate_now()       │
│  data/evolution.rs            ─ 改：fuse_mood +burn       │
│  hooks/server.rs              ─ 新：axum HTTP 127.0.0.1   │
│  hooks/install.rs             ─ 新：settings.json 改写    │
└────────┬─────────────────────────────────────┬──────────────┘
         │ Tauri event emit                     │ Tauri command
         │  pet:subagents-changed               │  burn_rate_now
         │  pet:burn-rate-changed               │  install_hooks
         │  pet:hook-event                      │  uninstall_hooks
         ▼                                      │
┌────────────────────────────────────────────────▼─────────────┐
│                  src (React 前端)                              │
│                                                                │
│  PetCanvas              ← subagents → 轨道点                    │
│  BurnRateOverlay        ← burn-rate → 胶囊                     │
│  PetExpressionLayer     ← hook-event → 600ms 表情切换           │
│  Settings/HooksToggle   → install/uninstall_hooks               │
│  Settings/BurnRateBudget→ monthly_budget_usd                    │
└────────────────────────────────────────────────────────────────┘
```

### 数据存储改动

`events` 表加 2 列（migration 幂等）：

```sql
ALTER TABLE events ADD COLUMN agent_id TEXT;
ALTER TABLE events ADD COLUMN parent_session_id TEXT;
CREATE INDEX IF NOT EXISTS idx_events_agent
  ON events(agent_id) WHERE agent_id IS NOT NULL;
```

settings store 加 1 个 key：`monthly_budget_usd`（默认 50.0）。

Hooks 事件**不入 SQLite**——保持瞬态。

## 5. #1 Subagent 雷达

### 后端
- `data/sources/claude_code.rs::discover_paths`：在原 jsonl 路径之外加 `subagents/agent-*.jsonl`
- `data/sources/claude_code.rs::parse_line`：路径含 `subagents/agent-` 时，把 `agentId` 和顶层 `sessionId`（作为 parent_session_id）写入 events
- `data/subagents.rs`（新）：
  - `struct ActiveSubagent { agent_id, parent_session_id, model, total_tokens, last_seen_iso, is_alive }`
  - `async fn active_subagents(pool) -> Vec<ActiveSubagent>` —— 2 分钟内有事件的 agent，is_alive = (now - last_seen < 60s)
  - 后台任务每 5 秒查一次，diff 与上次结果，emit("pet:subagents-changed", payload)

### 前端
`PetCanvas.tsx` 维护 `SubagentDot[] = { agentId, color, angle, alive }`：
- 每个 dot 直径 12px，position: absolute 覆盖在 PetCanvas 上层
- requestAnimationFrame 驱动 angle += 360°/30s
- 颜色按 token：< 10K 绿 / 10–100K 橙 / 100K+ 红
- 死亡 → fade out 600ms 后从数组移除

### 关键不变量
- agent_id IS NULL = 主会话事件；burn_rate 计算用此排除 subagent 噪声

## 6. #2 Burn-rate 预警

### 后端
`data/burn_rate.rs`（新）：
```rust
struct BurnRate {
    tokens_per_min: f64,
    usd_per_min: f64,
    usd_today: f64,
    usd_budget_month: f64,
    usd_projected_month: f64,
    status: String,  // "calm" | "warm" | "hot" | "scorching"
}
```

SQL：
```sql
SELECT SUM(input_tokens + output_tokens
           + cache_read_input_tokens + cache_creation_input_tokens) AS tokens,
       SUM(CAST(cost_usd AS REAL)) AS cost
FROM events
WHERE timestamp >= datetime('now', '-30 minutes')
  AND agent_id IS NULL
```

`projected_month = usd_today × (days_in_month / day_of_month)`

阈值：
- `< 0.7 × budget` → calm
- `0.7–1.0` → warm
- `1.0–1.5` → hot
- `> 1.5` → scorching

后台 30 秒计算一次，emit("pet:burn-rate-changed", BurnRate)。

### 前端
- `BurnRateOverlay.tsx`：胶囊浮于 pet 右下，刘海岛模式可见
  - 内容："$2.34/h · 月底 ~$71 / $50"
  - 颜色随 status 切换
- `Settings/BurnRateBudget.tsx`：月度预算输入框 + 实时回显"按当前 burn rate 月底大概 $X"

### Mood 融合（已扩展 fuse_mood）
- scorching → hungry
- hot → content
- calm/warm → 不拉低

## 7. #3 Hooks 接收器

### HTTP Server
`hooks/server.rs`（新）：
- 启动时绑定 127.0.0.1:0（OS 选随机端口），写到 `~/.notchi/port.txt`
- axum + tokio
- 路由：
  - `POST /hooks/pre-tool-use` → emit("pet:hook-event", { kind: "pre_tool_use", tool_name, ... })
  - `POST /hooks/post-tool-use` → emit("pet:hook-event", ...)
  - `POST /hooks/stop` → emit("pet:hook-event", ...)
- 每条收到立即返回 200，不写 SQLite，不阻塞
- 启动失败仅打 log（不 fail app 启动）；退出时 tokio task 自然终止

### 安装/卸载
`hooks/install.rs`（新）：
- `install(port: u16)`：
  1. 读 `~/.claude/settings.json`（不存在则创建）
  2. 备份到 `~/.claude/settings.json.notchi-backup`
  3. merge：PreToolUse / PostToolUse / Stop 各加一条命令，标 `marker: "notchi"`：
     ```
     curl -X POST -H 'Content-Type: application/json' \
          -d "@${CLAUDE_HOOK_PAYLOAD_FILE:-/dev/stdin}" \
          http://127.0.0.1:<port>/hooks/pre-tool-use
     ```
  4. 写回 settings.json
- `uninstall()`：按 marker="notchi" 移除，其他 hook 项保留
- `is_installed() -> bool`：检测当前 settings.json 状态

### Settings UI
`Settings/HooksToggle.tsx`（新）：
- 显示当前安装状态
- 一键开关按钮调 invoke('install_hooks') / invoke('uninstall_hooks')
- 子说明 + 高级折叠（listening port + recent events log 最近 20 条）

### 表情映射
`PetExpressionLayer.tsx`（新）：
- 监听 pet:hook-event
- 临时表情，600ms 后回 mood：
  - Bash → 撸袖子
  - Edit/Write → 戴眼镜
  - Read/Grep → 看书
  - Task/Agent → 思考泡泡
  - stop_reason="end_turn" → "done" 完成动画
  - stop_reason="error" → 警告表情
- 节流：50ms 内多个 hook 只用最后一个

## 8. Mood 融合

```rust
fn fuse_mood(
    feed_mood: &str,
    cache: &CachePulse,
    burn: &BurnRate,
) -> &'static str {
    let fm = canonicalise(feed_mood);
    let cm = if cache.samples >= 5 { cache_mood_for(cache.hit_pct) } else { fm };
    let bm = match burn.status.as_str() {
        "scorching" => "hungry",
        "hot"       => "content",
        _           => fm,
    };
    *[fm, cm, bm].iter().min_by_key(|m| mood_rank(m)).unwrap()
}
```

Hooks 临时表情独立于 mood（瞬态层）。

## 9. 边界与降级

| 边界 | 处理 |
|---|---|
| 用户没设月度预算 | 默认 $50 |
| 端口被占用 | server 启动失败，HooksToggle 显示"端口冲突"，下次启动重试 |
| settings.json 已有手写 hooks | merge 而非覆盖，按 marker="notchi" 区分 |
| settings.json 损坏 | install 报错给前端，引导手动修 |
| Subagent jsonl 无 agentId（旧格式） | 跳过，不显示该轨道点 |
| 30min 零 events | burn_rate=0，status=calm，胶囊隐藏 |
| Migration 已存在 agent_id 列 | `IF NOT EXISTS` 幂等 |
| 多 Notchi 实例 | 第二个实例端口冲突降级；事件去重靠 hash |
| curl 缺失 | hook 静默失败，不影响 Claude Code 主流程 |

## 10. 测试策略

Rust 单元测试（前端按 baseline 不加）：

| 测试 | 文件 | 验证 |
|---|---|---|
| `subagent_active_window_60s` | `data/subagents.rs` | 60s 内活跃 / 超出死亡 |
| `burn_rate_excludes_subagents` | `data/burn_rate.rs` | agent_id IS NULL 生效 |
| `burn_rate_status_thresholds` | `data/burn_rate.rs` | 0.5/0.8/1.2/2.0 → calm/warm/hot/scorching |
| `hooks_install_idempotent` | `hooks/install.rs` | install 两次 = install 一次 |
| `hooks_uninstall_preserves_other` | `hooks/install.rs` | 仅删 notchi 标记 |
| `fuse_mood_with_burn` | `data/evolution.rs` | 真值表加 burn 维度交叉点 |

E2E 手动验证：
1. 启动 dev，主宠正常
2. 跑多 subagent 任务，观察轨道点
3. Settings 设 budget=$1，看胶囊变红
4. 启用 hook，跑 `Bash echo hi`，看撸袖子动画

## 11. 不做清单（YAGNI）

- 轨道点点击展开 subagent 详情
- Burn-rate 历史趋势图
- Hook 事件历史持久化
- 跨设备同步预算
- gacha / 卡牌系统

## 12. 后续扩展候选

- 国内 Coding Plan 模式 + 多 Key 分账（华语圈刚需）
- MCP server 健康度仪表
- Hook 事件历史 + 当日工具用量统计
- Subagent 详情面板
- 跨工具 prompt cache 复用统计

## 13. 三个 plan 的拆分

writing-plans 阶段产出 3 份独立 plan：
- `2026-05-08-v02-subagent-radar-plan.md`
- `2026-05-08-v02-burn-rate-plan.md`
- `2026-05-08-v02-hooks-integration-plan.md`

可串行执行，也可 #2 单独并行（不依赖 #1 的 migration）。#1 必须先做（events 表 migration 是 #2 / 后续特性的基础）。
