const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { askClaudeStream } = require('./claude');

const PORT = 9876;
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let activeEmitter = null;
let activeTimer = null;

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

    // Cancel previous request if still in-flight
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

      emitter.on('data', (chunk) => {
        ws.send(JSON.stringify({ type: 'chunk', content: chunk }));
      });

      emitter.on('close', (code) => {
        clearTimeout(timer);
        if (activeEmitter === emitter) {
          activeEmitter = null;
          activeTimer = null;
        }
        ws.send(JSON.stringify({ type: 'done', exitCode: code }));
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

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

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
  console.log(`Paper Sidebar server running on http://127.0.0.1:${PORT}`);
  console.log('Using DeepSeek API (deepseek-chat)');
});
