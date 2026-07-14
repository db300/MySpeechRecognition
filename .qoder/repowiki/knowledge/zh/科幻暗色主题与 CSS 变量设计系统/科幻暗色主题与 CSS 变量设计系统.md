---
kind: frontend_style
name: 科幻暗色主题与 CSS 变量设计系统
category: frontend_style
scope:
    - '**'
source_files:
    - css/style.css
    - index.html
    - fonts/HYNiaoWen260605.ttf
---

## 样式体系概述

该项目采用**原生 CSS + CSS 自定义属性（CSS Variables）**构建的科幻暗色主题风格，无第三方 UI 框架或 CSS-in-JS 方案。整体视觉以深色背景、霓虹高亮（青色/紫色）和玻璃拟态（glassmorphism）为特征，配合粒子动画与声波可视化营造科技感交互体验。

## 核心文件与资源
- `css/style.css` — 全部样式定义，约 1023 行，按功能区块注释分段组织
- `index.html` — 单页应用结构，内联 SVG 图标，通过 `<link>` 引入样式
- `fonts/HYNiaoWen260605.ttf` — 自定义中文字体，通过 `@font-face` 加载
- `img/background.png` / `img/logo.png` — 背景图与品牌 Logo
- `js/particles.js` — Canvas 粒子背景动画脚本

## 设计令牌（Design Tokens）
所有视觉常量集中在 `:root` 伪类下，形成统一的设计令牌层：
- **背景色**: `--bg-primary` (#0a0a0f)、`--bg-secondary` (#12121a)
- **文本色**: `--text-primary` (#e0e0ff)、`--text-muted` (#6a6a8a)
- **强调色**: `--accent-cyan` (#00f0ff)、`--accent-purple` (#bf00ff)
- **语义色**: `--color-success` (#00ff88)、`--color-danger` (#ff3366)
- **边框色**: `--border-color` (#1a1a2e)
- **字体族**: `--font-main`（HYNiaoWen）、`--font-ui`（Segoe UI/Microsoft YaHei）

## 架构与约定
- **命名规范**: 使用 BEM 风格的类名（如 `.btn-mic`、`.toolbar-btn`、`.settings-toggle`），ID 选择器仅用于页面级容器（`#app`、`#transcript-container`、`#particles`）
- **模块化分区**: CSS 文件通过 HTML 注释分隔为「字体定义」「CSS 变量」「重置与基础」「背景图片层」「主面板」「文本展示区域」「声波动画」「麦克风按钮」「右侧工具栏」「设置面板」「响应式适配」等逻辑区块
- **状态驱动样式**: 通过添加/移除 class（如 `.active`、`.listening`、`.hidden`、`.show`）切换组件状态，而非 JS 直接操作 style
- **动画策略**: 大量使用 `@keyframes`（`neonFlicker`、`waveBar`、`micPulse`）配合 `transition` 实现微交互；波形动画通过 CSS animation-delay 错开实现
- **视觉效果**: 广泛运用 `backdrop-filter: blur()` 实现毛玻璃效果、`box-shadow` 多层叠加实现霓虹发光、`radial-gradient` 渐变背景
- **响应式策略**: 基于 `@media (max-width: 768px)` 和 `480px` 两个断点，移动端将右侧工具栏从绝对定位改为固定底部横排布局

## 开发者应遵循的规则
1. **新增颜色必须注册到 `:root` 变量**，禁止在样式中硬编码十六进制值
2. **组件样式按功能区块分组**，保持现有注释分节结构
3. **优先使用 class 切换状态**（`.active`、`.hidden`、`.disabled` 等），避免内联样式
4. **SVG 图标内联在 HTML 中**，通过 CSS 控制尺寸与颜色（`width`/`height`/`stroke`）
5. **响应式适配使用媒体查询**，遵循现有 768px/480px 断点体系
6. **自定义字体通过 `@font-face` 声明**，并设置 `font-display: swap` 保证加载体验