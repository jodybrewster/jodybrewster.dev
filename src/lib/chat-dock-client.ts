import { requestChat, type ChatSource } from './chat-stream';
import { navigate } from 'astro:transitions/client';
import { renderCard } from './card-render';

type VoiceModule = typeof import('./live/voice') & typeof import('./live/voice-dock');
let voiceModule: Promise<VoiceModule> | null = null;
/** Voice code loads when the browser is idle, not on the first tap: iOS only
 *  lets audio start inside the tap handler itself, so it must already be here. */
function loadVoice(): Promise<VoiceModule> {
  voiceModule ??= Promise.all([import('./live/voice'), import('./live/voice-dock')]).then(([a, b]) => ({ ...a, ...b }));
  voiceModule.catch(() => { voiceModule = null; });
  return voiceModule;
}

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
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const submitLabel = submit.querySelector<HTMLElement>('.submit-label')!;
  const panel = dock.querySelector<HTMLElement>('#dock-panel')!;
  const conversation = dock.querySelector<HTMLElement>('#conversation')!;
  const empty = dock.querySelector<HTMLElement>('#dock-empty')!;
  const scroll = dock.querySelector<HTMLElement>('#dock-scroll')!;
  const newChat = dock.querySelector<HTMLButtonElement>('#dock-new')!;
  let request: AbortController | null = null;
  let trigger: HTMLElement | null = null;

  function sync(): void {
    const open = dock!.classList.contains('open');
    panel.inert = !open;
    input.setAttribute('aria-expanded', String(open));
    document.querySelectorAll('[data-verso-open]').forEach(el => el.setAttribute('aria-expanded', String(open)));
  }
  function open(): void { dock!.classList.add('open'); sync(); }
  function close(restoreFocus = false): void {
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
    sync(); sizeToKeyboard();
  };
  syncMode();
  window.visualViewport?.addEventListener('resize', sizeToKeyboard, eventOptions);
  window.visualViewport?.addEventListener('scroll', sizeToKeyboard, eventOptions);

  const readCid = () => { try { return sessionStorage.getItem('verso:cid') || undefined; } catch { return undefined; } };

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
    // A typed answer and a voice session never run at once.
    dock!.querySelector<HTMLButtonElement>('#dock-voice')!.disabled = value;
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
    let destination: string | null = null;
    const timer = setTimeout(() => { if (waited) waited.hidden = false; }, 12_000);
    try {
      await requestChat({ query, cid: readCid() }, {
        signal: request.signal,
        onEvent(event) {
          if (typeof event.cid === 'string') { try { sessionStorage.setItem('verso:cid', event.cid); } catch { /* Optional. */ } }
          if (typeof event.mid === 'string') turn.dataset.mid = event.mid;
          if (typeof event.text === 'string' && event.text) {
            clearTimeout(timer); text += event.text; renderText(answer, text); scrollToAnswer();
          }
          if (event.card?.kind === 'navigate') destination = event.card.url;
          if (event.card) {
            // In order of arrival: ahead of the prose if it has not started, after it otherwise.
            const card = renderCard(dock!, event.card);
            if (card) { if (text) said.append(card); else answer.before(card); scrollToAnswer(); }
          }
          if (Array.isArray(event.sources)) sources = event.sources;
        },
      });
      if (!text.trim()) throw new Error('Nothing came back. Please try again.');
      renderSources(said, sources);
      // Leave only once the answer has landed, so it is there to come back to.
      if (destination) void navigate(destination);
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
    if (request) { request.abort(); return; }
    void ask(input.value);
  }, eventOptions);
  input.addEventListener('focus', open, eventOptions);
  dock.querySelector('#dock-close')!.addEventListener('click', closeFromButton, eventOptions);
  newChat.addEventListener('click', () => {
    if (request) return;
    try { sessionStorage.removeItem('verso:cid'); } catch { /* Optional. */ }
    if (voice) { voice.stopVoice(); renderer?.reset(voice.voiceSession().getSnapshot().messages); status(null); }
    conversation.replaceChildren(); empty.hidden = false; input.value = ''; input.focus({ preventScroll: true });
  }, eventOptions);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeFromButton(); }, eventOptions);
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    const opener = target?.closest<HTMLElement>('[data-verso-open]');
    if (opener) {
      trigger = opener;
      const prompt = opener.dataset.versoPrompt;
      open();
      if (!request && prompt) input.value = prompt;
      input.focus({ preventScroll: true });
    } else if (target && !dock!.contains(target)) close();
  }, eventOptions);

  const voiceButton = dock.querySelector<HTMLButtonElement>('#dock-voice')!;
  const voiceStatus = dock.querySelector<HTMLElement>('#dock-voice-status')!;
  const placeholder = input.placeholder;
  let voice: VoiceModule | null = null;
  let unsubscribe = () => {};
  let countdown = 0;
  let renderer: ReturnType<VoiceModule['createVoiceRenderer']> | null = null;
  function status(text: string | null, tone: 'live' | 'note' = 'note'): void {
    voiceStatus.hidden = !text; voiceStatus.textContent = text ?? ''; voiceStatus.dataset.tone = tone;
  }
  function paintVoice(): void {
    if (!voice) return;
    const snapshot = voice.voiceSession().getSnapshot();
    const connecting = snapshot.connectionStatus === 'connecting';
    const live = snapshot.isConnected;
    voiceButton.dataset.state = connecting ? 'connecting' : live ? 'live' : 'idle';
    voiceButton.setAttribute('aria-pressed', String(live || connecting));
    voiceButton.setAttribute('aria-label', live || connecting ? 'End voice conversation' : 'Talk to Verso');
    // One conversation at a time: typing waits while Verso is listening.
    input.disabled = live || connecting || Boolean(request);
    input.placeholder = live || connecting ? 'Voice is on' : placeholder;
    clearInterval(countdown);
    if (connecting) status('Connecting…');
    else if (live && snapshot.media.audio.isStreaming) {
      const tick = () => {
        const left = Math.max(0, (snapshot.endsAt ?? Date.now()) - Date.now());
        const clock = `${Math.floor(left / 60_000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
        status(snapshot.endsAt ? `Listening · ${clock} left` : 'Listening', 'live');
      };
      tick(); countdown = window.setInterval(tick, 1000);
    } else if (!live) {
      const ended = voice.endedMessage(snapshot.endReason);
      if (ended || voiceStatus.dataset.tone === 'live') status(ended);
    }
    renderer?.update(snapshot.messages);
  }
  function attachVoice(module: VoiceModule): void {
    if (voice) return;
    voice = module;
    renderer = module.createVoiceRenderer({
      dock: dock!, conversation,
      appendTemplate: id => appendTemplate(id),
      beforeRender: () => { open(); empty.hidden = true; },
      navigate: url => { void navigate(url); },
      scroll: scrollToAnswer,
    });
    const session = module.voiceSession();
    // A session carried across navigation keeps its transcript on screen already.
    renderer.reset(session.getSnapshot().messages);
    unsubscribe = session.subscribe(paintVoice);
    paintVoice();
  }
  const idle = window.requestIdleCallback ?? ((run: () => void) => window.setTimeout(run, 1200));
  idle(() => { void loadVoice().then(attachVoice).catch(() => {}); });
  voiceButton.addEventListener('click', () => {
    if (voice && voiceButton.getAttribute('aria-pressed') === 'true') { voice.stopVoice(); status(null); return; }
    if (request) return;
    open(); status('Connecting…');
    const start = (module: VoiceModule) => {
      attachVoice(module);
      module.startVoice().catch(error => { module.stopVoice(); status(module.voiceErrorMessage(error)); });
    };
    // Already loaded: start inside this tap so iOS lets audio play.
    if (voice) start(voice);
    else void loadVoice().then(start).catch(() => status('Voice could not load. You can keep typing.'));
  }, eventOptions);

  dispose = () => { request?.abort(); listeners.abort(); unsubscribe(); clearInterval(countdown); };
}
