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
const welcomeEl = document.getElementById('welcomeScreen');

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
  showWelcome();
}

function clearMessages() {
  const rows = messagesEl.querySelectorAll('.message-row');
  rows.forEach(r => r.remove());
  // Also remove any stray static assistant divs from old format
  messagesEl.querySelectorAll('.message').forEach(m => m.remove());
  // Remove old error messages
  messagesEl.querySelectorAll('.error-msg').forEach(m => m.remove());
}

function hideWelcome() {
  if (welcomeEl) welcomeEl.style.display = 'none';
}

function showWelcome() {
  if (welcomeEl) welcomeEl.style.display = '';
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
    hideWelcome();
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
      historyList.innerHTML = '<div class="history-empty">暂无历史对话</div>';
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
        <span class="h-del" data-id="${item.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </span>
      `;
      div.querySelector('.h-info').addEventListener('click', () => loadConversation(item.id));
      div.querySelector('.h-del').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteHistory(item.id);
      });
      historyList.appendChild(div);
    });
  } catch (e) {
    historyList.innerHTML = '<div class="history-empty" style="color:#f87171">加载失败</div>';
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

  hideWelcome();
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

// --- Message rendering ---

function createMessageRow(role) {
  const row = document.createElement('div');
  row.className = 'message-row ' + role;

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = role === 'user' ? '你' : 'AI';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  row.appendChild(avatar);
  row.appendChild(bubble);
  messagesEl.appendChild(row);
  return row;
}

function appendUserBubble(text) {
  const row = createMessageRow('user');
  row.querySelector('.message-bubble').textContent = text;
  scrollToBottom();
}

function appendAssistantBubbleStatic(content) {
  const row = createMessageRow('assistant');
  row.querySelector('.message-bubble').innerHTML = renderMarkdown(content);
}

function createAssistantBubble() {
  const row = createMessageRow('assistant');
  row.querySelector('.message-bubble').innerHTML = `
    <div class="typing-indicator">
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
    </div>
  `;
  scrollToBottom();
  return row;
}

function appendChunk(chunk) {
  if (!currentAssistantBubble) return;
  currentAssistantContent += chunk;
  currentAssistantBubble.querySelector('.message-bubble').innerHTML = renderMarkdown(currentAssistantContent);
  scrollToBottom();
}

function finalizeAssistantBubble(finalContent) {
  if (!currentAssistantBubble) return;
  if (finalContent) {
    currentAssistantBubble.querySelector('.message-bubble').innerHTML = renderMarkdown(finalContent);
  } else if (!currentAssistantContent) {
    currentAssistantBubble.querySelector('.message-bubble').innerHTML = '<span style="color:#9c9c9c">（无响应）</span>';
  }
  currentAssistantBubble = null;
  currentAssistantContent = '';
}

function appendError(errMsg) {
  const row = document.createElement('div');
  row.className = 'message-row assistant error';
  row.innerHTML = `
    <div class="message-avatar" style="background:linear-gradient(135deg,#f87171,#fb923c);color:#fff">!</div>
    <div class="message-bubble">${escapeHtml(errMsg)}</div>
  `;
  messagesEl.appendChild(row);
  scrollToBottom();
}

// --- Markdown & Math rendering ---

function renderMath(text) {
  const placeholders = [];

  let html = text.replace(/```[\s\S]*?```/g, (match) => {
    const idx = placeholders.length;
    placeholders.push(match);
    return `<<<CODE${idx}>>>`;
  });

  html = html.replace(/\$\$([\s\S]*?)\$\$/g, (_m, formula) => {
    try {
      const clean = formula.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      return katex.renderToString(clean, { displayMode: true, throwOnError: false });
    } catch (e) {
      return '<code>公式错误</code>';
    }
  });

  html = html.replace(/\$(.+?)\$/g, (_m, formula) => {
    try {
      const clean = formula.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      return katex.renderToString(clean, { displayMode: false, throwOnError: false });
    } catch (e) {
      return '<code>公式错误</code>';
    }
  });

  html = html.replace(/<<<CODE(\d+)>>>/g, (_m, idx) => {
    const code = placeholders[parseInt(idx)];
    const escaped = code
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return '<pre><code>' + escaped.replace(/^```\w*\n?/, '').replace(/```$/, '') + '</code></pre>';
  });

  return html;
}

function renderMarkdown(text) {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  html = renderMath(html);

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

// Suggestion chips
if (welcomeEl) {
  welcomeEl.addEventListener('click', (e) => {
    const chip = e.target.closest('.suggestion-chip');
    if (chip) {
      const query = chip.dataset.query;
      if (query) sendQuestion(query);
    }
  });
}

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
