# 完整测试报告 · 2026-11-12

当前源码0.2.1；本轮真实执行，非沿用历史通过数。

| 检查 | 实际结果 |
|---|---|
| 修改前基线 | 原项目 node --test test/unit/*.test.js，84/84 |
| 最终完整单元集 | 9文件，92/92（原84保留，新增8） |
| 独立Chromium + 真实DSH浏览器回归 | 53/53，含设备/诊断/图片/授权/原生提交 |
| 包安装、启动、API、9 Skill注册、helper、卸载 | 17/17；全部通过 |
| 语法检查 | client、Host、Helper及测试文件，node --check |
| 实际打包 | 使用 pnpm pack 生成 npm 兼容 tgz；dry-run 与实际包内容均已检查 |
| 标准 DSH CLI 从 tgz 安装 | `dsh plugin --profile publish-test add` 成功；bundle 被识别并激活 |

单元新增：helper.test.js六项（会话/授权隔离、白名单、并发与撤销、登记字段归一化、错误IPC身份、真实系统读取）；routes.test.js一项（真实HTTP来源/授权/八图/清理）；lifecycle.test.js一项（异步Skill注册卸载竞态）。client-logic旧测试修复中文路径URL解码问题。

浏览器：原有市场、详情、筛选、下载、七步向导、保存恢复、选型、上下文交接、键盘、主题和窄屏全部保留；新增Windows安装图真实渲染、helper未授权禁用、真实系统读取、撤销清理、DNS/TCP报告、四张故障图显示、八个图资源、默认不分享诊断、公开sessions可见和真实消息受理。最终E14动态验证service与accepted=true，不宣称模型已答复。

真实设备：Windows 10.0.26300/x64；当前权限及登记范围未检出六家VPN客户端，clientDetection=completed，不代表全盘无安装。真实网络：example.com A记录解析返回ETIMEOUT，TCP依赖DNS所以skipped。测试通过的是检测流程与如实呈现，不是网络畅通；没有声称TCP成功、VPN已连接或DNS无泄漏。

测试修正过程：首轮浏览器49/50，失败为旧断言仍预期六导航，实际新增八导航；修正后最终53/53。首次安装尝试因npm不可用未生成tgz而失败；改用本地pnpm打包。随后16/17中唯一失败是卸载后POST错误地只期待404；现在同时验证helper GET=404且POST不成功，保留宿主兜底状态码。以上均未计作最终通过。

证据：e2e-results.json、install-results.json、helper-device-results.json；交付附件含完整单元日志。标准 DSH CLI 从本地 tgz 安装后的浏览器回归为 53/53。历史3B报告保留为历史，不能取代本报告。未验证：模型端到端调用Skill、其他操作系统客户端检测、真实VPN隧道、从公开 npm registry 安装、外部最新价格/政策。

浏览器使用：仅独立headless Chromium访问本地3099；未打开Edge、未访问VPN官网；仅用户授权的诊断执行预设DNS/TCP检测。测试实例退出后关闭自己的浏览器和DSH子进程；未关闭用户原有页面或常驻3080服务。
