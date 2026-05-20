const WS_URL = 'ws://127.0.0.1:9876';
const API_BASE = 'http://127.0.0.1:9876';
let ws = null;
let retries = 0;
const MAX_RETRIES = 5;
let currentAssistantBubble = null;
let currentAssistantContent = '';

// Conversation tracking
let conversationId = null;
let conversationMessages = [];

const statusEl = document.getElementById('status');
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');
const bannerEl = document.getElementById('banner');

// History UI elements
const historyBtn = document.getElementById('historyBtn');
const historyPanel = document.getElementById('historyPanel');
const historyOverlay = document.getElementById('historyOverlay');
const historyList = document.getElementById('historyList');
const closeHistoryBtn = document.getElementById('closeHistoryBtn');
const newChatBtn = document.getElementById('newChatBtn');

// --- Conversation management ---

function newConversation() {
  conversationId = 'conv-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  conversationMessages = [];
  clearMessages();
}

function clearMessages() {
  const children = messagesEl.querySelectorAll('.message');
  children.forEach(c => c.remove());
}

function addMessage(role, content) {
  conversationMessages.push({ role, content });
}

async function saveCurrentConversation() {
  if (!conversationId || conversationMessages.length === 0) return;
  const title = conversationMessages.find(m => m.role === 'user')?.content?.slice(0, 50) || '未命名';
  try {
    await fetch(API_BASE + '/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: conversationId, title, messages: conversationMessages }),
    });
  } catch (e) {
    console.warn('Save failed:', e.message);
  }
}

async function loadConversation(id) {
  try {
    const r = await fetch(API_BASE + '/history/' + id);
    if (!r.ok) return;
    const data = await r.json();
    conversationId = data.id;
    conversationMessages = data.messages;
    clearMessages();
    data.messages.forEach(m => {
      if (m.role === 'user') appendUserBubble(m.content);
      else appendAssistantBubbleStatic(m.content);
    });
    closeHistory();
  } catch (e) {
    console.warn('Load failed:', e.message);
  }
}

// --- History panel ---

async function refreshHistoryList() {
  try {
    const r = await fetch(API_BASE + '/history');
    const list = await r.json();
    historyList.innerHTML = '';
    if (list.length === 0) {
      historyList.innerHTML = '<div style="padding:20px;text-align:center;color:#6c7086;font-size:12px;">暂无历史对话</div>';
      return;
    }
    list.forEach(item => {
      const div = document.createElement('div');
      div.className = 'history-item' + (item.id === conversationId ? ' active' : '');
      div.innerHTML = `
        <div class="h-info">
          <div class="h-title">${escapeHtml(item.title)}</div>
          <div class="h-meta">${formatDate(item.createdAt)} · ${item.msgCount} 条消息</div>
        </div>
        <span class="h-del" data-id="${item.id}">🗑</span>
      `;
      div.querySelector('.h-info').addEventListener('click', () => loadConversation(item.id));
      div.querySelector('.h-del').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteHistory(item.id);
      });
      historyList.appendChild(div);
    });
  } catch (e) {
    historyList.innerHTML = '<div style="padding:20px;text-align:center;color:#f38ba8;font-size:12px;">加载失败</div>';
  }
}

async function deleteHistory(id) {
  try {
    await fetch(API_BASE + '/history/' + id, { method: 'DELETE' });
    if (conversationId === id) newConversation();
    refreshHistoryList();
  } catch (e) {
    console.warn('Delete failed:', e.message);
  }
}

function openHistory() {
  historyPanel.classList.add('show');
  historyOverlay.classList.add('show');
  refreshHistoryList();
}

function closeHistory() {
  historyPanel.classList.remove('show');
  historyOverlay.classList.remove('show');
}

function formatDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// --- WebSocket ---

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
      const response = msg.fullResponse || currentAssistantContent;
      finalizeAssistantBubble(response);
      if (response) {
        addMessage('assistant', response);
        saveCurrentConversation();
      }
    } else if (msg.type === 'error') {
      appendError(msg.message);
      finalizeAssistantBubble('');
    }
  };
}

function sendQuestion(text) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (!text.trim()) return;

  if (!conversationId) newConversation();

  appendUserBubble(text);
  addMessage('user', text);
  inputEl.value = '';

  currentAssistantBubble = createAssistantBubble();
  currentAssistantContent = '';

  ws.send(JSON.stringify({
    type: 'ask',
    question: text,
    context: { pageTitle: '', selectedText: text, history: conversationMessages.slice(0, -1) },
  }));
}

function appendUserBubble(text) {
  const div = document.createElement('div');
  div.className = 'message user';
  div.textContent = text;
  messagesEl.appendChild(div);
  scrollToBottom();
}

function appendAssistantBubbleStatic(content) {
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.innerHTML = renderMarkdown(content);
  messagesEl.appendChild(div);
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

function finalizeAssistantBubble(finalContent) {
  if (!currentAssistantBubble) return;
  if (finalContent) {
    currentAssistantBubble.innerHTML = renderMarkdown(finalContent);
  } else if (!currentAssistantContent) {
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

function renderMath(text) {
  // Render LaTeX math with KaTeX
  // $$...$$ for display math, $...$ for inline math
  const placeholders = [];

  // Protect code blocks first
  let html = text.replace(/```[\s\S]*?```/g, (match) => {
    const idx = placeholders.length;
    placeholders.push(match);
    return `<<<CODE${idx}>>>`;
  });

  // Render display math $$...$$
  html = html.replace(/\$\$([\s\S]*?)\$\$/g, (_m, formula) => {
    try {
      // Unescape HTML entities that came from text escaping
      const clean = formula.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      return katex.renderToString(clean, { displayMode: true, throwOnError: false });
    } catch (e) {
      return '<code>公式错误</code>';
    }
  });

  // Render inline math $...$
  html = html.replace(/\$(.+?)\$/g, (_m, formula) => {
    try {
      const clean = formula.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      return katex.renderToString(clean, { displayMode: false, throwOnError: false });
    } catch (e) {
      return '<code>公式错误</code>';
    }
  });

  // Restore code blocks
  html = html.replace(/<<<CODE(\d+)>>>/g, (_m, idx) => {
    const code = placeholders[parseInt(idx)];
    const escaped = code
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return '<pre><code>' + escaped.replace(/^```\w*\n?/, '').replace(/```$/, '') + '</code></pre>';
  });

  return html;
}

function renderMarkdown(text) {
  // Escape HTML first
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Render math before other markdown (so $ inside code blocks is protected)
  html = renderMath(html);

  // Markdown formatting (skip if already has HTML tags from KaTeX/code)
  html = html
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');

  // Wrap in paragraph only if not starting with a block element
  if (!html.match(/^<(h[1-3]|ul|ol|pre|blockquote|table|div|span)/)) {
    html = '<p>' + html + '</p>';
  }

  return html;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// --- Event listeners ---

sendBtn.addEventListener('click', () => sendQuestion(inputEl.value));
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendQuestion(inputEl.value);
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'ask-from-context' && msg.question) {
    sendQuestion(msg.question);
  }
});

historyBtn.addEventListener('click', openHistory);
closeHistoryBtn.addEventListener('click', closeHistory);
historyOverlay.addEventListener('click', closeHistory);
newChatBtn.addEventListener('click', () => {
  newConversation();
  closeHistory();
});

// --- Init ---

newConversation();
connect();
