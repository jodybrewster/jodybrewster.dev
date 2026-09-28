import { describe, expect, it, vi } from 'vitest';
import { closeHandoff, submitReply, type RedisLike } from './handoff';

describe('atomic reply transport', () => {
  it('acknowledges only a successful atomic Redis operation', async () => {
    const evalCommand = vi.fn().mockResolvedValue(1);
    const redis = { eval: evalCommand } as unknown as RedisLike;
    await expect(submitReply('question', 'Answer', redis)).resolves.toBe('accepted');
    expect(evalCommand).toHaveBeenCalledOnce();
    expect(evalCommand.mock.calls[0][1]).toEqual([
      'chat:msg:question', 'chat:msg:question:claim', 'chat:msg:question:reply', 'chat:pending',
    ]);
  });
  it('reports a failed write as unavailable', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const redis = { eval: async () => { throw new Error('Storage down'); } } as unknown as RedisLike;
      await expect(submitReply('question', 'Answer', redis)).resolves.toBe('unavailable');
      await expect(submitReply('question', 'Answer', null)).resolves.toBe('unavailable');
    } finally { log.mockRestore(); }
  });
  it('does not accept a closed or expired question', async () => {
    const redis = { eval: vi.fn().mockResolvedValue(0) } as unknown as RedisLike;
    await expect(submitReply('question', 'Answer', redis)).resolves.toBe('closed');
  });
  it('marks cancellation through one atomic close operation', async () => {
    const evalCommand = vi.fn().mockResolvedValue(1);
    await closeHandoff('question', { eval: evalCommand } as unknown as RedisLike);
    expect(evalCommand).toHaveBeenCalledOnce();
    expect(evalCommand.mock.calls[0][1]).toEqual(['chat:msg:question:claim', 'chat:pending']);
  });
});
