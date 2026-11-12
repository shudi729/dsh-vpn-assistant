# VPN Assistant — 智能选型规则文档（RECOMMENDATION_RULES）

> 版本：rule-v1（2026-11-12）
> 实现文件：`src/host/selector.js`；测试：`test/unit/selector.test.js`
> 性质：**本地规则引擎**，确定性计算，全过程无 LLM 参与。数据全部来自 `data/providers.json` 与 `data/software.json`（2026-11-11 核实版）。

## 一、输入条件（六维）

| 维度 | 字段 | 取值 | 默认 |
|---|---|---|---|
| 设备 | `device` | windows / macos / linux / android / ios / multiple | multiple |
| 主要需求 | `purpose` | privacy（隐私）/ work（工作资源）/ wifi（公共 Wi-Fi）/ general（未定） | general |
| 服务地区 | `region` | any / wide（需要广泛全球覆盖） | any |
| 预算 | `budget` | free / usd3 / usd6 / usd12 / any | any |
| 设备数量 | `deviceCount` | 1 / 2 / 3 / 5 / 10 | 1 |
| 偏好（必须满足） | `preferences[]` | freeTier / audited / wideCoverage / officialChannels / manyDevices | [] |

非法取值 → `400 INVALID_INPUT`（不猜测、不纠正）。

## 二、参考汇率与价格口径

| 币种 | → USD | 说明 |
|---|---|---|
| USD | 1 | 原币直读 |
| EUR | 1.08 | 内置静态参考汇率 |
| HKD | 0.128 | 内置静态参考汇率 |

**汇率出处（如实记录）**：`FX_META = { asOf: '2026-11-12', source: '引擎内置静态参考汇率（未接实时汇率源）' }`。换算结果一律标注为「**参考换算价**」，明确**非官网实际售价**；官网原币价格（如「5 EUR/月」）在评分依据中原文列出，实际售价以官网结算页为准。

**计费周期折算**：年付套餐按「官网年价 ÷ 12」折算月均（如 Windscribe Pro 29 USD/年 ≈ $2.42/月），解释中标注「年付方案折合」；月付直读。折算仅用于预算比较与可加总的价格维度，不改变官网标价。

## 三、硬性条件过滤（不满足即排除，附原因）

| # | 条件 | 排除原因示例 |
|---|---|---|
| H1 | 指定具体设备时，`supported_platforms` 必须包含该平台；数据为 null（待核实）同样排除 | 「支持平台待核实，无法确认 Windows 兼容」（NordVPN） |
| H2 | `budget=free` 时必须有免费档（price_tier ∈ free/freemium 或存在 0 价套餐） | 「无免费档（与预算『仅免费』不符）」（Mullvad/Surfshark） |
| H3 | `budget=usd3/6/12` 时，最低付费档月价（参考汇率）≤ 限额；价格未知且无免费档则排除 | 「最低付费档约 $5.40/月，超出预算 $3/月」 |
| H4 | 已知套餐设备上限 < deviceCount 则排除；上限未知不排除但加 notes | 「套餐设备上限 5 台，低于需求 10 台」 |
| H5 | 偏好 = 必选项：freeTier→有免费档；audited→有独立审计记录；wideCoverage→服务地区已核实；officialChannels→该服务商全部下载记录渠道已核实；manyDevices→设备上限已知且 ≥ max(deviceCount,5) | 「不满足偏好：官网未公布独立安全审计」（Windscribe） |

**偏好可选、不强制**：偏好全部可跳过；未选择任何偏好时不施加 H5 过滤（中性匹配），评分不受偏好影响（单测验证：省略 preferences 与显式空列表输出完全一致）。

**审计缺失的处理原则**：独立审计**仅在用户明确勾选「有独立审计」偏好时**才作为硬过滤条件；否则 Windscribe（官网未公布独立审计）等服务商**正常参与评分**，仅降低 privacySecurity 维度得分，并在评分依据与扣分明细中说明（单测验证两种路径互斥且可复现）。

排除的服务商进入 `excluded[]`，携带第一条原因、全部原因与资料可信度——**用户能看到谁被排除、为什么**。

## 四、五维评分（权重合计 = 1）

每维得分 ∈ [0,1]，总分 = Σ(权重×得分)×100，四舍五入到 0.1。每维输出：

- **评分依据（reasons）**：逐条证据句（分类、审计名称/机构、平台数、渠道核实数、价格原文）。
- **扣分明细（deductions）**：`{ reason, value }` 列表，每项说明失分原因与分值，**合计恒等于 1 − 得分**（由吸收舍入差的「其他构成/保留位差」项保证），因此总分可从明细逐步复算：`total = Σ(weight × score) × 100`（`meta.formula` 中声明）。

### 扣分构成表

