import { requestChat, type ChatSource } from './chat-stream';

let mounted: HTMLElement | null = null;
let dispose = () => {};
let syncMode = () => {};

/** The same node survives Astro navigation between the floating and page chat. */
export function initChatDock(): void {
  const dock = document.getElementById('chat-dock');
  if (mounted === dock) { syncMode(); return; }
  dispose();
  mounted = dock;
  if (!dock) return;
  const listeners = new AbortController();
  const eventOptions = { signal: listeners.signal };
  const form = dock.querySelector<HTMLFormElement>('#chat-form')!;
  const input = dock.querySelector<HTMLInputElement>('#chat-q')!;
  const nameInput = dock.querySelector<HTMLInputElement>('#chat-name')!;
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const submitLabel = submit.querySelector<HTMLElement>('.submit-label')!;
  const panel = dock.querySelector<HTMLElement>('#dock-panel')!;
  const conversation = dock.querySelector<HTMLElement>('#conversation')!;
  const empty = dock.querySelector<HTMLElement>('#dock-empty')!;
  const scroll = dock.querySelector<HTMLElement>('#dock-scroll')!;
  const newChat = dock.querySelector<HTMLButtonElement>('#dock-new')!;
  let request: AbortController | null = null;
  let trigger: HTMLElement | null = null;
  const embedded = () => document.body.classList.contains('verso-page');

  function sync(): void {
    const open = embedded() || dock!.classList.contains('open');
    panel.inert = !open;
    input.setAttribute('aria-expanded', String(open));
    document.querySelectorAll('[data-verso-open]').forEach(el => el.setAttribute('aria-expanded', String(open)));
  }
  function open(): void { dock!.classList.add('open'); sync(); }
  function close(restoreFocus = false): void {
    if (embedded()) return;
    dock!.classList.remove('open');
    input.blur();
    sync();
    if (restoreFocus) (trigger?.isConnected ? trigger : input).focus({ preventScroll: true });
  }
  // Focusing the collapsed composer opens it, so closing without an external
  // trigger leaves focus on the close button's owner rather than reopening it.
  function closeFromButton(): void { close(Boolean(trigger?.isConnected)); }

  function sizeToKeyboard(): void {
    const viewport = window.visualViewport;
    if (!viewport || viewport.scale !== 1) return;
    dock!.style.setProperty('--chat-visible-height', `${viewport.height}px`);
    dock!.style.setProperty('--chat-keyboard-offset', `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`);
  }
  syncMode = () => {
    if (embedded()) dock!.classList.add('open');
    sync(); sizeToKeyboard();
  };
  syncMode();
  window.visualViewport?.addEventListener('resize', sizeToKeyboard, eventOptions);
  window.visualViewport?.addEventListener('scroll', sizeToKeyboard, eventOptions);

  const readCid = () => { try { return sessionStorage.getItem('verso:cid') || undefined; } catch { return undefined; } };
  try { nameInput.value = localStorage.getItem('verso:name') || ''; } catch { /* Storage is optional. */ }
  nameInput.addEventListener('change', () => {
    try { localStorage.setItem('verso:name', nameInput.value.trim().slice(0, 40)); } catch { /* Optional. */ }
  }, eventOptions);

  function appendTemplate(id: string, parent = conversation): HTMLElement {
    const template = dock!.querySelector<HTMLTemplateElement>(id)!;
    const node = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
    parent.append(node);
    return node;
  }
  const scrollToAnswer = () => { scroll.scrollTop = scroll.scrollHeight; };
  function busy(value: boolean): void {
    input.disabled = value;
    newChat.disabled = value;
    submitLabel.textContent = value ? 'Stop' : 'Ask';
    submit.setAttribute('aria-label', value ? 'Stop response' : 'Send message');
    submit.classList.toggle('is-busy', value);
  }
  function renderText(target: HTMLElement, text: string): void {
    target.innerHTML = text.split(/\n{2,}/).filter(Boolean).map(p =>
      `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>').replace(/\n/g, '<br>')}</p>`).join('');
  }
  function renderSources(target: HTMLElement, sources: ChatSource[]): void {
    const block = document.createElement('div');
    block.className = 'sources';
    const heading = document.createElement('p');
    heading.className = 'h';
    heading.textContent = 'Explore the sources';
    block.append(heading);
    for (const source of sources) {
      if (!source || typeof source.url !== 'string' || typeof source.title !== 'string') continue;
      const url = new URL(source.url, location.origin);
      if (url.origin !== location.origin || !source.url.startsWith('/') || source.url.startsWith('//')) continue;
      const link = document.createElement('a');
      link.className = 'source-item'; link.href = url.pathname;
      const tag = document.createElement('span'); tag.className = 'si-tag'; tag.textContent = source.type;
      const title = document.createElement('span'); title.className = 'si-title'; title.textContent = source.title;
      link.append(tag, title); block.append(link);
    }
    if (block.children.length > 1) target.append(block);
  }

  async function ask(query: string, retryTurn?: HTMLElement): Promise<void> {
    query = query.trim();
    if (!query || request) return;
    request = new AbortController();
    busy(true); open(); empty.hidden = true;
    dock!.querySelector<HTMLDetailsElement>('#dock-identity')!.open = false;
    if (!retryTurn) appendTemplate('#tpl-you').querySelector<HTMLElement>('.said')!.textContent = query;
    const turn = retryTurn ?? appendTemplate('#tpl-site');
    if (retryTurn) {
      const template = dock!.querySelector<HTMLTemplateElement>('#tpl-site')!;
      turn.querySelector('.said')!.replaceChildren(template.content.querySelector('.answer')!.cloneNode(true));
    }
    const answer = turn.querySelector<HTMLElement>('.answer')!;
    const said = turn.querySelector<HTMLElement>('.said')!;
    const waited = turn.querySelector<HTMLElement>('.waited')!;
    input.value = ''; scrollToAnswer();
    let text = '';
    let sources: ChatSource[] = [];
    const timer = setTimeout(() => { if (waited) waited.hidden = false; }, 12_000);
    try {
      await requestChat({ query, cid: readCid(), name: nameInput.value.trim().slice(0, 40) || undefined }, {
        signal: request.signal,
        onEvent(event) {
          if (typeof event.cid === 'string') { try { sessionStorage.setItem('verso:cid', event.cid); } catch { /* Optional. */ } }
          if (typeof event.mid === 'string') turn.dataset.mid = event.mid;
          if (typeof event.text === 'string' && event.text) {
            clearTimeout(timer); text += event.text; renderText(answer, text); scrollToAnswer();
          }
          if (Array.isArray(event.sources)) sources = event.sources;
        },
      });
      if (!text.trim()) throw new Error('Nothing came back. Please try again.');
      renderSources(said, sources);
    } catch (error) {
      if (!text) answer.replaceChildren();
      const recovery = appendTemplate('#tpl-retry', said);
      recovery.querySelector<HTMLElement>('.dock-error')!.textContent = error instanceof Error ? error.message : 'Connection lost. Please try again.';
      recovery.querySelector('button')!.addEventListener('click', () => { void ask(query, turn); }, eventOptions);
    } finally {
      clearTimeout(timer); request = null; busy(false); scrollToAnswer();
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (request) request.abort(); else void ask(input.value);
  }, eventOptions);
  input.addEventListener('focus', open, eventOptions);
  dock.querySelector('#dock-close')!.addEventListener('click', closeFromButton, eventOptions);
  newChat.addEventListener('click', () => {
    if (request) return;
    try { sessionStorage.removeItem('verso:cid'); } catch { /* Optional. */ }
    conversation.replaceChildren(); empty.hidden = false; input.value = ''; input.focus({ preventScroll: true });
  }, eventOptions);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeFromButton(); }, eventOptions);
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    const opener = target?.closest<HTMLElement>('[data-verso-open]');
    if (opener) {
      trigger = opener; open();
      if (!request && opener.dataset.versoPrompt) input.value = opener.dataset.versoPrompt;
      input.focus({ preventScroll: true });
    } else if (target && !dock!.contains(target)) close();
  }, eventOptions);
  dispose = () => { request?.abort(); listeners.abort(); };
}
