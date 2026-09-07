import { listChatMessages, sendChatMessage } from './api.js?v=offline-chat-20260907';

const dateFormat = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' });
const timeFormat = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' });

export function renderMessages(root, messages, userId) {
  const fragment = document.createDocumentFragment();
  let lastDay = '';
  for (const message of [...messages].sort((a, b) => a.id - b.id)) {
    const date = new Date(message.createdAt);
    const day = dateFormat.format(date);
    if (day !== lastDay) {
      const separator = document.createElement('h3');
      separator.className = 'chat-day';
      separator.textContent = day;
      fragment.append(separator);
      lastDay = day;
    }
    const bubble = document.createElement('article');
    bubble.className = message.userId === userId ? 'chat-message chat-message--own' : 'chat-message';
    const author = document.createElement('strong');
    author.textContent = message.username;
    const content = document.createElement('p');
    content.textContent = message.content;
    const time = document.createElement('time');
    time.dateTime = message.createdAt;
    time.textContent = timeFormat.format(date);
    bubble.append(author, content, time);
    fragment.append(bubble);
  }
  const atBottom = root.scrollHeight - root.scrollTop - root.clientHeight < 60;
  root.replaceChildren(fragment);
  if (atBottom) root.scrollTop = root.scrollHeight;
}

export function initChat(root, user, { offline = false } = {}) {
  const list = root.querySelector('#chat-messages');
  const status = root.querySelector('#chat-status');
  const form = root.querySelector('#chat-form');
  const input = root.querySelector('#chat-input');
  const submit = root.querySelector('#chat-send');
  const messages = new Map();
  let cursor = 0;
  let disposed = false;
  let loading = false;
  let sending = false;
  let retry = null;
  const offlineText = 'El chat requiere conexión. Tus herramientas locales siguen disponibles.';

  function accept(message) {
    messages.set(message.id, message);
  }
  async function refresh() {
    if (disposed || loading || offline || document.hidden || root.hidden) return;
    loading = true;
    try {
      let hasMore;
      do {
        const result = await listChatMessages(cursor);
        if (disposed) return;
        for (const message of result.messages) {
          accept(message);
          cursor = Math.max(cursor, message.id);
        }
        hasMore = result.hasMore;
      } while (hasMore && !disposed);
      renderMessages(list, messages.values(), user.id);
      status.textContent = messages.size ? '' : 'Todavía no hay mensajes. Iniciá la conversación.';
    } catch (error) {
      if (!disposed) status.textContent = error.status === 401 ? 'Iniciá sesión para usar el chat.' : offlineText;
    } finally {
      loading = false;
    }
  }
  async function send(event) {
    event.preventDefault();
    if (sending || disposed) return;
    if (offline || navigator.onLine === false) {
      status.textContent = offlineText;
      return;
    }
    const content = input.value.trim();
    if (!content) return;
    if (!retry || retry.content !== content) retry = { content, requestId: crypto.randomUUID() };
    sending = true;
    submit.disabled = true;
    input.disabled = true;
    try {
      const result = await sendChatMessage(retry);
      if (disposed) return;
      accept(result.message);
      renderMessages(list, messages.values(), user.id);
      input.value = '';
      retry = null;
      status.textContent = '';
      await refresh();
    } catch (error) {
      if (!disposed) status.textContent = `${error.message} El envío no se confirmó; podés reintentar.`;
    } finally {
      sending = false;
      submit.disabled = offline;
      input.disabled = false;
    }
  }
  function connectionLost() { status.textContent = offlineText; }
  form.addEventListener('submit', send);
  window.addEventListener('offline', connectionLost);
  status.textContent = offline ? offlineText : 'Cargando mensajes…';
  submit.disabled = offline;
  const timer = window.setInterval(refresh, 5000);
  return {
    refresh,
    destroy() {
      disposed = true;
      window.clearInterval(timer);
      form.removeEventListener('submit', send);
      window.removeEventListener('offline', connectionLost);
      list.replaceChildren();
      input.value = '';
    }
  };
}
