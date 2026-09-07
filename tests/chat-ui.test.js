import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { initChat, renderMessages } from '../public/js/chat.js';

let windowRef;
let chat;
beforeEach(() => {
  windowRef = new Window({ url: 'https://budines.test' });
  windowRef.document.write(readFileSync('public/index.html', 'utf8'));
  vi.stubGlobal('window', windowRef);
  vi.stubGlobal('document', windowRef.document);
  vi.stubGlobal('navigator', { onLine: true });
  document.querySelector('#chat-tool').hidden = false;
});
afterEach(() => {
  chat?.destroy();
  chat = null;
  windowRef.close();
  vi.unstubAllGlobals();
});

const message = { id: 1, userId: 'santi', username: 'Santi', content: '<script>alert(1)</script>', createdAt: '2026-09-07T17:20:00.000Z' };

it('agrupa por día de Argentina, ordena y muestra solo hora por mensaje como texto seguro', () => {
  const root = document.querySelector('#chat-messages');
  renderMessages(root, [
    { ...message, id: 3, createdAt: '2026-09-08T17:23:00.000Z' },
    message,
    { ...message, id: 2, createdAt: '2026-09-08T01:00:00.000Z' }
  ], 'santi');
  expect([...root.querySelectorAll('h3')].map(node => node.textContent)).toEqual(['7 de septiembre de 2026', '8 de septiembre de 2026']);
  expect([...root.querySelectorAll('time')].map(node => node.textContent)).toEqual(['14:20', '22:00', '14:23']);
  expect(root.querySelector('script')).toBeNull();
  expect(root.querySelector('p').textContent).toBe(message.content);
});

it('polling no duplica y un envío de resultado incierto conserva texto y clave para reintentar', async () => {
  const sent = [];
  let fail = true;
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    if (options.method === 'POST') {
      sent.push(JSON.parse(options.body));
      if (fail) throw new TypeError('offline');
      return new Response(JSON.stringify({ ok: true, message }));
    }
    return new Response(JSON.stringify({ ok: true, messages: [message], hasMore: false }));
  }));
  const root = document.querySelector('#chat-tool');
  chat = initChat(root, { id: 'santi' });
  const input = document.querySelector('#chat-input');
  input.value = message.content;
  const submit = () => document.querySelector('#chat-form').dispatchEvent(new windowRef.Event('submit', { cancelable: true }));
  submit();
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(root.querySelectorAll('article')).toHaveLength(0);
  expect(input.value).toBe(message.content);
  expect(document.querySelector('#chat-status').textContent).toContain('no se confirmó');
  fail = false;
  submit();
  await new Promise(resolve => setTimeout(resolve, 10));
  await chat.refresh();
  await chat.refresh();
  expect(sent[0].requestId).toBe(sent[1].requestId);
  expect(root.querySelectorAll('article')).toHaveLength(1);
  expect(input.value).toBe('');
});
