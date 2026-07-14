---
kind: logging_system
name: 基于 console 的轻量级日志输出
category: logging_system
scope:
    - '**'
source_files:
    - server.js
    - js/aliyun-speech.js
    - js/speech.js
    - js/app.js
    - generate-design-spec.js
---

本仓库未引入任何第三方日志框架，后端与前端均采用 Node.js / 浏览器原生 `console` API 进行日志输出，属于最轻量的“无系统”实现。

- 后端（server.js）：使用 `console.log` 打印服务启动信息，使用 `console.error` 记录阿里云 Token 获取失败、API 错误码等异常场景；所有日志直接输出到进程标准输出，由运行环境（如 Docker、PM2、systemd）负责收集。
- 前端（js/aliyun-speech.js、js/speech.js、js/app.js）：使用 `console.log`、`console.warn`、`console.error` 分别记录 WebSocket 连接状态、语音识别错误、字体加载完成等事件，便于在浏览器开发者工具中排查问题。
- 构建脚本（generate-design-spec.js）：同样使用 `console.log` / `console.error` 反馈文档生成结果。

约定与约束：
- 没有统一的 logger 初始化文件、日志级别枚举或结构化字段规范，每条日志均为自由文本字符串。
- 未配置 Morgan、Winston、Pino、Bunyan 等中间件或库，也未定义日志轮转、持久化策略。
- 开发阶段通过控制台直接观察日志，生产部署需依赖外部进程管理器收集 stdout/stderr。