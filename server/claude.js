const { EventEmitter } = require('events');

const API_KEY = 'sk-e845908a5c274142a29bc958d21212ca';
const API_URL = 'https://api.deepseek.com/v1/chat/completions';
const MODEL = 'deepseek-v4-pro';

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
    context.history.slice(-10).forEach((msg) => {
      parts.push(`${msg.role === 'user' ? '用户' : '助手'}: ${msg.content}`);
    });
  }
  parts.push(`\n用户问题：${question}`);
  return parts.join('\n');
}

function buildMessages(question, context = {}) {
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];

  if (context.pageTitle) {
    messages.push({ role: 'system', content: `用户正在阅读论文：《${context.pageTitle}》` });
  }

  if (context.history && context.history.length > 0) {
    context.history.slice(-10).forEach((msg) => {
      messages.push({ role: msg.role, content: msg.content });
    });
  }

  let userContent = question;
  if (context.selectedText && context.selectedText !== question) {
    userContent = `论文原文："""${context.selectedText}"""\n\n问题：${question}`;
  }
  messages.push({ role: 'user', content: userContent });

  return messages;
}

async function askClaude(question, context = {}, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: buildMessages(question, context),
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`API 请求失败 (${response.status}): ${errText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}

function askClaudeStream(question, context = {}, timeoutMs = 60000) {
  const emitter = new EventEmitter();
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
    emitter.emit('close', -1);
  }, timeoutMs);

  (async () => {
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages: buildMessages(question, context),
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        emitter.emit('error', new Error(`API 请求失败 (${response.status}): ${errText}`));
        clearTimeout(timer);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              emitter.emit('data', content);
            }
          } catch {
            // skip unparseable chunks
          }
        }
      }

      clearTimeout(timer);
      emitter.emit('close', 0);
    } catch (err) {
      if (err.name !== 'AbortError') {
        emitter.emit('error', err);
      }
      clearTimeout(timer);
    }
  })();

  return { emitter, timer };
}

module.exports = { askClaude, askClaudeStream, buildPrompt, SYSTEM_PROMPT };
