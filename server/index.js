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
