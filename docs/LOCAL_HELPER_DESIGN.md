# Local Helper 设计与支持范围

组件：src/helper/cli.js（一次性 IPC）、detect.js（只读检测）、src/host/helper.js（授权与生命周期）。依赖 Node >=20 与 Windows 自带 PowerShell，不要求管理员权限。

授权：浏览器主动勾选告知说明，再点“授权本地检测”；设备和网络分别授权，十分钟有效。权限绑定 DSH cookie 的 SHA-256 标识；不保存 cookie 原文。重启丢失授权。撤销可立即清除结果；运行中的结果也会被丢弃。HTTP 入口要求宿主认证、同源 Origin、JSON、字段白名单和 32KiB 请求上限。

IPC：Host 生成 256-bit 随机 nonce，仅由私有环境与 stdin 传递；helper 用恒定时间比对身份，要求协议 version=1，单次接受 device 或 diagnostics。子进程只继承少量系统环境项；不继承模型凭据配置。输出上限512KiB，Host 超时16秒；PowerShell读取超时8秒、DNS单次2秒、TCP3秒。nonce 不写日志、不开放监听端口。

Windows：读取 HKLM 64/32 位及当前用户 Uninstall 的 DisplayName、DisplayVersion，筛选六家服务商；匹配进程名。无注册表写入、无命令输入拼接。不检索账号目录、配置文件、浏览记录和用户文档。未发现客户端不等于未安装；便携版、其他用户、命名差异可能遗漏。进程存在不等于隧道已连接。

诊断：Node Resolver.getServers 展示当前解析器服务器（不能代表所有网卡的有效DNS路径）；白名单 example.com、www.microsoft.com、cloudflare.com 的 A 记录；对首个返回IPv4地址进行TCP 443握手，不发送HTTP内容。失败展示实际错误码、时间、原因范围与建议；DNS失败时TCP跳过。不是DNS泄漏、TLS、速度、地理位置或VPN隧道测试。

支持矩阵：Windows x64 已本机实测；Windows其他架构未验证。macOS/Linux仅系统信息通用代码存在，客户端检测标 unsupported，未经平台实测；Android/iOS不提供本地辅助组件。远程打开DSH时检测的是宿主电脑，不是浏览器设备。

报告停留在当前页面内存，用户可保存JSON。切换页面清除结果，授权最长十分钟；原始诊断不送给模型。操作审计仅最近100条时间/动作/状态，内存保存、重启清除，不保存检测内容。无持久审计或跨设备同步。
