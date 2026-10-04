import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ANSWER_SENTENCES, expectNoStrayRequests, mockNetwork, type ChatMock, type Network } from './network';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Every announcement either live region received, in order, even after it was pruned. */
const RECORD_ANNOUNCEMENTS = () => {
  const said: { polite: string[]; assertive: string[] } = { polite: [], assertive: [] };
  (window as unknown as { __said: typeof said }).__said = said;
  new MutationObserver(records => {
    for (const record of records) {
      record.addedNodes.forEach(node => {
        const region = (record.target as Element).closest?.('[data-announcer]') as HTMLElement | null;
        if (region && node instanceof HTMLElement && node.tagName === 'P') {
          said[region.dataset.announcer as 'polite' | 'assertive'].push(node.textContent ?? '');
        }
      });
    }
  }).observe(document, { childList: true, subtree: true });
};

/**
 * A /api/chat whose body the test feeds by hand, so an answer can be caught
 * half way. It replaces fetch in the page for that one URL and nothing else, so
 * no request is made for it at all.
 */
const HAND_FED_CHAT = () => {
  const real = window.fetch.bind(window);
  const encoder = new TextEncoder();
  const chat: { push?: (event: object) => void; close?: () => void } = {};
  (window as unknown as { __chat: typeof chat }).__chat = chat;
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes('/api/chat')) return real(input, init);
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start: c => { controller = c; } });
    chat.push = event => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    chat.close = () => controller.close();
    return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
  };
};

const said = (page: Page, kind: 'polite' | 'assertive' = 'polite') =>
  page.evaluate(k => (window as unknown as { __said: Record<string, string[]> }).__said[k], kind);

async function start(page: Page, { chat, handFed = false, scheme }: { chat?: () => ChatMock; handFed?: boolean; scheme?: 'light' | 'dark' } = {}): Promise<Network> {
  const net = await mockNetwork(page, chat);
  await page.addInitScript(RECORD_ANNOUNCEMENTS);
  if (handFed) await page.addInitScript(HAND_FED_CHAT);
  await page.emulateMedia({ colorScheme: scheme ?? 'light', reducedMotion: 'reduce' });
  await page.goto('/home');
  // The dock has wired itself up once its announcers exist.
  await page.locator('[data-announcer="polite"]').waitFor({ state: 'attached' });
  return net;
}

async function expectNoViolations(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(violations.map(v => `${v.id} (${v.impact}): ${v.help}\n${v.nodes.map(n => `  ${n.target.join(' ')}`).join('\n')}`)).toEqual([]);
}

const launcher = (page: Page) => page.locator('.home-verso-button');
const input = (page: Page) => page.locator('#chat-q');
async function openDock(page: Page): Promise<void> {
  await launcher(page).click();
  await expect(page.locator('#chat-dock')).toHaveClass(/open/);
  await expect(page.locator('#dock-panel')).not.toHaveAttribute('inert', /.*/);
}
async function ask(page: Page, question = 'What has Jody built?'): Promise<void> {
  await input(page).fill(question);
  await input(page).press('Enter');
}

test.describe('axe', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`home, dock closed (${scheme})`, async ({ page }) => {
      const net = await start(page, { scheme });
      await expectNoViolations(page);
      expectNoStrayRequests(net);
    });
  }

  test('dock open', async ({ page }) => {
    const net = await start(page);
    await openDock(page);
    await expectNoViolations(page);
    expectNoStrayRequests(net);
  });

  test('dock open (dark)', async ({ page }) => {
    const net = await start(page, { scheme: 'dark' });
    await openDock(page);
    await expectNoViolations(page);
    expectNoStrayRequests(net);
  });

  test('mid-answer', async ({ page }) => {
    const net = await start(page, { handFed: true });
    await openDock(page);
    await ask(page);
    await expect(page.locator('#conversation .thinking')).toBeVisible();
    await page.evaluate(() => (window as any).__chat.push({ cid: 'e2e', mid: 'm1' }));
    await page.evaluate(() => (window as any).__chat.push({ text: 'Jody builds products. He ships them' }));
    await expect(page.locator('#conversation .answer')).toContainText('He ships them');
    await expectNoViolations(page);
    await page.evaluate(() => (window as any).__chat.push({ text: ' too.', }));
    await page.evaluate(() => { (window as any).__chat.push({ done: true }); });
    await expect(input(page)).toHaveAttribute('aria-disabled', 'false');
    expectNoStrayRequests(net);
  });

  test('after an error', async ({ page }) => {
    const net = await start(page, { chat: () => ({ kind: 'error', status: 500, body: 'boom' }) });
    await openDock(page);
    await ask(page);
    await expect(page.locator('.dock-retry')).toBeVisible();
    await expectNoViolations(page);
    expectNoStrayRequests(net);
  });
});

