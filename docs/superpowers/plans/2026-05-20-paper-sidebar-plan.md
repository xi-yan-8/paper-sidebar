# Paper Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 Edge 浏览器侧边栏，在阅读 PDF 论文时选中文字即可通过本地 Claude Code 搜索解答，答案流式显示。

**Architecture:** 三层组件 — Edge 扩展（Manifest V3，负责 UI 和文字捕获）通过 WebSocket 连接本地 Node.js 服务（Express + ws），Node 服务 spawn Claude CLI 子进程并流式回传 stdout。

**Tech Stack:** Node.js, Express, ws (WebSocket), Edge Extension Manifest V3, Side Panel API, marked.js (Markdown 渲染)

---

## 文件清单

| 文件 | 职责 |
|------|------|
| `package.json` | 项目依赖：express, ws |
| `server/claude.js` | 封装 claude CLI 调用：spawn 子进程、流式读取 stdout、超时处理 |
| `server/index.js` | Express 静态文件 + WebSocket 服务：接收消息、调用 claude.js、流式回传 |
| `extension/manifest.json` | MV3 声明：side_panel、contextMenus、content_scripts、权限 |
| `extension/background.js` | Service Worker：注册右键菜单、中转发消息到 Side Panel |
| `extension/content.js` | Content Script：监听文字选中、注入到 PDF 页面 |
| `extension/sidepanel.html` | 侧边栏 UI：消息列表、输入框、状态指示器 |
| `extension/sidepanel.js` | WebSocket 客户端：连接服务、收发消息、Markdown 渲染 |
| `start.bat` | 一键启动：安装依赖 + 启动服务 |

---

### Task 1: 项目初始化与 package.json

**Files:**
- Create: `paper-sidebar/package.json`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "paper-sidebar",
  "version": "1.0.0",
  "description": "Edge sidebar for paper reading with Claude Code",
  "private": true,
  "scripts": {
    "start": "node server/index.js"
  },
  "dependencies": {
    "express": "^4.21.0",
    "ws": "^8.18.0"
  }
}
```

- [ ] **Step 2: 安装依赖**

Run: `cd "C:/Users/刘子砚/paper-sidebar" && npm install`
Expected: 无报错，node_modules 目录生成

- [ ] **Step 3: 创建目录结构**

Run: `cd "C:/Users/刘子砚/paper-sidebar" && mkdir server extension extension/icons`
Expected: 目录创建成功

---

### Task 2: Claude CLI 调用模块

**Files:**
- Create: `paper-sidebar/server/claude.js`

- [ ] **Step 1: 编写 claude.js**

```javascript
const { spawn } = require('child_process');

const SYSTEM_PROMPT = `你是一个学术论文阅读助手。用户正在阅读一篇论文，会对论文中的术语、方法、公式提出疑问。
请用简洁清晰的中文回答，结合用户可能正在阅读的论文领域给出解释。
如果用户的问题涉及到论文特定内容，请根据上下文给出合理推断。
必要时提供相关参考文献或进一步阅读建议。
回复使用 Markdown 格式，便于阅读。`;

function buildPrompt(question, context = {}) {
  const parts = [SYSTEM_PROMPT];
  if (context.pageTitle) {
    parts.push(`\n当前论文：${context.pageTitle}`);
  }
  if (context.selectedText) {
    parts.push(`\n用户选中的文字："""${context.selectedText}"""`);
  }
  if (context.history && context.history.length > 0) {
    parts.push(`\n对话历史：`);
    context.history.slice(-5).forEach((msg, i) => {
      parts.push(`${msg.role === 'user' ? '用户' : '助手'}: ${msg.content}`);
    });
  }
  parts.push(`\n用户问题：${question}`);
  return parts.join('\n');
}

function askClaude(question, context = {}, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const prompt = buildPrompt(question, context);
    const child = spawn('claude', ['-p', prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Claude CLI 响应超时'));
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr || `Claude CLI 退出码 ${code}`));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`无法启动 Claude CLI: ${err.message}`));
    });
  });
}

