const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { askClaudeStream } = require('./claude');

const PORT = 9876;
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let activeChild = null;
let activeChildTimer = null;

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

    // Validate question field
    if (!question || typeof question !== 'string' || question.trim() === '') {
      ws.send(JSON.stringify({ type: 'error', message: '问题不能为空' }));
      return;
    }

    // Guard against concurrent child processes
    if (activeChild) {
      if (activeChildTimer) {
        clearTimeout(activeChildTimer);
        activeChildTimer = null;
      }
      activeChild.removeAllListeners();
      activeChild.kill();
      activeChild = null;
    }

    try {
      const { child, timer } = askClaudeStream(question, context, 60000);
      activeChild = child;
      activeChildTimer = timer;

      child.stdout.on('data', (chunk) => {
        ws.send(JSON.stringify({ type: 'chunk', content: chunk.toString() }));
      });

      child.stderr.on('data', (chunk) => {
        ws.send(JSON.stringify({ type: 'error', message: chunk.toString() }));
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (activeChild === child) {
          activeChild = null;
          activeChildTimer = null;
        }
        ws.send(JSON.stringify({ type: 'done', exitCode: code }));
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        if (activeChild === child) {
          activeChild = null;
          activeChildTimer = null;
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

// Graceful shutdown handlers
function shutdown() {
  console.log('\nShutting down gracefully...');
  if (activeChild) {
    if (activeChildTimer) {
      clearTimeout(activeChildTimer);
      activeChildTimer = null;
    }
    activeChild.removeAllListeners();
    activeChild.kill();
    activeChild = null;
  }
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
  // Force exit after 5 seconds if server doesn't close
  setTimeout(() => {
    console.warn('Forced shutdown after timeout');
    process.exit(1);
  }, 5000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Is another instance running?`);
    process.exit(1);
  } else {
    console.error('Server error:', err.message);
    process.exit(1);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Paper Sidebar server running on http://127.0.0.1:${PORT}`);
  const { execSync } = require('child_process');
  const isWindows = process.platform === 'win32';
  try {
    execSync(`${isWindows ? 'where' : 'which'} claude`, { stdio: 'ignore' });
    console.log('Claude CLI detected');
  } catch {
    console.warn('WARNING: claude CLI not found in PATH');
  }
});
