import { requestChat } from './chat-stream';
import { navigate } from 'astro:transitions/client';
import { renderCard } from './card-render';
import { track } from './track';
import { renderAnswer } from './verso-links';
import { canAsk, voiceActive as isVoiceActive, createAnnouncer, createStreamAnnouncer, scheduleTimeWarnings, voiceTimeWarning } from './a11y';

type VoiceModule = typeof import('./live/voice') & typeof import('./live/voice-dock');
let voiceModule: Promise<VoiceModule> | null = null;
/** Voice code loads when the browser is idle, not on the first tap: iOS only
 *  lets audio start inside the tap handler itself, so it must already be here. */
function loadVoice(): Promise<VoiceModule> {
  voiceModule ??= Promise.all([import('./live/voice'), import('./live/voice-dock')]).then(([a, b]) => ({ ...a, ...b }));
  voiceModule.catch(() => { voiceModule = null; });
  return voiceModule;
}

interface Reply { t: string; ts: number; q?: string }
const ASKED_KEY = 'verso:asked';
const REPLY_SEEN_KEY = 'verso:reply-seen';
const FAST_POLL_MS = 15_000;
/** While Jody is live in the conversation, his next message should land within seconds. */
const LIVE_POLL_MS = 3_000;
const FAST_POLL_FOR_MS = 2 * 60_000;
const SLOW_POLL_MS = 60_000;
const REPLY_WINDOW_MS = 30 * 60_000;

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
  // Visually hidden live regions. The conversation log itself is aria-live="off",
  // so a growing answer is never re-read; what is spoken comes through these.
  const polite = createAnnouncer(dock, { politeness: 'polite' });
  const assertive = createAnnouncer(dock, { politeness: 'assertive' });
  /** Set while focus is put back by script, so focusing the collapsed composer does not reopen it. */
  let restoringFocus = false;

  function sync(): void {
    const open = dock!.classList.contains('open');
    panel.inert = !open;
    document.querySelectorAll('[data-verso-open]').forEach(el => el.setAttribute('aria-expanded', String(open)));
  }
  /** `trigger` says what opened it, for analytics: the bar, a prompt button, or a reply arriving. */
  function open(trigger = 'bar'): void {
    if (!dock!.classList.contains('open')) track('chat_open', { trigger });
    dock!.classList.add('open'); sync();
  }
  function close(restoreFocus = false): void {
    dock!.classList.remove('open');
    sync();
    if (!restoreFocus) { input.blur(); return; }
    // Focus goes back to what opened the dock, or to the composer when nothing did; never to the page body.
    const target = trigger?.isConnected && !dock!.contains(trigger) ? trigger : input;
    restoringFocus = true;
    try { target.focus({ preventScroll: true }); } finally { restoringFocus = false; }
  }
  /** The close button and Escape: always hand focus back, so a keyboard user is not dropped on the body. */
  function closeFromKeyboardOrButton(): void {
    if (!dock!.classList.contains('open')) return;
    const active = document.activeElement;
    // Only take focus back when it was in the dock (or nowhere); Escape pressed elsewhere leaves it alone.
    close(!active || active === document.body || dock!.contains(active));
  }

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

  const placeholder = input.placeholder;
  const readCid = () => { try { return sessionStorage.getItem('verso:cid') || undefined; } catch { return undefined; } };
  const readNumber = (key: string) => { try { return Number(sessionStorage.getItem(key)) || 0; } catch { return 0; } };
  const writeNumber = (key: string, value: number) => { try { sessionStorage.setItem(key, String(value)); } catch { /* Optional. */ } };

  function appendTemplate(id: string, parent = conversation): HTMLElement {
    const template = dock!.querySelector<HTMLTemplateElement>(id)!;
    const node = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
    parent.append(node);
    return node;
  }
  const scrollToAnswer = () => { scroll.scrollTop = scroll.scrollHeight; };
  /**
   * The composer stays focusable while it is unavailable: aria-disabled plus a
   * blocked submit, never `disabled`, which would drop keyboard focus out of the
   * dock. read-only keeps typed text from piling up that could not be sent.
   */
  function lockInput(locked: boolean): void {
    input.setAttribute('aria-disabled', String(locked));
    input.readOnly = locked;
  }
  function busy(value: boolean): void {
    lockInput(value || voiceActive());
    newChat.disabled = value;
    // A typed answer and a voice session never run at once: ask() and the mic
    // click both refuse, and aria-disabled says so.
    voiceButton.setAttribute('aria-disabled', String(value || waiting !== null));
    submitLabel.textContent = value ? 'Stop' : 'Ask';
    submit.classList.toggle('is-busy', value);
  }
  function renderText(target: HTMLElement, text: string, links: ReadonlySet<string> | null = null): void {
    target.innerHTML = renderAnswer(text, links);
  }

  /*
   * Jody can answer a question from Telegram after Verso has. His reply lands
   * in the conversation on the server, and the dock looks for it: often right
   * after a question, less often as it ages, never once the tab is hidden or
   * half an hour has passed. The last question's time is kept in the session
   * so a reload keeps looking, and the newest reply shown so it is not shown
   * twice.
   */
  let pollTimer = 0;
  /** When Jody's window in this conversation ends; 0 when he is not in it. */
  let liveUntil = 0;
  let liveTimer = 0;
  let checking: Promise<number> | null = null;
  /** Shows new replies and returns how many there were. Calls overlap, so they share one request. */
  function checkReplies(): Promise<number> {
    checking ??= fetchReplies().finally(() => { checking = null; });
    return checking;
  }
  async function fetchReplies(): Promise<number> {
    const cid = readCid();
    if (!cid || document.hidden) return 0;
    let replies: unknown;
    let live: unknown;
    try {
      const res = await fetch(`/api/replies?cid=${encodeURIComponent(cid)}`, { signal: listeners.signal });
      if (!res.ok) return 0;
      ({ replies, liveUntil: live } = await res.json() as { replies?: unknown; liveUntil?: unknown });
    } catch { return 0; }
    // A new chat may have started while this was in flight.
    if (readCid() !== cid || !Array.isArray(replies)) return 0;
    const seen = readNumber(REPLY_SEEN_KEY);
    const fresh = (replies as Reply[]).filter(reply => typeof reply?.t === 'string' && typeof reply.ts === 'number' && reply.ts > seen);
    showLive(typeof live === 'number' ? live : 0, fresh.length > 0);
    if (!fresh.length) return 0;
    open('reply'); empty.hidden = true;
    track('chat_reply_seen', { count: fresh.length });
    for (const reply of fresh) {
      const turn = appendTemplate('#tpl-jody');
      const replyTo = turn.querySelector<HTMLElement>('.reply-to')!;
      if (reply.q) replyTo.textContent = `Replying to "${reply.q.length > 90 ? `${reply.q.slice(0, 89)}…` : reply.q}"`;
      else replyTo.remove();
      renderText(turn.querySelector<HTMLElement>('.reply-body')!, reply.t);
      polite.announce('Jody replied.');
      createStreamAnnouncer(line => polite.announce(line)).end(reply.t);
    }
    writeNumber(REPLY_SEEN_KEY, Math.max(...fresh.map(reply => reply.ts)));
    // The note belongs under his newest reply.
    const note = conversation.querySelector('.dock-live');
    if (note) conversation.append(note);
    scrollToAnswer();
    return fresh.length;
  }
  /**
   * While Jody is live, a note under his reply says so and Verso holds the next
   * question for him. The note goes when his window does. A question held for
   * him has its own waiting state, so the note steps aside for that.
   */
  function showLive(until: number, replied: boolean): void {
    liveUntil = until > Date.now() ? until : 0;
    clearTimeout(liveTimer);
    let note = conversation.querySelector<HTMLElement>('.dock-live');
    if (!liveUntil || waiting) { note?.remove(); return; }
    if (!note && !replied && !conversation.querySelector('.turn.jody')) return;
    note ??= appendTemplate('#tpl-live');
    const minutes = Math.max(1, Math.round((liveUntil - Date.now()) / 60_000));
    const message = `Jody is here and may reply. Verso will pick up in ${minutes} min if he doesn't.`;
    if (note.textContent !== message) note.textContent = message;
    liveTimer = window.setTimeout(() => showLive(0, false), liveUntil - Date.now());
    pollReplies();
  }
  function pollReplies(): void {
    clearTimeout(pollTimer);
    const since = Date.now() - readNumber(ASKED_KEY);
    const live = liveUntil > Date.now();
    if (!readCid() || (since > REPLY_WINDOW_MS && !live)) return;
    pollTimer = window.setTimeout(() => { void checkReplies().finally(pollReplies); },
      live ? LIVE_POLL_MS : since < FAST_POLL_FOR_MS ? FAST_POLL_MS : SLOW_POLL_MS);
  }

  /*
   * A question asked while Jody is live is held for him. The Verso turn shows
   * that it is waiting on him, with the time left and a way to ask Verso now.
   * It resolves when his reply arrives, the time runs out, the visitor skips
   * the wait, or the conversation is cleared.
   */
  let waiting: ((how: 'cancel') => void) | null = null;
  function waitForJody(turn: HTMLElement, until: number): Promise<'reply' | 'timeout' | 'skip' | 'cancel'> {
    conversation.querySelector('.dock-live')?.remove();
    const answer = turn.querySelector<HTMLElement>('.answer')!;
    answer.replaceChildren();
    const box = appendTemplate('#tpl-wait', answer);
    const line = box.querySelector<HTMLElement>('.dock-wait-text')!;
    lockInput(true); input.placeholder = 'Waiting for Jody…';
    voiceButton.setAttribute('aria-disabled', 'true');
    // The countdown ticks every second for the eyes; a screen reader hears it once.
    line.setAttribute('aria-hidden', 'true');
    polite.announce(`Jody is here and may reply. Verso answers in ${Math.max(1, Math.round((until - Date.now()) / 60_000))} min if he does not.`);
    scrollToAnswer();
    return new Promise(resolve => {
      let tick = 0;
      let poll = 0;
      const finish = (how: 'reply' | 'timeout' | 'skip' | 'cancel') => {
        if (!waiting) return;
        waiting = null;
        clearInterval(tick); clearInterval(poll);
        lockInput(voiceActive()); input.placeholder = voiceActive() ? 'Voice is on' : placeholder;
        voiceButton.setAttribute('aria-disabled', 'false');
        track('chat_wait', { result: how });
        resolve(how);
      };
      waiting = finish;
      const paint = () => {
        const left = Math.max(0, until - Date.now());
        if (!left) { finish('timeout'); return; }
        const clock = `${Math.floor(left / 60_000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
        line.textContent = `Jody is here and will likely reply. If he doesn't, Verso answers in ${clock}.`;
      };
      paint();
      tick = window.setInterval(paint, 1000);
      poll = window.setInterval(() => { void checkReplies().then(count => { if (count) finish('reply'); }); }, LIVE_POLL_MS);
      box.querySelector('button')!.addEventListener('click', () => finish('skip'), eventOptions);
    });
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void checkReplies(); }, eventOptions);
  void checkReplies();
  pollReplies();

  /** The prompt a suggestion button put in the field, so a question sent unedited counts as that suggestion. */
  let suggested: string | null = null;
  async function ask(query: string, retryTurn?: HTMLElement, fallback = false): Promise<void> {
    query = query.trim();
    // A typed answer and a voice session never run at once. The input used to be
    // `disabled` while voice was on, which was the only thing keeping them apart;
    // it stays focusable now, so this refusal is the guard.
    if (!query || !canAsk({ requesting: request !== null, waiting: waiting !== null, voiceStarting, voice: voiceSnapshot() })) return;
    const source = fallback ? 'fallback' : retryTurn ? 'retry' : query === suggested ? 'suggestion' : 'typed';
    suggested = null;
    let topic: string | undefined;
    let outcome = 'done';
    request = new AbortController();
    busy(true); open(); empty.hidden = true;
    if (!retryTurn) appendTemplate('#tpl-you').querySelector<HTMLElement>('.said')!.textContent = query;
    const turn = retryTurn ?? appendTemplate('#tpl-site');
    if (retryTurn) {
      // Replacing the turn removes the retry button; keep focus in the dock.
      const hadFocus = dock!.contains(document.activeElement);
      const template = dock!.querySelector<HTMLTemplateElement>('#tpl-site')!;
      turn.querySelector('.said')!.replaceChildren(template.content.querySelector('.answer')!.cloneNode(true));
      if (hadFocus) input.focus({ preventScroll: true });
    }
    const answer = turn.querySelector<HTMLElement>('.answer')!;
    const said = turn.querySelector<HTMLElement>('.said')!;
    const waited = turn.querySelector<HTMLElement>('.waited')!;
    input.value = ''; scrollToAnswer();
    let text = '';
    let links: string[] = [];
    let destination: string | null = null;
    let holdUntil = 0;
    const stream = createStreamAnnouncer(line => polite.announce(line));
    polite.announce('Verso is thinking.');
    const timer = setTimeout(() => { if (waited) waited.hidden = false; polite.announce('Taking a little longer…'); }, 12_000);
    try {
      await requestChat({ query, cid: readCid(), page: location.pathname, ...(fallback ? { fallback } : {}) }, {
        signal: request.signal,
        onEvent(event) {
          if (typeof event.cid === 'string') { try { sessionStorage.setItem('verso:cid', event.cid); } catch { /* Optional. */ } }
          if (typeof event.mid === 'string') turn.dataset.mid = event.mid;
          if (typeof event.text === 'string' && event.text) {
            clearTimeout(timer); text += event.text; renderText(answer, text); stream.update(text); scrollToAnswer();
          }
          if (event.card?.kind === 'navigate') destination = event.card.url;
          if (event.card) {
            // In order of arrival: ahead of the prose if it has not started, after it otherwise.
            const card = renderCard(dock!, event.card);
            if (card) { if (text) said.append(card); else answer.before(card); scrollToAnswer(); }
          }
          if (Array.isArray(event.links)) links = event.links.filter(link => typeof link === 'string');
          if (typeof event.topic === 'string') topic = event.topic;
          if (typeof event.hold?.until === 'number') holdUntil = event.hold.until;
        },
      });
      if (holdUntil) outcome = 'held';
      else if (!text.trim()) throw new Error('Nothing came back. Please try again.');
      stream.end(text);
      // Links are drawn once the route has confirmed each one is a real page.
      if (links.length) renderText(answer, text, new Set(links));
      writeNumber(ASKED_KEY, Date.now()); pollReplies();
      // Leave only once the answer has landed, so it is there to come back to.
      if (destination) void navigate(destination);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      outcome = request?.signal.aborted ? 'stopped' : message.startsWith('That took too long') ? 'timeout' : 'error';
      if (!text) answer.replaceChildren();
      const recovery = appendTemplate('#tpl-retry', said);
      const failure = error instanceof Error ? error.message : 'Connection lost. Please try again.';
      recovery.querySelector<HTMLElement>('.dock-error')!.textContent = failure;
      assertive.announce(failure);
      const retry = recovery.querySelector<HTMLButtonElement>('button')!;
      retry.addEventListener('click', () => { void ask(query, turn); }, eventOptions);
      // Keyboard and screen reader users land on the way forward, unless they have moved on.
      const active = document.activeElement;
      if (!active || active === document.body || dock!.contains(active)) retry.focus({ preventScroll: true });
    } finally {
      clearTimeout(timer); request = null; busy(false); scrollToAnswer();
      track('chat_question', { source, outcome, topic, turn: conversation.querySelectorAll('.turn.you').length });
    }
    if (!holdUntil) return;
    const how = await waitForJody(turn, holdUntil);
    // His reply is already on screen below this turn, which has nothing left to say.
    if (how === 'reply') turn.remove();
    else if (how !== 'cancel') await ask(query, turn, true);
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (request) { request.abort(); return; }
    if (voiceActive()) { polite.announce('Voice is on. Turn it off to type a question.'); return; }
    void ask(input.value);
  }, eventOptions);
  input.addEventListener('focus', () => { if (restoringFocus) return; trigger = null; open(); }, eventOptions);
  dock.querySelector('#dock-close')!.addEventListener('click', closeFromKeyboardOrButton, eventOptions);
  newChat.addEventListener('click', () => {
    if (request) return;
    waiting?.('cancel'); showLive(0, false);
    try { for (const key of ['verso:cid', ASKED_KEY, REPLY_SEEN_KEY]) sessionStorage.removeItem(key); } catch { /* Optional. */ }
    clearTimeout(pollTimer);
    if (voice) { voice.stopVoice(); renderer?.reset(voice.voiceSession().getSnapshot().messages); status(null); }
    conversation.replaceChildren(); empty.hidden = false; input.value = ''; input.focus({ preventScroll: true });
    track('chat_new');
  }, eventOptions);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeFromKeyboardOrButton(); }, eventOptions);
  // A click target removed by its own handler (the retry button) is not an outside click, hence isConnected.
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    const opener = target?.closest<HTMLElement>('[data-verso-open]');
    if (opener) {
      const prompt = opener.dataset.versoPrompt;
      open(prompt ? 'suggestion' : 'button');
      if (!request && prompt) { input.value = prompt; suggested = prompt; }
      input.focus({ preventScroll: true });
      trigger = opener; // after focus(), which clears it
    } else if (target?.isConnected && !dock!.contains(target)) close();
  }, eventOptions);

  // Which of what Verso put on screen people follow: cards, case study parts, links in the answer.
  // Following one collapses the chat so the page it opens is what the reader sees; the
  // conversation stays in the dock for when they come back.
  conversation.addEventListener('click', event => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!link || link.origin !== location.origin) return;
    const kind = link.className.match(/\bvcard-(\w+)/)?.[1] ?? (link.closest('.answer') ? 'inline' : 'link');
    track('card_click', { kind, path: link.pathname });
    close();
  }, eventOptions);

  const voiceButton = dock.querySelector<HTMLButtonElement>('#dock-voice')!;
  const voiceStatus = dock.querySelector<HTMLElement>('#dock-voice-status')!;
  let voice: VoiceModule | null = null;
  let unsubscribe = () => {};
  let countdown = 0;
  let renderer: ReturnType<VoiceModule['createVoiceRenderer']> | null = null;
  let voiceStarted = 0;
  /** The mic was tapped and the session has not reported connecting yet. */
  let voiceStarting = false;
  let micOn = false;
  let cancelWarnings = () => {};
  let warningsFor = 0;
  const voiceSnapshot = () => voice?.voiceSession().getSnapshot() ?? null;
  const voiceActive = () => isVoiceActive({ voiceStarting, voice: voiceSnapshot() });
  /**
   * The line above the composer. It is not a live region: the countdown
   * rewrites it every second, and a screen reader hears one-off notes through
   * the announcers instead (`speak`), only when the text actually changes.
   */
  function status(text: string | null, tone: 'live' | 'note' = 'note', speak: 'polite' | 'assertive' | null = null): void {
    const changed = (text ?? '') !== voiceStatus.textContent;
    voiceStatus.hidden = !text; voiceStatus.textContent = text ?? ''; voiceStatus.dataset.tone = tone;
    // The ticking countdown is for the eyes; spoken warnings come from scheduleTimeWarnings.
    if (tone === 'live') voiceStatus.setAttribute('aria-hidden', 'true'); else voiceStatus.removeAttribute('aria-hidden');
    if (text && speak && changed) (speak === 'assertive' ? assertive : polite).announce(text);
  }
  function paintVoice(): void {
    if (!voice) return;
    const snapshot = voice.voiceSession().getSnapshot();
    const connecting = snapshot.connectionStatus === 'connecting';
    const live = snapshot.isConnected;
    if (live && !voiceStarted) { voiceStarted = Date.now(); track('voice_start'); }
    if (!live && !connecting && voiceStarted) {
      track('voice_end', { seconds: Math.round((Date.now() - voiceStarted) / 1000), reason: snapshot.endReason ?? 'user' });
      voiceStarted = 0;
    }
    voiceButton.dataset.state = connecting ? 'connecting' : live ? 'live' : 'idle';
    voiceButton.setAttribute('aria-pressed', String(live || connecting));
    // The label stays "Talk to Verso"; aria-pressed carries on and off.
    if (live || connecting) voiceStarting = false;
    // One conversation at a time: typing waits while Verso is listening.
    lockInput(live || connecting || Boolean(request) || waiting !== null);
    input.placeholder = live || connecting ? 'Voice is on' : waiting ? 'Waiting for Jody…' : placeholder;
    const streaming = live && snapshot.media.audio.isStreaming;
    if (streaming !== micOn) { micOn = streaming; polite.announce(streaming ? 'Microphone on. Go ahead and talk.' : 'Microphone off.'); }
    // Spoken warnings before the limit, from the session's own deadline.
    if (live && snapshot.endsAt) {
      if (warningsFor !== snapshot.endsAt) {
        cancelWarnings(); warningsFor = snapshot.endsAt;
        cancelWarnings = scheduleTimeWarnings(snapshot.endsAt, left => polite.announce(voiceTimeWarning(left)));
      }
    } else { cancelWarnings(); warningsFor = 0; }
    clearInterval(countdown);
    if (connecting) status('Connecting…', 'note', 'polite');
    else if (live && snapshot.media.audio.isStreaming) {
      const tick = () => {
        const left = Math.max(0, (snapshot.endsAt ?? Date.now()) - Date.now());
        const clock = `${Math.floor(left / 60_000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
        status(snapshot.endsAt ? `Listening · ${clock} left` : 'Listening', 'live');
      };
      tick(); countdown = window.setInterval(tick, 1000);
    } else if (!live) {
      const ended = voice.endedMessage(snapshot.endReason);
      if (ended || voiceStatus.dataset.tone === 'live') status(ended, 'note', 'polite');
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
    micOn = session.getSnapshot().media.audio.isStreaming;
    // A session carried across navigation keeps its transcript on screen already.
    renderer.reset(session.getSnapshot().messages);
    unsubscribe = session.subscribe(paintVoice);
    paintVoice();
  }
  const idle = window.requestIdleCallback ?? ((run: () => void) => window.setTimeout(run, 1200));
  idle(() => { void loadVoice().then(attachVoice).catch(() => {}); });
  voiceButton.addEventListener('click', () => {
    if (voice && voiceButton.getAttribute('aria-pressed') === 'true') { voice.stopVoice(); status(null); return; }
    // aria-disabled does not block clicks: a question in flight or held for Jody keeps the mic off.
    if (request || waiting || voiceStarting) return;
    voiceStarting = true;
    open(); status('Connecting…', 'note', 'polite');
    const start = (module: VoiceModule) => {
      attachVoice(module);
      module.startVoice().catch(error => { module.stopVoice(); status(module.voiceErrorMessage(error), 'note', 'assertive'); }).finally(() => { voiceStarting = false; paintVoice(); });
    };
    // Already loaded: start inside this tap so iOS lets audio play.
    if (voice) start(voice);
    else void loadVoice().then(start).catch(() => { voiceStarting = false; status('Voice could not load. You can keep typing.', 'note', 'assertive'); });
  }, eventOptions);

  dispose = () => { request?.abort(); waiting?.('cancel'); listeners.abort(); unsubscribe(); clearInterval(countdown); cancelWarnings(); polite.destroy(); assertive.destroy(); clearTimeout(pollTimer); clearTimeout(liveTimer); };
}