function askClaudeStream(question, context = {}, timeoutMs = 60000) {
  const prompt = buildPrompt(question, context);
  const child = spawn('claude', ['-p', prompt], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  const timer = setTimeout(() => {
    child.kill();
  }, timeoutMs);

  child.on('close', () => clearTimeout(timer));

  return { child, timer };
}

module.exports = { askClaude, askClaudeStream, buildPrompt, SYSTEM_PROMPT };
```

- [ ] **Step 2: 验证 claude 命令可用**

Run: `where claude`
Expected: 输出 claude 可执行文件路径

---

### Task 3: Node.js WebSocket 服务

**Files:**
- Create: `paper-sidebar/server/index.js`

- [ ] **Step 1: 编写 index.js**

```javascript
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const { askClaudeStream } = require('./claude');

const PORT = 9876;
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('Sidebar connected');

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: '无效的消息格式' }));
      return;
    }

    if (msg.type !== 'ask') return;

    const { question, context } = msg;

    try {
      const { child, timer } = askClaudeStream(question, context, 60000);

      child.stdout.on('data', (chunk) => {
        ws.send(JSON.stringify({ type: 'chunk', content: chunk.toString() }));
      });

      child.stderr.on('data', (chunk) => {
        ws.send(JSON.stringify({ type: 'error', message: chunk.toString() }));
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        ws.send(JSON.stringify({ type: 'done', exitCode: code }));
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
      });
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  });

  ws.on('close', () => {
    console.log('Sidebar disconnected');
  });

  ws.send(JSON.stringify({ type: 'connected' }));
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Paper Sidebar server running on http://127.0.0.1:${PORT}`);
  const { execSync } = require('child_process');
  try {
    execSync('where claude', { stdio: 'ignore' });
    console.log('Claude CLI detected');
  } catch {
    console.warn('WARNING: claude CLI not found in PATH');
  }
});
```

- [ ] **Step 2: 启动服务并测试健康检查**

Run: `cd "C:/Users/刘子砚/paper-sidebar" && node server/index.js`
Then in another terminal: `curl http://127.0.0.1:9876/health`
Expected: `{"status":"ok"}`

---

### Task 4: Edge 扩展 manifest 与图标

**Files:**
- Create: `paper-sidebar/extension/manifest.json`
- Create: `paper-sidebar/extension/icons/icon16.png`
- Create: `paper-sidebar/extension/icons/icon48.png`
- Create: `paper-sidebar/extension/icons/icon128.png`

- [ ] **Step 1: 编写 manifest.json**

```json
{
  "manifest_version": 3,
  "name": "Paper Sidebar - Claude Assistant",
  "version": "1.0.0",
  "description": "选中PDF论文中的文字，用Claude Code搜索解答",
  "permissions": ["sidePanel", "contextMenus", "activeTab", "scripting"],
  "host_permissions": ["file://*/*", "http://*/*", "https://*/*"],
  "action": {
    "default_title": "打开 Claude 论文助手"
  },
  "side_panel": {
    "default_path": "sidepanel.html"
  },
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["file://*/*.pdf", "http://*/*.pdf", "https://*/*.pdf", "file://*/*", "http://*/*", "https://*/*"],
      "js": ["content.js"],
      "run_at": "document_end"
    }
  ],
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

- [ ] **Step 2: 生成占位图标**

Run: `cd "C:/Users/刘子砚/paper-sidebar/extension/icons" && node -e "
const { writeFileSync } = require('fs');
// Minimal 1x1 PNG (valid PNG header, will be scaled by browser)
const b = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMklEQVQ4y2Ng+M9QPcjAiApAQkBBEwMDAwMWgZiBuLSgBPAoQNREBp0GMMDA8B8Afzgr7QH4l3UAAAAASUVORK5CYII=', 'base64');
[16,48,128].forEach(s => writeFileSync('icon' + s + '.png', b));
console.log('Icons created');
"`
Expected: 三个图标文件生成

---

### Task 5: Service Worker（右键菜单 + 消息中转）

**Files:**
- Create: `paper-sidebar/extension/background.js`

- [ ] **Step 1: 编写 background.js**

```javascript
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'ask-claude',
    title: '🔍 问问 Claude',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'ask-claude' && info.selectionText) {
    chrome.sidePanel.open({ tabId: tab.id }).then(() => {
      setTimeout(() => {
        chrome.runtime.sendMessage({
          type: 'ask-from-context',
          question: info.selectionText,
          context: {
            pageTitle: tab.title || '',
            selectedText: info.selectionText,
          },
        });
      }, 300);
    });
  }
});

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});
```

---

### Task 6: Content Script（PDF 文字捕获）

**Files:**
- Create: `paper-sidebar/extension/content.js`

- [ ] **Step 1: 编写 content.js**

```javascript
document.addEventListener('mouseup', () => {
  const selection = window.getSelection();
  const text = selection ? selection.toString().trim() : '';
  if (text.length > 0) {
    chrome.runtime.sendMessage({
      type: 'text-selected',
      text: text,
    });
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'get-selection') {
    const selection = window.getSelection();
    sendResponse({
      text: selection ? selection.toString().trim() : '',
      title: document.title || '',
    });
  }
  return true;
});
```

