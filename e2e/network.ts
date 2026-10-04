import type { Page, Route } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Every network call in these specs is mocked in the browser, so a run never
 * reaches a model, Redis, Telegram or Google. Nothing here is a real service:
 *
 *  - /api/chat, /api/live-token, /api/replies and /api/corpus are answered by
 *    page.route and never reach the dev server;
 *  - the Gemini Live WebSocket is served by page.routeWebSocket;
 *  - Google Fonts get an empty stub, so the page renders with fallback fonts;
 *  - any other request to a host that is not the dev server is aborted, and
 *    recorded so the test fails (expectNoStrayRequests).
 */
export const DEV_HOST = 'localhost:4392';
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

export interface Network {
  /** Requests that tried to leave the dev server, or hit an /api route nothing mocked. */
  stray: string[];
  /** Bodies posted to the mocked /api/chat, parsed. */
  chatRequests: { query?: string }[];
  /** Messages the app sent over the mocked Live socket. */
  liveSent: Record<string, unknown>[];
}

export type ChatMock =
  | { kind: 'answer'; frames: object[] }
  | { kind: 'error'; status: number; body: string };

/** One SSE frame, in the format src/pages/api/chat.ts writes and src/lib/chat-stream.ts reads. */
export const frame = (event: object) => `data: ${JSON.stringify(event)}\n\n`;

export const ANSWER_FRAMES = [
  { cid: 'e2e-conversation', mid: 'e2e-message' },
  { text: 'Jody builds products end to end. ' },
  { text: 'He started with the problem, ' },
  { text: 'then shipped it. Ask about a case study.' },
  { done: true },
];
export const ANSWER_SENTENCES = ['Jody builds products end to end.', 'He started with the problem, then shipped it.', 'Ask about a case study.'];

export async function mockNetwork(
  page: Page,
  chat: () => ChatMock = () => ({ kind: 'answer', frames: ANSWER_FRAMES }),
  host = DEV_HOST,
  /** Hosts whose requests are aborted without counting as stray (analytics in a production build). */
  ignore: ReadonlySet<string> = new Set(),
): Promise<Network> {
  const net: Network = { stray: [], chatRequests: [], liveSent: [] };

  // Registered first, so it is consulted last: whatever no later route claims.
  await page.route('**/*', async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return route.fallback();
    if (FONT_HOSTS.has(url.hostname)) {
      return route.fulfill({ status: 200, contentType: url.hostname === 'fonts.googleapis.com' ? 'text/css' : 'font/woff2', body: '' });
    }
    if (ignore.has(url.hostname)) return route.abort();
    if (url.host !== host) {
      net.stray.push(`${route.request().method()} ${route.request().url()}`);
      return route.abort();
    }
    // The server's own routes are all mocked below; one that gets here would run real code.
    if (url.pathname.startsWith('/api/')) {
      net.stray.push(`${route.request().method()} ${url.pathname} (unmocked)`);
      return route.abort();
    }
    return route.fallback();
  });

  await page.route('**/api/chat', async route => {
    net.chatRequests.push(route.request().postDataJSON());
    const mock = chat();
    if (mock.kind === 'error') return route.fulfill({ status: mock.status, contentType: 'text/plain', body: mock.body });
    return route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' },
      body: mock.frames.map(frame).join(''),
    });
  });
  await page.route('**/api/replies**', route => route.fulfill({ json: { replies: [], liveUntil: 0 } }));
  await page.route('**/api/corpus', route => route.fulfill({ json: { results: [] } }));
  await page.route('**/api/live-token', route => route.fulfill({ json: { token: 'e2e-token', expiresAt: new Date(Date.now() + 600_000).toISOString() } }));

  // Sockets to anywhere but the dev server (its HMR socket) and the mocked Gemini one are closed and recorded.
  await page.routeWebSocket(url => url.host !== host && !/generativelanguage\.googleapis\.com/.test(url.host), ws => {
    net.stray.push(`WebSocket ${ws.url()}`);
    void ws.close();
  });
  await page.routeWebSocket(/generativelanguage\.googleapis\.com/, ws => {
    ws.onMessage(data => {
      const message = JSON.parse(String(data)) as Record<string, unknown>;
      net.liveSent.push(message);
      if ('setup' in message) ws.send(JSON.stringify({ setupComplete: {} }));
    });
  });
  return net;
}

export function expectNoStrayRequests(net: Network): void {
  expect(net.stray, 'requests that left the dev server or hit an unmocked /api route').toEqual([]);
}