test.describe('keyboard and screen reader', () => {
  test('Tab reaches the input, Enter sends, focus stays in the input and each sentence is announced once', async ({ page }) => {
    const net = await start(page);
    // From the top of the page, Tab gets to the composer.
    let reached = false;
    for (let i = 0; i < 60 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => document.activeElement?.id === 'chat-q');
    }
    expect(reached, 'the text input is reachable with Tab').toBe(true);
    await expect(page.locator('#chat-dock')).toHaveClass(/open/);

    await page.keyboard.type('What has Jody built?');
    await page.keyboard.press('Enter');
    await expect(page.locator('#conversation .turn.site .answer')).toContainText('Ask about a case study.');
    await expect(input(page)).toHaveAttribute('aria-disabled', 'false');
    await expect(input(page)).toBeFocused();
    expect(net.chatRequests).toEqual([expect.objectContaining({ query: 'What has Jody built?' })]);

    // The log is not live; the announcer got "thinking", then each sentence exactly once.
    await expect(page.locator('#conversation')).toHaveAttribute('aria-live', 'off');
    await expect(page.locator('#conversation')).toHaveAttribute('role', 'log');
    await expect(page.locator('.thinking [aria-live], .thinking[aria-live]')).toHaveCount(0);
    expect(await said(page)).toEqual(['Verso is thinking.', ...ANSWER_SENTENCES]);
    expectNoStrayRequests(net);
  });

  test('typing is blocked by aria-disabled, not by a disabled input, while an answer streams', async ({ page }) => {
    const net = await start(page, { handFed: true });
    await openDock(page);
    await ask(page);
    await expect(input(page)).toHaveAttribute('aria-disabled', 'true');
    expect(await input(page).evaluate((el: HTMLInputElement) => el.disabled)).toBe(false);
    await expect(input(page)).toBeFocused();
    await page.evaluate(() => { (window as any).__chat.push({ text: 'Done. ' }); (window as any).__chat.push({ done: true }); });
    await expect(input(page)).toHaveAttribute('aria-disabled', 'false');
    await expect(input(page)).toBeFocused();
    expectNoStrayRequests(net);
  });

  test('the controls are named by what they show', async ({ page }) => {
    const net = await start(page);
    await expect(input(page)).not.toHaveAttribute('aria-expanded', /.*/);
    await expect(input(page)).not.toHaveAttribute('aria-controls', /.*/);
    const submit = page.locator('#chat-form button[type="submit"]');
    await expect(submit).toHaveAccessibleName('Ask');
    await expect(page.locator('#dock-voice')).toHaveAccessibleName('Talk to Verso');
    await page.setViewportSize({ width: 390, height: 800 });
    await expect(submit).toHaveAccessibleName('Ask');
    expectNoStrayRequests(net);
  });

  test('Escape closes the dock and focus returns to the launcher, never the body', async ({ page }) => {
    const net = await start(page);
    await launcher(page).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#chat-dock')).toHaveClass(/open/);
    await expect(input(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#chat-dock')).not.toHaveClass(/open/);
    await expect(launcher(page)).toBeFocused();
    expectNoStrayRequests(net);
  });

  test('Escape with no launcher involved puts focus on the input, without reopening', async ({ page }) => {
    const net = await start(page);
    await input(page).focus();
    await expect(page.locator('#chat-dock')).toHaveClass(/open/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#chat-dock')).not.toHaveClass(/open/);
    await expect(input(page)).toBeFocused();
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
    expectNoStrayRequests(net);
  });

  test('an error announces once and moves focus to the retry button', async ({ page }) => {
    let mock: ChatMock = { kind: 'error', status: 500, body: 'boom' };
    const net = await start(page, { chat: () => mock });
    await openDock(page);
    await ask(page);
    await expect(page.locator('.dock-retry')).toBeFocused();
    expect(await said(page, 'assertive')).toEqual(['Chat is temporarily unavailable. Please try again.']);
    // Retrying works and keeps focus in the dock.
    mock = { kind: 'answer', frames: [{ text: 'Back again. ' }, { done: true }] };
    await page.keyboard.press('Enter');
    await expect(page.locator('#conversation .answer')).toContainText('Back again.');
    await expect(input(page)).toBeFocused();
    expectNoStrayRequests(net);
  });

  test('the dock refuses a typed question while voice is on', async ({ page }) => {
    const net = await start(page);
    await openDock(page);
    await page.locator('#dock-voice').click();
    await expect(page.locator('#dock-voice')).toHaveAttribute('data-state', 'live');
    await expect(input(page)).toHaveAttribute('aria-disabled', 'true');
    await input(page).focus();
    await page.keyboard.press('Enter');
    await page.evaluate(() => document.querySelector<HTMLFormElement>('#chat-form')!.requestSubmit());
    expect(net.chatRequests).toEqual([]);
    expectNoStrayRequests(net);
  });
});

test.describe('voice', () => {
  test('the mic announces on and off, and the limit warnings are spoken at one minute and 15 seconds', async ({ page }) => {
    await page.clock.install();
    const net = await start(page);
    await openDock(page);
    const mic = page.locator('#dock-voice');
    await mic.click();
    await expect(mic).toHaveAttribute('aria-pressed', 'true');
    await expect(mic).toHaveAccessibleName('Talk to Verso');
    await expect(mic).toHaveAttribute('data-state', 'live');
    await expect.poll(() => said(page)).toContain('Microphone on. Go ahead and talk.');
    // The ticking countdown is not read out.
    await expect(page.locator('#dock-voice-status')).toHaveAttribute('aria-hidden', 'true');

    await page.clock.runFor(239_000);
    expect(await said(page)).not.toContain('One minute of voice time left.');
    await page.clock.runFor(1_000);
    expect(await said(page)).toContain('One minute of voice time left.');
    await page.clock.runFor(45_000);
    expect(await said(page)).toContain('15 seconds of voice time left.');
    await page.clock.runFor(15_000);
    await expect(mic).toHaveAttribute('aria-pressed', 'false');
    const log = await said(page);
    expect(log.filter(line => line === 'Voice sessions end after five minutes. Tap the mic to start another.')).toHaveLength(1);
    expect(log).toContain('Microphone off.');
    expect(log.filter(line => line.endsWith('voice time left.'))).toEqual(['One minute of voice time left.', '15 seconds of voice time left.']);
    expectNoStrayRequests(net);
  });
});
