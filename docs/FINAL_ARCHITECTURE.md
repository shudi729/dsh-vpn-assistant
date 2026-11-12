# VPN Assistant 0.2.0 最终架构

2026-11-12；当前实现以本文为准，ARCHITECTURE.md 保留初始设计背景。

客户端保留 DSH 单文件 ModuleLoader factory 和宿主主题变量。八个导航页包括概览、智能选型、市场、下载、七步向导、设备管理、网络诊断、帮助。四个平台安装示意图进入向导；四张故障图进入设备/诊断中心与故障帮助。全部为包内原创 SVG，不冒充截图。

Host 使用一个 /vpn-assistant 前缀路由。原有 API、六维需求与五维评分算法不变；新增 POST /api/helper、POST /api/context、GET|HEAD /api/illustrations/{白名单}.svg。示意图设置 SVG 类型、nosniff 和限制性 CSP。

Local Helper 是独立 Node 进程，通过继承的私有 stdio 管道接受一次请求后退出，不监听本地端口。Host 在已认证同源会话取得十分钟限定授权后才启动它。共享并发上限为一；超时、撤销和卸载会终止辅助进程。Windows 查询固定卸载登记与匹配进程；DNS/TCP 仅访问预设目标。不读取凭据、不写入系统配置。

业务数据仍以 data/*.json 为事实源；九个 Skill 分为四组；九类结构化工具仍是模块/API 能力，未宣称已注册为 Agent 工具。Skill 异步编译加入卸载竞态保护。

重查宿主发现公开 ctx.sessions：session-controller 客户端通过 reflect.provide('sessions', this) 注册服务，contract/sessions.d.ts 声明 ISessions。插件可选注入后调用 create → using → beginSubmission → prompt，不构造内部类。页面提供真实发送按钮与复制备用方式；界面仅在 accepted=true 时报告已受理。模型回答及 Skill 调用须另行验证，不与消息受理混淆。具体动态结果见 FULL_TEST_REPORT.md。

诊断原始数据不进入上下文协议 diagnostics 字段（仍为 null，拒绝任意输入）。用户另选分享后，仅把检测项目状态写入受限 question；不自动带上 DNS 服务器、软件版本。没有第二套聊天历史或模型配置。
