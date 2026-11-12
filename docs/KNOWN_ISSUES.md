# 当前已知问题 · 0.2.0

1. 模型真实回答和Skill端到端调用尚未验证成功。公开sessions服务已确认存在，创建和消息提交已动态验证；旧版“不支持ctx.sessions”的结论已纠正。
2. 九类tools.js函数尚未注册为Agent原生工具；9个vpn-*为Skill内容注册，两者不同。
3. Local Helper仅Windows x64实测；macOS/Linux客户端检测待支持，移动端无组件。便携版/其他用户/特殊命名客户端可能漏检；进程名不证明VPN连接。
4. 本机真实DNS探测超时，TCP跳过；不推断VPN服务商故障。DNS配置为Node Resolver视角，非所有网卡的有效DNS路径。
5. NordVPN部分主体/平台/渠道、IVPN价格、部分隐私URL与版本/系统要求仍待核实；本次未访问外部VPN官网，未虚改verified_at。详见DATA_LEDGER.md。
6. 已从 0.2.0 tgz 通过标准 `dsh plugin --profile publish-test add` 安装并验证；从公开 npm registry 安装须在发布后另行复验。
7. 宿主登录/引导遮罩可能干扰自动化，测试只处理自己的独立实例。插件主题跟随宿主；未手动修改用户外观设置。
8. 授权十分钟、报告仅页面内存、操作审计仅最近100条内存记录；无持久审计查看界面。页面不自动携带原始诊断给Agent。
9. 发布包使用 pnpm 生成 npm 兼容 tgz，并用 `pnpm pack --dry-run` 检查文件清单。
