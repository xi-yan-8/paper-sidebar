# Paper Sidebar - 设计规格书

## 概述

一个 Microsoft Edge 浏览器侧边栏工具，用于在阅读 PDF 论文时，选中不懂的文字内容，通过本地 Claude Code 进行搜索解答，答案以流式打字机效果显示在侧边栏中。

**核心原则：** 免费、本地运行、无需登录、零外部依赖（除 Claude Code 本身）。

---

## 技术架构

### 三组件模型

```
Edge 扩展 (Manifest V3)
    ↕ WebSocket (localhost:9876)
本地 Node.js 服务
    ↕ stdin/stdout (spawn)
Claude Code CLI
```

| 组件 | 职责 | 技术 |
|------|------|------|
| Edge 扩展 | 捕获 PDF 选中文字、侧边栏聊天 UI、右键菜单 | Manifest V3, Side Panel API, Content Script |
| Node 服务 | 接收请求、拼接 prompt、调用 Claude CLI、流式回传 | Express, ws (WebSocket), child_process.spawn |
| Claude CLI | 理解论文上下文、搜索解答 | 用户已安装的 claude 命令 |

### 全部本地运行

- 扩展通过 WebSocket 连接 `localhost:9876`
- Node 服务仅监听 `127.0.0.1`，不暴露到外网
- Claude CLI 通过 `claude -p "prompt"` 调用，使用用户已有的配置和认证

---

## UI 设计

### 侧边栏布局

- **宽度：** 360px，右侧固定
- **主题：** 暗色（#1e1e2e 底色），与亮色 PDF 阅读区形成视觉区分
- **结构：** 顶栏标题 → 消息列表（可滚动） → 底部输入框

### 交互流程

1. **选中文字：** 在 PDF 页面中框选不懂的术语或段落
2. **发送提问：** 右键菜单选择 "问问 Claude" 或使用快捷键，选中文字自动填入侧边栏
3. **流式回答：** Claude 的回答逐字显示（打字机效果），支持 Markdown 渲染
4. **继续追问：** 在底部输入框输入新问题，保持对话上下文

### 右键菜单

扩展注册 Edge 右键菜单，当用户选中文字后显示 "🔍 问问 Claude" 选项。点击后自动打开侧边栏并发送问题。

---

## 数据流

```
用户选中PDF文字
  → Content Script 捕获选中文本 + 页面标题/URL
  → 发送到 Side Panel（通过 chrome.runtime）
  → Side Panel 显示用户问题气泡
  → 通过 WebSocket 发送到本地 Node 服务
  → Node 服务拼接 system prompt（论文助手角色）+ 用户问题
  → spawn claude -p "prompt" 子进程
  → 逐行读取 stdout，通过 WebSocket 推送到 Side Panel
  → Side Panel 实时更新回答气泡（Markdown 渲染）
  → 保持对话历史，支持追问
```

---

## Prompt 设计

### System Prompt

```
你是一个学术论文阅读助手。用户正在阅读一篇论文，会对论文中的术语、方法、公式提出疑问。
请用简洁清晰的中文回答，结合用户可能正在阅读的论文领域给出解释。
如果用户的问题涉及到论文特定内容，请根据上下文给出合理推断。
必要时提供相关参考文献或进一步阅读建议。
回复使用 Markdown 格式，便于阅读。
```

### 上下文注入

每次提问时附带论文元信息：
- 页面标题（从 PDF 标签页获取）
- 用户选中的文字
- 对话历史（最近 5 轮）

---

## 项目文件结构

```
paper-sidebar/
├── extension/
│   ├── manifest.json       # Manifest V3 配置
│   ├── content.js           # PDF 页面文字捕获脚本
│   ├── sidepanel.html       # 侧边栏聊天 UI
│   ├── sidepanel.js         # WebSocket 通信 + 消息渲染
│   ├── background.js        # Service Worker（右键菜单、消息中转）
│   └── icons/
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
├── server/
│   ├── index.js             # Express + WebSocket 服务入口
│   └── claude.js            # Claude CLI 调用封装
├── package.json
├── start.bat                # 一键启动脚本
└── README.md
```

---

## 启动方式

1. 双击 `start.bat` → 安装 npm 依赖 + 启动 Node 服务
2. Edge 浏览器 `edge://extensions` → 加载解压缩的扩展 → 选择 `extension/` 文件夹
3. 打开 PDF → 选中文字 → 右键 "问问 Claude" → 查看侧边栏回答

---

## 错误处理

| 场景 | 处理方式 |
|------|----------|
| Node 服务未启动 | 侧边栏显示 "服务未连接" 提示，引导用户运行 start.bat |
| Claude CLI 不可用 | 服务启动时检测 claude 命令是否存在，不存在则报错退出 |
| 请求超时（60s） | 显示 "回答超时，请重试" |
| WebSocket 断连 | 自动重连（指数退避，最多 5 次） |
| PDF 页面无法注入脚本 | 降级方案：侧边栏手动输入 |

---

## 不作的设计（YAGNI）

- 不支持多论文并行对话
- 不持久化对话记录（刷新即清空）
- 不处理 PDF 文件上传（仅处理当前标签页中的 PDF）
- 不提供论文管理/收藏功能
- 不支持 PDF 内图片区域的 OCR 识别
