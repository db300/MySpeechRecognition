---
kind: dependency_management
name: Node.js 依赖管理（npm + lockfile）
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - package-lock.json
---

本项目使用 npm 作为包管理器，通过 package.json 声明运行时与开发期依赖，并通过 package-lock.json（lockfileVersion 3）锁定精确版本，确保构建可重复。

- 声明式依赖：dependencies 包含运行期库 express、@alicloud/pop-core、dotenv；devDependencies 仅含生成文档的 docx，生产环境不安装。
- 版本策略：所有依赖均使用 ^ 语义化版本范围，允许小版本/补丁升级，但 package-lock.json 固定了实际解析到的具体版本与 sha512 integrity，避免“在我机器上能跑”问题。
- 锁文件：package-lock.json 已提交至仓库，CI/CD 或协作时直接 npm ci 即可复现一致树结构。
- 私有源/代理：未发现 .npmrc 或私有 registry 配置，默认使用官方 npm 源。若需切换镜像，应在项目根目录添加 .npmrc 并纳入版本控制。
- 安全校验：lockfile 中每个包条目均附带 integrity 字段，安装时自动校验完整性，降低供应链风险。
- 脚本约定：start 脚本指向 node server.js，为唯一入口，无额外构建步骤。

开发者应遵循的规则：
1. 新增依赖一律通过 npm install --save/-D <pkg> 操作，禁止手动编辑 package.json。
2. 提交变更时必须同时提交更新后的 package-lock.json，保持锁文件与清单一致。
3. 仅在 devDependencies 中添加本地开发工具，避免污染生产镜像体积。
4. 如需引入私有包，先在根目录配置 .npmrc 再执行安装，并将该文件加入 .gitignore（凭据不应入库）。