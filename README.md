# VPN 智能助手

> 从“不知道该选哪一个”，到看得懂为什么推荐、去哪里下载、下一步怎么做。

[![Release](https://img.shields.io/github/v/release/shudi729/dsh-vpn-assistant?label=release)](https://github.com/shudi729/dsh-vpn-assistant/releases)
[![License](https://img.shields.io/github/license/shudi729/dsh-vpn-assistant)](LICENSE)
![DSH](https://img.shields.io/badge/DSH-0.2.1--rc.5-5b5bd6)
![Tests](https://img.shields.io/badge/tests-92%2F92%20unit%20%7C%2053%2F53%20UI-brightgreen)

选择 VPN 真正困难的，往往不是“找不到名字”，而是很难判断宣传是否可信、自己的设备是否支持、价格是否合适，以及下载和安装过程中每一步该做什么。

**VPN 智能助手**是面向 DeepSeek Harness 的可解释 VPN 选型与使用指导插件。它把分散的服务资料、选择规则、官方下载入口、安装步骤和授权诊断整理到一个界面中：先帮你梳理需求，再说明推荐依据，最后陪你走到官方下载与安装确认。

它适合第一次接触 VPN 的用户，也适合需要严谨比较不同服务、复核资料来源或排查安装问题的人。它不会用一句“AI 推荐”掩盖过程，而是把排除条件、每项得分、扣分原因和资料可信度都摆在你面前。

它不是 VPN 客户端，不出售服务，也不会替你安装、连接或修改系统网络设置。

![VPN 智能助手界面](https://raw.githubusercontent.com/shudi729/dsh-vpn-assistant/v0.2.1/assets/overview.png)

## 两条典型使用路径

### 第一次选择 VPN

1. 在“智能选型”回答设备、用途、预算、设备数和偏好等问题；
2. 查看推荐结果、硬性排除原因、五维评分和资料可信度；
3. 打开服务详情，复核价格、平台、审计与来源；
4. 从“下载中心”进入经过白名单检查的官方渠道；
5. 跟随七步安装向导完成下载、安装、登录与结果确认。

### 已经安装，但不知道哪里出了问题

1. 进入“设备管理”或“网络诊断”，先阅读检测范围；
2. 主动勾选并授予十分钟有效的指定权限；
3. 查看真实系统信息、客户端登记、DNS 与 TCP 检查结果；
4. 根据明确的失败原因和下一步建议自行处理；
5. 需要进一步解释时，把经过预览的页面上下文交给 DSH 原生会话。

## 你可以用它做什么

| 你的问题 | VPN 智能助手提供的帮助 |
|---|---|
| 服务太多，不知道怎么选 | 用 6 个问题整理需求，展示硬性排除原因、五维评分、扣分项和资料可信度 |
| 担心推荐只是“拍脑袋” | 用确定性规则引擎生成；同样输入得到同样结果，不用模型偷偷改排名 |
| 害怕下载到假客户端 | 只展示已登记的官方页面或应用商店；无法核实的入口明确标记“待核实” |
| 不知道安装下一步做什么 | 提供 Windows、macOS、Android、iOS 的七步安装向导和原创示意图 |
| 安装后仍然不能用 | 明确授权后读取有限系统信息，并执行白名单 DNS/TCP 检查 |
| 想让 DSH 继续解释当前页面 | 预览并发送结构化上下文到 DSH 原生会话；不支持时可复制交接内容 |

## 为什么推荐结果更容易相信

### 可解释，而不是只给一个排名

每个结果都会显示：

- 不满足平台、预算、设备数等硬条件时，为什么被排除；
- 隐私安全、速度稳定、易用性、价格价值、平台支持五个维度；
- 每个维度的具体扣分项；
- 总分如何由权重重新计算；
- 资料可信度与仍待核实的字段。

评分与资料可信度分开呈现：服务分数高，不代表资料一定完整；资料不完整，也不会被包装成“已验证”。

### 资料有来源，也允许说“不知道”

服务市场按名称展示，不把排列顺序伪装成推荐。内置资料记录来源、核实日期和未核实字段；价格换算使用带日期的静态参考汇率，不冒充实时价格。

## 三分钟开始使用

### 1. 安装

从固定的 GitHub 版本安装：

```powershell
dsh plugin --profile web add git+https://github.com/shudi729/dsh-vpn-assistant.git#v0.2.1
```

也可以从 [GitHub Releases](https://github.com/shudi729/dsh-vpn-assistant/releases) 下载 `dsh-vpn-assistant-0.2.1.tgz`：

```powershell
dsh plugin --profile web add .\dsh-vpn-assistant-0.2.1.tgz
```

### 2. 确认插件已激活

```powershell
dsh --profile web --dump-config
```

输出中应同时出现 `dsh-vpn-assistant` bundle 层和 `vpn-assistant` 插件行。

### 3. 启动并打开插件

```powershell
dsh --profile web
```

重新启动已经运行的 profile，然后从侧边栏打开 **VPN 智能助手**。第一次使用建议从“智能选型”开始；已经知道服务名称时可直接进入“服务市场”或“下载中心”。

## 功能地图

| 模块 | 能做什么 | 结果如何呈现 |
|---|---|---|
| 服务市场 | 浏览六家服务的定位、平台、价格、计划、审计和来源 | 按名称展示；待核实字段不会被补造 |
| 智能选型 | 收集设备、用途、预算、设备数和偏好，运行确定性规则 | 推荐 3–6 个结果，并显示排除原因、五维得分、扣分项和可信度 |
| 服务详情 | 深入查看单个服务的计划、平台、下载与隐私资料 | 来源链接、核实日期和未知信息与结论放在一起 |
| 下载中心 | 查找 Windows、macOS、Linux、Android、iOS 的官方入口 | 打开前显示目标域名；不满足白名单或待核实的按钮不可用 |
| 安装向导 | 按服务商和平台带用户完成七个阶段 | 保存当前进度，刷新后可恢复；关键步骤配原创示意图 |
| 帮助中心 | 查看常见问题、模型服务状态和页面级 AI 协助 | 模型不可用时仍保留本地知识库能力 |
| 设备管理 | 授权后读取 Windows 版本、架构、卸载登记和匹配进程 | 明确区分“未发现”“检测失败”和“连接状态未知” |
| 网络诊断 | 对固定白名单目标执行 DNS 解析和 TCP 443 检查 | 记录时间、依据、真实错误、可能原因和建议，不伪造成功 |
| DSH 协作 | 注册 9 个 Skill，并把当前页面上下文交给原生会话 | 发送前可预览；宿主不支持时提供复制交接方案 |

## 兼容范围

| 项目 | 当前结论 |
|---|---|
| DeepSeek Harness | `0.2.1-rc.5` 已实测；未扩大声明到其他版本 |
| Node.js | 20 或更高 |
| DSH `web` profile | 已完成安装、启动和完整界面回归 |
| DSH `desktop` profile | 架构上可使用保留的 `desktop` profile，但本版本未独立实测 |
| Windows x64 | 本地辅助组件已实测 |
| macOS / Linux | 可浏览资料；本地客户端检测未声明支持 |
| Android / iOS | 提供安装指导，不提供本地辅助组件 |

## 权限、联网与隐私边界

本地检测默认关闭。用户必须先阅读说明、勾选范围并授权；授权仅对指定操作生效，十分钟后过期。辅助组件可能：

- 读取 Windows 卸载登记与匹配的进程名称；
- 读取 Node.js 解析器看到的 DNS 服务器；
- 解析 `example.com`、`www.microsoft.com` 或 `cloudflare.com`；
- 对解析结果尝试一次 TCP 443 连接；
- 在用户主动下载时生成当前页面的 JSON 报告。

它不会读取 VPN 密码或密钥，不会安装软件，不会连接 VPN，也不会修改 DNS、路由、注册表或系统安全设置。报告默认只保留在当前页面；只有用户主动保存时才会写入文件。

打开官方下载链接会访问所选服务商的外部网站。使用 DSH 原生回答时，网络请求由用户在 DSH 中配置的模型服务处理；本插件不读取模型凭据。

## AI 与 DSH 能力说明

市场、选型、下载、向导和本地诊断不依赖模型 API Key。需要模型回答时，请在 DSH 自身的模型设置中配置凭据，不要把密钥写进插件目录、仓库或诊断报告。

已经验证：

- 9 个 Skill 能被 DSH 注册并读取；
- 原生 sessions 服务可见；
- 页面上下文能够创建会话并被宿主受理。

尚未声称：

- 模型一定完成回答；
- 模型一定在一次真实推理中调用某个 Skill；
- 进程存在就代表 VPN 已连接；
- 单次 DNS/TCP 失败就代表某个服务商故障。

## 升级与卸载

升级到新的 GitHub 标签：

```powershell
dsh plugin --profile web add git+https://github.com/shudi729/dsh-vpn-assistant.git#v0.2.1
```

卸载：

```powershell
dsh plugin --profile web remove dsh-vpn-assistant
```

执行后重启同一个 profile。卸载只移除插件 bundle 与路由，不会删除 DSH 会话，也不会更改 VPN 或系统设置。

## 常见问题

**侧边栏没有出现插件**

运行 `dsh --profile web --dump-config`，确认 bundle 层和插件行存在，然后重启同一个 profile。

**DSH 拒绝安装**

本版本只声明兼容 `0.2.1-rc.5`。这是有意的保守范围，不代表其他版本一定不能运行。

**没有配置模型还能使用吗**

可以。资料浏览、规则选型、下载入口、安装向导和本地诊断都可以独立工作。

**为什么没有检测到已经安装的客户端**

便携版、其他 Windows 用户、非标准安装位置或特殊进程名可能漏检。检测结果是辅助信息，不是全盘扫描。

**为什么某些价格或下载按钮显示“待核实”**

插件宁可保留未知状态，也不会补造价格、版本要求或下载链接。

## 真实验证记录

- 单元测试：`92/92`；
- 从实际 tgz 安装到独立 DSH profile 后的浏览器与核心功能回归：`53/53`；
- bundle 被 DSH 识别并激活，9 个 Skill 注册成功；
- Windows 本地辅助组件、授权撤销、DNS/TCP 结果和八张 SVG 均完成真实操作验证。

测试通过表示流程按设计工作，不表示真实网络一定畅通、VPN 已连接或所有外部资料永久有效。完整范围与未验证项见 [`docs/FULL_TEST_REPORT.md`](docs/FULL_TEST_REPORT.md) 和 [`docs/KNOWN_ISSUES.md`](docs/KNOWN_ISSUES.md)。

## 开发

```powershell
npm install
npm test
npm pack --dry-run
```

项目遵循最小权限、来源白名单、明确授权、真实失败呈现和可恢复发布原则。安全问题请查看 [`SECURITY.md`](SECURITY.md)。

## 插件市场兼容与安全审查

仓库已按 dsh.so 当前接受标准准备：

- 插件 id / 仓库名为 `dsh-vpn-assistant`，符合小写字母、数字与连字符规范；
- `package.json` 声明 `dsh.bundle.patch`，`cordis.patch.yml` 指向可解析的实际插件模块；
- GitHub Topic 包含 `dsh-plugin`，README 提供可复制的 `dsh plugin add` 安装命令；
- 使用 SPDX 可识别的 MIT 许可证，完整源码与发布入口均公开可扫描；
- 没有 `preinstall`、`install`、`postinstall` 下载执行脚本；发布包不包含 `.env`、密钥、日志或个人数据；
- 所有本地读取、外部目标、权限边界和联网行为均在上文公开说明。

dsh.so 会在正式提交时重新拉取源码并执行独立安全扫描；最终扫描状态应以该次服务端报告为准，而不是以本仓库的自述代替。

## English summary

VPN 智能助手 (`dsh-vpn-assistant`) is an explainable VPN selection and guidance bundle for DeepSeek Harness. It provides sourced provider facts, deterministic recommendations, official-channel download guidance, a seven-step installation wizard, opt-in read-only Windows diagnostics, and structured handoff to native DSH sessions. It never installs or connects a VPN.

## 链接与许可证

- 源码与发布包：https://github.com/shudi729/dsh-vpn-assistant
- 问题反馈：https://github.com/shudi729/dsh-vpn-assistant/issues
- 许可证：[MIT](LICENSE)
