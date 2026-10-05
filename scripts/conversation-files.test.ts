import { describe, expect, it } from 'vitest';
import { KEEP_MS, filesToPrune, outputName, parseOutputName } from './conversation-files';

const now = Date.parse('2026-10-04T15:00:00Z');
const midnight = (d: string) => Date.parse(`${d}T00:00:00Z`);

describe('outputName and parseOutputName', () => {
  it('names transcripts by the day written and the day the oldest conversation started, and digests by the day written', () => {
    expect(outputName('transcripts', now, Date.parse('2026-09-10T14:02:00Z'))).toBe('verso-2026-10-04-from-2026-09-10.md');
    expect(outputName('digest', now)).toBe('verso-digest-2026-10-04.md');
    expect(parseOutputName('verso-2026-10-04-from-2026-09-10.md')).toEqual({ kind: 'transcripts', written: midnight('2026-10-04'), expiresFrom: midnight('2026-09-10') });
    expect(parseOutputName('verso-digest-2026-10-04.md')).toEqual({ kind: 'digest', written: midnight('2026-10-04'), expiresFrom: midnight('2026-10-04') });
  });

  it('dates an empty download, or a nonsense oldest time, by the day it was written', () => {
    expect(outputName('transcripts', now, now)).toBe('verso-2026-10-04-from-2026-10-04.md');
    expect(outputName('transcripts', now, now + 86_400_000)).toBe('verso-2026-10-04-from-2026-10-04.md');
  });

  it('still reads files named before the oldest day was in the name, dated by the day written', () => {
    expect(parseOutputName('verso-2026-10-04.md')).toEqual({ kind: 'transcripts', written: midnight('2026-10-04'), expiresFrom: midnight('2026-10-04') });
  });

  it('ignores every name the script does not write', () => {
    for (const name of [
      'notes.md', 'verso-2026-10-04.md.bak', 'verso-2026-10-04.txt', 'my-verso-2026-10-04.md', 'verso-2026-13-01.md', 'verso-2026-02-30.md',
      'verso-latest.md', '.DS_Store', 'verso-digest-2026-10-04-from-2026-09-01.md', 'verso-2026-10-04-from-2026-02-30.md', 'verso-2026-10-04-from-.md',
    ]) {
      expect(parseOutputName(name), name).toBeNull();
    }
  });
});

describe('filesToPrune', () => {
  it('deletes a transcript file once its oldest conversation is 30 days old, however recently it was written', () => {
    const names = ['verso-2026-10-04-from-2026-09-05.md', 'verso-2026-10-03-from-2026-09-04.md', 'verso-2026-09-10-from-2026-09-06.md'];
    expect(filesToPrune(names, now)).toEqual(['verso-2026-10-03-from-2026-09-04.md']);
  });

  it('measures from the start of the oldest conversation\'s day', () => {
    const edge = midnight('2026-09-04') + KEEP_MS;
    expect(filesToPrune(['verso-2026-10-01-from-2026-09-04.md'], edge)).toEqual([]);
    expect(filesToPrune(['verso-2026-10-01-from-2026-09-04.md'], edge + 1)).toEqual(['verso-2026-10-01-from-2026-09-04.md']);
  });

  it('deletes digests and old-style transcript files 30 days after they were written', () => {
    const names = ['verso-2026-09-05.md', 'verso-2026-09-04.md', 'verso-digest-2026-08-01.md', 'verso-digest-2026-09-20.md'];
    expect(filesToPrune(names, now)).toEqual(['verso-2026-09-04.md', 'verso-digest-2026-08-01.md']);
  });

  it('never touches files it did not write, however old', () => {
    expect(filesToPrune(['reading-2020-01-01.md', 'verso-notes.md', 'Verso-2020-01-01.md'], now)).toEqual([]);
  });

  it('removes transcripts of any age where they no longer belong, keeping recent digests', () => {
    const names = ['verso-2026-10-03.md', 'verso-2026-10-03-from-2026-10-01.md', 'verso-digest-2026-10-03.md', 'verso-digest-2026-08-01.md', 'other.md'];
    expect(filesToPrune(names, now, { transcriptsAnyAge: true })).toEqual(['verso-2026-10-03.md', 'verso-2026-10-03-from-2026-10-01.md', 'verso-digest-2026-08-01.md']);
  });
});
