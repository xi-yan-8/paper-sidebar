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
