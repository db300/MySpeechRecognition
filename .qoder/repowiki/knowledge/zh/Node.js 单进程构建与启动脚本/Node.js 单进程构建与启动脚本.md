---
kind: build_system
name: Node.js 单进程构建与启动脚本
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - server.js
    - .env.example
---

本项目采用最简化的 Node.js 构建体系，未使用任何专用构建工具（如 Webpack、Vite、Makefile、Dockerfile 等），完全依赖 npm 原生能力。

**构建与运行方式**
- 通过 `package.json` 的 `scripts.start` 定义入口：`node server.js`
- 运行时由 Express 直接托管静态资源目录（index.html、css、js、fonts、img），无需前端编译步骤
- 环境变量通过 `dotenv` 在进程启动时加载 `.env` 文件，提供阿里云 AccessKey 与服务端口配置

**依赖管理**
- 生产依赖：`express`（Web 框架）、`@alicloud/pop-core`（阿里云 POP SDK）、`dotenv`（环境变量）
- 开发依赖：仅 `docx`，用于生成设计规范文档，不参与应用构建
- 无锁版本策略，`package-lock.json` 随仓库提交，但未见 CI/CD 或发布流水线

**部署形态**
- 单进程 Node.js 应用，监听指定端口后同时承担 API 路由与静态文件服务
- 无容器化、无多阶段构建、无跨平台编译脚本
- 无测试脚本、无 lint/format 钩子、无预构建产物