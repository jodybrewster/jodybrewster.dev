import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  resolveTelegramMessage: vi.fn(),
  listOutstanding: vi.fn(),
  getLastQuestion: vi.fn(),
  getFinal: vi.fn(),
  submitReply: vi.fn(),
  claim: vi.fn(),
  putReply: vi.fn(),
  sendNotice: vi.fn(),
}));

vi.mock('../handoff', async importOriginal => ({
  ...await importOriginal<typeof import('../handoff')>(),
  ...state,
  claimPresenceLapse: vi.fn().mockResolvedValue(null),
}));
vi.mock('../telegram', async importOriginal => ({
  ...await importOriginal<typeof import('../telegram')>(),
  sendNotice: state.sendNotice,
}));

import { POST } from '../../pages/api/telegram';

async function reply(quoted?: number): Promise<Response> {
  const request = new Request('https://jodybrewster.dev/api/telegram', {
    method: 'POST',
    headers: { 'x-telegram-bot-api-secret-token': 'test-secret' },
    body: JSON.stringify({ message: {
      message_id: 100,
      from: { id: 42 },
      chat: { id: 42, type: 'private' },
      text: 'Jody built this.',
      ...(quoted === undefined ? {} : { reply_to_message: { message_id: quoted } }),
    } }),
  });
  return await POST({ request } as Parameters<typeof POST>[0]);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', 'test-secret');
  vi.stubEnv('TELEGRAM_OWNER_ID', '42');
  state.resolveTelegramMessage.mockResolvedValue('m1');
  state.listOutstanding.mockResolvedValue([]);
  state.getLastQuestion.mockResolvedValue(null);
  state.getFinal.mockResolvedValue(null);
  state.submitReply.mockResolvedValue('accepted');
  state.claim.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());

describe('Telegram reply delivery', () => {
  it('refuses an expired quoted target without choosing a different waiting visitor', async () => {
    state.resolveTelegramMessage.mockResolvedValue(null);
    state.listOutstanding.mockResolvedValue([{ mid: 'other', cid: 'other-cid', q: 'Other visitor', ts: Date.now(), index: 1 }]);

    expect((await reply(999)).status).toBe(200);
    expect(state.submitReply).not.toHaveBeenCalled();
    expect(state.claim).not.toHaveBeenCalled();
    expect(state.listOutstanding).not.toHaveBeenCalled();
    expect(state.sendNotice).toHaveBeenCalledWith(expect.stringContaining('Nothing sent'));
  });

  it('reports a storage failure without claiming success', async () => {
    state.submitReply.mockResolvedValue('unavailable');
    expect((await reply(11)).status).toBe(200);
    expect(state.sendNotice).toHaveBeenCalledWith(expect.stringContaining('could not be saved'));
    expect(state.sendNotice).not.toHaveBeenCalledWith('Sent as Verso.');
  });

  it('acknowledges an accepted reply without claiming browser delivery', async () => {
    await reply(11);
    expect(state.submitReply).toHaveBeenCalledWith('m1', 'Jody built this.');
    expect(state.sendNotice).toHaveBeenCalledWith('Reply accepted for the waiting conversation.');
  });

  it('does not claim the model answered when a disconnected or timed-out request closed', async () => {
    state.submitReply.mockResolvedValue('closed');
    state.claim.mockResolvedValue(false);
    await reply(11);
    expect(state.sendNotice).toHaveBeenCalledWith(expect.stringContaining('no longer waiting'));
    expect(state.sendNotice).not.toHaveBeenCalledWith(expect.stringContaining('answered from the corpus'));
  });

  it('shows the actual model answer when the model won', async () => {
    state.submitReply.mockResolvedValue('closed');
    state.claim.mockResolvedValue(false);
    state.getFinal.mockResolvedValue({ by: 'llm', text: 'Jody works on AI systems.' });
    await reply(11);
    expect(state.sendNotice).toHaveBeenCalledWith(expect.stringContaining('Jody works on AI systems.'));
  });

  it('keeps bare replies unambiguous when multiple visitors are waiting', async () => {
    state.listOutstanding.mockResolvedValue([
      { mid: 'm1', cid: 'c111', q: 'Question one', name: 'One', ts: Date.now(), index: 1 },
      { mid: 'm2', cid: 'c222', q: 'Question two', name: 'Two', ts: Date.now(), index: 1 },
    ]);
    await reply();
    expect(state.submitReply).not.toHaveBeenCalled();
    expect(state.sendNotice).toHaveBeenCalledWith(expect.stringContaining('2 questions are open'));
  });

  it('accepts a bare reply only for its one waiting visitor', async () => {
    state.listOutstanding.mockResolvedValue([{ mid: 'm2', cid: 'c2', q: 'Question', ts: Date.now(), index: 1 }]);
    await reply();
    expect(state.submitReply).toHaveBeenCalledWith('m2', 'Jody built this.');
  });
});
