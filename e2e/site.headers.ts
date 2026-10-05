import { expect, test, type Page } from '@playwright/test';
import { mockNetwork, expectNoStrayRequests } from './network';
import { HEADERS_PORT } from '../playwright.headers.config';

/**
 * The security headers the site ships (M1 1.9, site step S6), on the built
 * site served as Vercel serves it: every page, the client router's soft
 * navigation, search (Pagefind's WebAssembly) and a mocked voice session
 * (same-origin audio worklets) must run with no policy violation, in
 * Chromium, WebKit and Firefox.
 */
const HOST = `localhost:${HEADERS_PORT}`;
// A production build includes the GA4 tag and the shelf's album covers; their requests are aborted, not counted.
const ANALYTICS = new Set(['www.googletagmanager.com', 'www.google-analytics.com', 'region1.google-analytics.com', 'region1.analytics.google.com', 'i.scdn.co']);

async function watchViolations(page: Page): Promise<() => Promise<string[]>> {
  const fromConsole: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error' && /Content.Security.Policy|Refused to/i.test(message.text())) fromConsole.push(message.text());
  });
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', e => w.__csp.push(`${e.effectiveDirective} blocked ${e.blockedURI || 'inline'}`));
  });
  return async () => [...fromConsole, ...(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp ?? []))];
}

test('every response carries the headers, with a policy that runs no injected script', async ({ request }) => {
  for (const path of ['/home', '/writing', '/privacy', '/worklets/playback.js', '/no-such-page']) {
    const response = await request.get(path, { maxRedirects: 0 });
    const h = response.headers();
    const policy = h['content-security-policy'] ?? '';
    expect(policy, path).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'none'");
    const script = policy.split('; ').find(d => d.startsWith('script-src ')) ?? '';
    expect(script).toMatch(/'sha256-/);
    expect(script).not.toMatch(/'unsafe-inline'|'unsafe-eval'|blob:|\*/);
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['strict-transport-security']).toBe('max-age=63072000; includeSubDomains');
    expect(h['permissions-policy']).toContain('microphone=(self)');
    expect(h['permissions-policy']).toContain('camera=()');
  }
});

test('pages and the client router run with no policy violations', async ({ page }) => {
  const net = await mockNetwork(page, undefined, HOST, ANALYTICS);
  const violations = await watchViolations(page);
  // Each a soft navigation by the client router, from the home page.
  for (const path of ['/writing', '/work', '/notes', '/about', '/privacy', '/library']) {
    await page.goto('/home');
    await expect(page.locator('.home-verso-button')).toBeVisible();
    await page.locator(`a[href="${path}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`${path}/?$`));
  }
  await page.goto('/library');
  await page.waitForLoadState('networkidle');
  expect(await violations()).toEqual([]);
  expectNoStrayRequests(net);
});

test('search runs Pagefind with no policy violations', async ({ page }) => {
  const net = await mockNetwork(page, undefined, HOST, ANALYTICS);
  const violations = await watchViolations(page);
  await page.goto('/search');
  const box = page.locator('#search input');
  await expect(box).toBeVisible();
  await box.fill('agent');
  await expect(page.locator('.pagefind-ui__result').first()).toBeVisible({ timeout: 15_000 });
  expect(await violations()).toEqual([]);
  expectNoStrayRequests(net);
});

test('the chat dock and a voice session run with no policy violations, worklets from this origin', async ({ page, request, browserName }) => {
  const net = await mockNetwork(page, undefined, HOST, ANALYTICS);
  const violations = await watchViolations(page);
  const served = async () => await (await request.get('/__served')).json() as string[];
  await page.goto('/home');
  await page.locator('.home-verso-button').click();
  await expect(page.locator('#chat-dock')).toHaveClass(/open/);
  await page.locator('#dock-voice').click();
  // The playback worklet loads on connect, from this origin: a blob: one would be refused.
  await expect.poll(served, { timeout: 15_000 }).toContain('/worklets/playback.js');
  // Headless WebKit cannot grant the microphone, so the session stops there;
  // where a fake microphone exists, it goes live and loads the capture worklet.
  if (browserName !== 'webkit') {
    await expect(page.locator('#dock-voice')).toHaveAttribute('data-state', 'live', { timeout: 15_000 });
    await expect.poll(() => net.liveSent.length).toBeGreaterThan(0);
    await expect.poll(served).toContain('/worklets/capture.js');
  }
  expect(await violations()).toEqual([]);
  expectNoStrayRequests(net);
});
