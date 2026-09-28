import { beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  sendNotice: vi.fn(), appendReply: vi.fn(), resolveTelegramMessage: vi.fn(),
}));
vi.mock('../env', () => ({ env: (key: string) => deps.env[key] }));
vi.mock('../flags', () => ({ flags: { chat: true } }));
vi.mock('../conversation', () => ({ appendReply: deps.appendReply }));
vi.mock('../operator', () => ({ resolveTelegramMessage: deps.resolveTelegramMessage }));
vi.mock('../telegram', async importOriginal => ({
  ...await importOriginal<typeof import('../telegram')>(), sendNotice: deps.sendNotice,
}));

import { POST } from '../../pages/api/telegram';

const SECRET = 'webhook-secret';
const cid = 'a3f1c2d4-0000-4000-8000-000000000000';
function post(message: unknown, secret: string | null = SECRET) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret) headers['X-Telegram-Bot-Api-Secret-Token'] = secret;
  const request = new Request('https://jodybrewster.dev/api/telegram', {
    method: 'POST', headers, body: JSON.stringify({ message }),
  });
  return POST({ request } as Parameters<typeof POST>[0]) as Promise<Response>;
}
const fromOwner = (extra: Record<string, unknown>) => ({
  message_id: 900, from: { id: 42 }, chat: { id: 42, type: 'private' }, ...extra,
});
const notices = () => deps.sendNotice.mock.calls.map(call => call[0] as string);

beforeEach(() => {
  vi.resetAllMocks();
  deps.env = { TELEGRAM_WEBHOOK_SECRET: SECRET, TELEGRAM_OWNER_ID: '42' };
  deps.appendReply.mockResolvedValue(true);
  deps.resolveTelegramMessage.mockResolvedValue({ cid, q: 'What did he build?' });
});

describe('POST /api/telegram', () => {
  it('does not exist without a webhook secret', async () => {
    deps.env = {};
    expect((await post(fromOwner({ text: 'hi' }))).status).toBe(404);
  });

  it('refuses a caller without the secret', async () => {
    expect((await post(fromOwner({ text: 'hi' }), 'wrong')).status).toBe(401);
    expect((await post(fromOwner({ text: 'hi' }), null)).status).toBe(401);
  });

  it('adds a quoted reply to the visitor conversation and confirms it', async () => {
    const response = await post(fromOwner({ text: 'Happy to talk more.', reply_to_message: { message_id: 501 } }));
    expect(response.status).toBe(200);
    expect(deps.resolveTelegramMessage).toHaveBeenCalledWith(501);
    expect(deps.appendReply).toHaveBeenCalledWith(cid, 'Happy to talk more.', 'What did he build?');
    expect(notices()[0]).toMatch(/^Sent\./);
  });

  it('refuses a bare message rather than guessing who it is for', async () => {
    await post(fromOwner({ text: 'Happy to talk more.' }));
    expect(deps.appendReply).not.toHaveBeenCalled();
    expect(notices()[0]).toContain('Nothing sent.');
  });

  it('says so when the conversation has expired', async () => {
    deps.resolveTelegramMessage.mockResolvedValue(null);
    await post(fromOwner({ text: 'Late', reply_to_message: { message_id: 501 } }));
    expect(deps.appendReply).not.toHaveBeenCalled();
    expect(notices()[0]).toContain('Nothing sent.');
  });

  it('says so when the reply could not be saved', async () => {
    deps.appendReply.mockResolvedValue(false);
    await post(fromOwner({ text: 'Hi', reply_to_message: { message_id: 501 } }));
    expect(notices()[0]).toContain('Nothing sent.');
  });

  it('stays silent to anyone but the owner, and in groups', async () => {
    const stranger = await post({ ...fromOwner({ text: 'x', reply_to_message: { message_id: 501 } }), from: { id: 7 } });
    const group = await post({ ...fromOwner({ text: 'x', reply_to_message: { message_id: 501 } }), chat: { id: 1, type: 'group' } });
    expect(stranger.status).toBe(200);
    expect(group.status).toBe(200);
    expect(deps.appendReply).not.toHaveBeenCalled();
    expect(deps.sendNotice).not.toHaveBeenCalled();
  });

  it('answers /help without sending anything to a visitor', async () => {
    await post(fromOwner({ text: '/help', reply_to_message: { message_id: 501 } }));
    expect(deps.appendReply).not.toHaveBeenCalled();
    expect(notices()[0]).toContain('Swipe right');
  });

  it('refuses a sticker or photo', async () => {
    await post(fromOwner({ reply_to_message: { message_id: 501 } }));
    expect(deps.appendReply).not.toHaveBeenCalled();
    expect(notices()[0]).toBe('Text only. Nothing sent.');
  });

  it('acknowledges even when something throws, so Telegram never redelivers', async () => {
    deps.resolveTelegramMessage.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await post(fromOwner({ text: 'Hi', reply_to_message: { message_id: 501 } }))).status).toBe(200);
  });
});
