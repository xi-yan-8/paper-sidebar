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