| 维度 | 满分构成 | 主要扣分点 |
|---|---|---|
| compatibility | 指定设备 0.7 + 平台覆盖 0.3 | 其余平台未覆盖/未核实 |
| needMatch(privacy) | 分类 0.6 + 审计 0.4 | 分类未标注 / 无审计 |
| needMatch(work) | 设备上限 0.6 + 地区 0.4 | 上限待核实（保守 0.3）/ 地区待核实 |
| needMatch(wifi) | 免费档 0.7 + 覆盖 0.3 | 无免费档 / 档位未知 / 覆盖不足 |
| needMatch(general) | 中性基准 0.5 + 覆盖 0.5 | 覆盖不足、需求信息缺失 |
| price | 限额内线性 1−0.5p/L | 价格相对预算偏高 |
| privacySecurity | 基础 0.3 + 审计 0.25×2 + 政策 URL 0.2 | 审计不足 2 次（仅降分）/ URL 未核实 |
| usability | 覆盖 0.5 + 渠道核实 0.5 | 覆盖不足 / 渠道待核实 |

### 1. 兼容性 compatibility（25%）
- 指定设备：包含该平台 → `0.7 + 0.3 × (已核实平台数/5)`；解释引用平台数。
- multiple：`已核实平台数/5`。
- 平台数据缺失：0 分（且通常已被 H1 排除）。

### 2. 需求匹配 needMatch（25%）
- **privacy**：官方分类含 privacy → +0.6；有独立审计记录 → +0.4；两者皆无 → 解释「证据不足」。
- **work**：已知设备上限 ≥ 需求 → 0.6（未知 → 0.3 保守）；服务地区已核实 → +0.4。
- **wifi**：freemium → 0.7；paid → 0.4；未知 → 0.5；再 + 0.3 × 平台覆盖。
- **general（未定）**：`0.5 + 0.5 × 平台覆盖`，解释注明按平台覆盖综合评估。

### 3. 价格 price（20%）
- `budget=free`：1.0（免费档 $0）。
- 最低付费价 p（USD 参考换算）已知：限额 L 已知 → `1 − 0.5×p/L`；`any` → p≤$6 ? 0.8 : 0.6。
- p 未知：有免费档 0.9；完全未知 0.3（IVPN，解释「价格待核实，无法评估性价比」）。
- 解释引用官方价原文（例：「最低付费档约 $5.40/月（官方价 5 EUR/月，按参考汇率换算，以官网结算价为准）」）。

### 4. 隐私及安全 privacySecurity（20%）
- `min(1, 0.3 + 0.25×min(审计数,2) + (隐私政策URL已核实 ? 0.2 : 0))`。
- 解释逐条列出审计名称/机构/年份；Windscribe 无审计的事实以官方 notes 原句呈现（如实记录，不推断）。

### 5. 易用性 usability（10%）
- `0.5 × (平台覆盖/5) + 0.5 × (官方下载渠道已核实记录数/该服务商总记录数)`。
- 全部为可验证事实（platforms 数组 + software.json 的 official_download_url），无主观打分。

## 五、资料可信度（与评分完全分离）

```
可信度 = 状态分 + 来源分 + 完整度分   （0–100）
状态分：verified=0.55，partial=0.30，其他=0.10
来源分：min(sources.length,4)/4 × 0.20
完整度：(1 − unverified_fields 数 / 12) × 0.25
```

输出包含状态、核实日期、待核实字段清单。**可信度不参与总分**，前端以独立徽章展示。

## 六、输出结构

```jsonc
{
  "criteria": { /* 规范化后的输入 */ },
  "results": [ {
    "provider_id", "name", "score",          // 0–100
    "dimensions": [ { "key", "weight", "score", "reasons": [/* 证据句 */], "deductions": [ { "reason", "value" } /* Σ = 1 − score */ ] } ×5 ],
    "credibility": { "value", "status", "verifiedAt", "unverifiedFields" },
    "notes": [ /* 如「套餐设备上限待核实」 */ ]
  } ],
  "excluded": [ { "provider_id", "name", "reason", "allReasons", "credibility" } ],
  "meta": { "engine": "rule-v1", "generatedBy": "local-rule-engine（规则计算，未使用 LLM）", "weights", "formula", "fx", "fxMeta": { "asOf", "source", "usage" }, "providersAssessed" }
}
```

排序：分数降序；同分按名称字母序（保证确定性，可单测复现）。

## 七、防编造机制一览

| 风险 | 机制 |
|---|---|
| LLM 编造评分 | 引擎纯规则、无 LLM；`generatedBy` 字段声明；确定性单测（两次调用 deepEqual） |
| 编造价格 | 价格仅取 `pricing_plans`；换算用文档化汇率并标注 |
| 编造地区/审计 | 只引用已核实字段；缺失即排除或 notes，不推断 |
| 评分与可信度混淆 | 两条独立计算链，输出与 UI 均分离展示 |