---

### Task 7: 侧边栏 UI 与 WebSocket 客户端

**Files:**
- Create: `paper-sidebar/extension/sidepanel.html`
- Create: `paper-sidebar/extension/sidepanel.js`

- [ ] **Step 1: 编写 sidepanel.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Paper Sidebar</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1e1e2e;
      color: #cdd6f4;
      height: 100vh;
      display: flex;
      flex-direction: column;
      font-size: 13px;
    }
    .header {
      padding: 12px 16px;
      background: #181825;
      border-bottom: 1px solid #313244;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    .status { width: 8px; height: 8px; border-radius: 50%; background: #f38ba8; flex-shrink: 0; }
    .status.connected { background: #a6e3a1; }
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .message {
      max-width: 92%;
      padding: 10px 12px;
      border-radius: 10px;
      line-height: 1.6;
      word-break: break-word;
    }
    .message.user {
      align-self: flex-end;
      background: #313244;
    }
    .message.assistant {
      align-self: flex-start;
      background: transparent;
      border: 1px solid #45475a;
    }
    .message.assistant p { margin: 6px 0; }
    .message.assistant p:first-child { margin-top: 0; }
    .message.assistant p:last-child { margin-bottom: 0; }
    .message.assistant code {
      background: #313244;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 12px;
    }
    .message.assistant pre {
      background: #11111b;
      padding: 10px;
      border-radius: 6px;
      overflow-x: auto;
      margin: 6px 0;
    }
    .message.assistant pre code {
      background: none;
      padding: 0;
    }
    .message.assistant ul, .message.assistant ol {
      padding-left: 18px;
      margin: 4px 0;
    }
    .message.assistant blockquote {
      border-left: 3px solid #89b4fa;
      padding-left: 10px;
      color: #a6adc8;
      margin: 6px 0;
    }
    .typing { color: #a6e3a1; font-size: 11px; padding: 4px 12px; }
    .input-area {
      padding: 10px;
      border-top: 1px solid #313244;
      display: flex;
      gap: 8px;
      flex-shrink: 0;
    }
    .input-area input {
      flex: 1;
      background: #313244;
      border: none;
      border-radius: 8px;
      padding: 10px 12px;
      color: #cdd6f4;
      font-size: 13px;
      outline: none;
    }
    .input-area input::placeholder { color: #6c7086; }
    .input-area button {
      background: #89b4fa;
      color: #1e1e2e;
      border: none;
      border-radius: 8px;
      padding: 10px 16px;
      font-weight: 600;
      cursor: pointer;
      font-size: 13px;
    }
    .input-area button:disabled { opacity: 0.5; cursor: default; }
    .info-banner {
      margin: 12px;
      padding: 10px 12px;
      border-radius: 8px;
      font-size: 11px;
      text-align: center;
    }
    .info-banner.disconnected {
      background: #3b1d1d;
      color: #f38ba8;
    }
  </style>
</head>
<body>
  <div class="header">
    <span class="status" id="status"></span>
    <span>Claude Paper Assistant</span>
  </div>
  <div id="messages" class="messages">
    <div class="info-banner disconnected" id="banner">
      未连接到本地服务<br>
      <small>请运行 start.bat 启动服务</small>
    </div>
  </div>
  <div class="input-area">
    <input type="text" id="input" placeholder="输入问题，或选中PDF文字后右键发送..." />
    <button id="sendBtn" disabled>发送</button>
  </div>
  <script src="sidepanel.js"></script>
</body>
</html>
```

- [ ] **Step 2: 编写 sidepanel.js**

```javascript
const WS_URL = 'ws://127.0.0.1:9876';
let ws = null;
let retries = 0;
const MAX_RETRIES = 5;
let currentAssistantBubble = null;
let currentAssistantContent = '';

const statusEl = document.getElementById('status');
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');
const bannerEl = document.getElementById('banner');

function connect() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    retries = 0;
    statusEl.classList.add('connected');
    sendBtn.disabled = false;
    bannerEl.style.display = 'none';
  };

  ws.onclose = () => {
    statusEl.classList.remove('connected');
    sendBtn.disabled = true;
    if (retries < MAX_RETRIES) {
      const delay = Math.min(1000 * Math.pow(2, retries), 16000);
      retries++;
      setTimeout(connect, delay);
    } else {
      bannerEl.style.display = 'block';
      bannerEl.innerHTML = '无法连接到本地服务<br><small>请确认已运行 start.bat</small>';
    }
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'chunk') {
      appendChunk(msg.content);
    } else if (msg.type === 'done') {
      finalizeAssistantBubble();
    } else if (msg.type === 'error') {
      appendError(msg.message);
      finalizeAssistantBubble();
    }
  };
}

function sendQuestion(text) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (!text.trim()) return;

  appendUserBubble(text);
  inputEl.value = '';

  currentAssistantBubble = createAssistantBubble();
  currentAssistantContent = '';

  ws.send(JSON.stringify({
    type: 'ask',
    question: text,
    context: { pageTitle: '', selectedText: text, history: [] },
  }));
}

