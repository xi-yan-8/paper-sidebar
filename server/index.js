const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { askClaudeStream } = require('./claude');

const PORT = 9876;
const HISTORY_DIR = 'D:/paper-sidebar-history';

const app = express();
app.use(express.json({ limit: '10mb' }));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let activeEmitter = null;
let activeTimer = null;

// --- History helpers ---

function ensureHistoryDir() {
  if (!fs.existsSync(HISTORY_DIR)) {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
  }
}

function generateId() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const time = now.toISOString().slice(11, 19).replace(/:/g, '');
  const rand = crypto.randomBytes(3).toString('hex');
  return `${date}-${time}-${rand}`;
}

function saveConversation(id, title, messages) {
  ensureHistoryDir();
  const file = path.join(HISTORY_DIR, `${id}.json`);
  const data = {
    id,
    title: title || '未命名对话',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages,
  };
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

function loadConversation(id) {
  const file = path.join(HISTORY_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function listConversations() {
  ensureHistoryDir();
  const files = fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith('.json'));
  const list = files.map(f => {
    const data = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, f), 'utf-8'));
    return { id: data.id, title: data.title, createdAt: data.createdAt, msgCount: data.messages.length };
  });
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return list;
}

function deleteConversation(id) {
  const file = path.join(HISTORY_DIR, `${id}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

// --- HTTP API ---

app.get('/history', (_req, res) => {
  try {
    res.json(listConversations());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/history/:id', (req, res) => {
  try {
    const data = loadConversation(req.params.id);
    if (!data) return res.status(404).json({ error: 'not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/history', (req, res) => {
  try {
    const { id, title, messages } = req.body;
    if (!id || !messages) return res.status(400).json({ error: 'id and messages required' });
    saveConversation(id, title, messages);
    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/history/:id', (req, res) => {
  try {
    deleteConversation(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// --- WebSocket ---

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

    if (!question || typeof question !== 'string' || question.trim() === '') {
      ws.send(JSON.stringify({ type: 'error', message: '问题不能为空' }));
      return;
    }

    if (activeEmitter) {
      if (activeTimer) {
        clearTimeout(activeTimer);
        activeTimer = null;
      }
      activeEmitter.removeAllListeners();
      activeEmitter = null;
    }

    try {
      const { emitter, timer } = askClaudeStream(question, context || {}, 120000);
      activeEmitter = emitter;
      activeTimer = timer;

      let fullResponse = '';

      emitter.on('data', (chunk) => {
        fullResponse += chunk;
        ws.send(JSON.stringify({ type: 'chunk', content: chunk }));
      });

      emitter.on('close', (code) => {
        clearTimeout(timer);
        if (activeEmitter === emitter) {
          activeEmitter = null;
          activeTimer = null;
        }
        ws.send(JSON.stringify({
          type: 'done',
          exitCode: code,
          fullResponse: fullResponse,
        }));
      });

      emitter.on('error', (err) => {
        clearTimeout(timer);
        if (activeEmitter === emitter) {
          activeEmitter = null;
          activeTimer = null;
        }
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

// --- Shutdown ---

function shutdown() {
  console.log('\nShutting down...');
  if (activeEmitter) {
    if (activeTimer) {
      clearTimeout(activeTimer);
      activeTimer = null;
    }
    activeEmitter.removeAllListeners();
    activeEmitter = null;
  }
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
  setTimeout(() => {
    console.warn('Forced shutdown');
    process.exit(1);
  }, 5000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use.`);
    process.exit(1);
  }
  console.error('Server error:', err.message);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  ensureHistoryDir();
  console.log(`Paper Sidebar server running on http://127.0.0.1:${PORT}`);
  console.log(`History: ${HISTORY_DIR}`);
  console.log('Using DeepSeek API (deepseek-v4-pro)');
});
