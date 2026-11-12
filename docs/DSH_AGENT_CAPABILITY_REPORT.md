# DSH Agent 能力复核（0.2.0）

2026-11-12。旧版3B报告关于“不注册ctx.sessions”的结论有误，已按实际源码更正。

公开证据：F:/harness-runtime/node_modules/@deepseek-ai/dsh-api-session-controller/lib/client.js 在 ClientSessions 构造函数调用 rootCtx.reflect.provide('sessions', this, undefined)。lib/types/client/contract/sessions.d.ts 声明 ISessions 的 create/retain/using；contract/session.d.ts 声明 beginSubmission 与 prompt。不能仅凭类未导出判断服务不存在。

插件使用 ctx.inject(['sessions']) 可选获取公开服务；按 create → using → reference.binding.session.beginSubmission/prompt 提交。未调用内部类、未绕过私有接口。原生会话导航归宿主UI所有，插件显示实际会话ID，用户在原生列表打开。保留复制备用路径。

动态结果以 FULL_TEST_REPORT.md 及 e2e-results.json 为准：服务可见、会话创建/消息受理分别验证；它们均不是模型推理成功或Skill实际调用证明。9个Skill注册与4组映射独立验证；本机模型调用失败时按真实错误降级。Agent获取Skill内容的契约存在，模型端到端调用未验证成功。

九类结构化数据工具在tools.js已实现并通过单元测试，尚未作为独立Agent工具注册。不会宣称模型可直接调用这些工具。原始diagnostics字段仍拒绝；授权分享只使用状态摘要。
