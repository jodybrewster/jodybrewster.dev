import { describe, expect, it } from 'vitest';
import { TOPICS, TOPIC_PROMPT, parseTopic } from './topics';

describe('parseTopic', () => {
  it.each([['hiring', 'hiring'], [' Work.\n', 'work'], ['EXPERIENCE', 'experience']])('reads %j as %s', (text, topic) =>
    expect(parseTopic(text)).toBe(topic));
  it.each(['The visitor asks about hiring', 'jobs', '', undefined, 42])('reads %j as other', text =>
    expect(parseTopic(text)).toBe('other'));
  it('offers the model every topic', () => {
    for (const topic of TOPICS) expect(TOPIC_PROMPT).toContain(`\n${topic} - `);
  });
});