function appendUserBubble(text) {
  const div = document.createElement('div');
  div.className = 'message user';
  div.textContent = text;
  messagesEl.appendChild(div);
  scrollToBottom();
}

function createAssistantBubble() {
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.innerHTML = '<span class="typing">思考中...</span>';
  messagesEl.appendChild(div);
  scrollToBottom();
  return div;
}

function appendChunk(chunk) {
  if (!currentAssistantBubble) return;
  currentAssistantContent += chunk;
  currentAssistantBubble.innerHTML = renderMarkdown(currentAssistantContent);
  scrollToBottom();
}

function finalizeAssistantBubble() {
  if (!currentAssistantBubble) return;
  if (!currentAssistantContent) {
    currentAssistantBubble.innerHTML = '（无响应）';
  }
  currentAssistantBubble = null;
  currentAssistantContent = '';
}

function appendError(errMsg) {
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.style.color = '#f38ba8';
  div.textContent = '错误: ' + errMsg;
  messagesEl.appendChild(div);
  scrollToBottom();
}

function renderMarkdown(text) {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  html = html
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
  return '<p>' + html + '</p>';
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

sendBtn.addEventListener('click', () => sendQuestion(inputEl.value));
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendQuestion(inputEl.value);
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'ask-from-context' && msg.question) {
    sendQuestion(msg.question);
  }
});

connect();
```

---

### Task 8: 启动脚本

**Files:**
- Create: `paper-sidebar/start.bat`

- [ ] **Step 1: 编写 start.bat**

```bat
@echo off
chcp 65001 >nul
title Paper Sidebar - Claude Assistant

cd /d "%~dp0"

echo ================================
echo   Paper Sidebar 启动中...
echo ================================

if not exist "node_modules" (
    echo [1/2] 安装依赖...
    call npm install
) else (
    echo [1/2] 依赖已安装，跳过
)

echo [2/2] 启动服务 (端口 9876)...
echo.
echo 请在 Edge 中加载扩展:
echo   1. 打开 edge://extensions
echo   2. 开启"开发人员模式"
echo   3. 加载解压缩的扩展 → 选择 extension 文件夹
echo.
node server/index.js
pause
```

---

### Task 9: 端到端验证

- [ ] **Step 1: 启动服务**

Run: `cd "C:/Users/刘子砚/paper-sidebar" && node server/index.js`
Expected: 输出 `Paper Sidebar server running on http://127.0.0.1:9876` 和 `Claude CLI detected`

- [ ] **Step 2: 测试 WebSocket 连接**

Run: `cd "C:/Users/刘子砚/paper-sidebar" && node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:9876');
ws.on('open', () => { console.log('WS connected'); ws.close(); });
ws.on('error', (e) => { console.error('WS failed:', e.message); process.exit(1); });
"`
Expected: 输出 `WS connected`

- [ ] **Step 3: 测试 Claude CLI 调用**

Run: `cd "C:/Users/刘子砚/paper-sidebar" && node -e "
const { askClaude } = require('./server/claude');
askClaude('用一句话解释什么是神经网络', {}).then(r => { console.log('OK:', r.slice(0, 100)); }).catch(e => console.error('FAIL:', e.message));
"`
Expected: 输出 `OK: ...` 并包含 Claude 的回答

- [ ] **Step 4: 加载扩展到 Edge**

1. 打开 `edge://extensions`
2. 开启"开发人员模式"
3. 点击"加载解压缩的扩展" → 选择 `paper-sidebar/extension` 文件夹
4. 确认扩展出现，无错误提示

- [ ] **Step 5: 打开 PDF 并测试完整流程**

1. 在 Edge 中打开一个 PDF 文件
2. 选中一段文字
3. 右键 → "🔍 问问 Claude"
4. 确认侧边栏打开并显示回答

---

## 实现顺序

```
Task 1 (项目初始化)
  → Task 2 (Claude CLI 模块)
    → Task 3 (WebSocket 服务)
      → Task 4 (manifest + 图标)
        → Task 5 (Service Worker)
          → Task 6 (Content Script)
            → Task 7 (侧边栏 UI)
              → Task 8 (启动脚本)
                → Task 9 (端到端验证)
```
