/**
 * Verso: the reading assistant on the site, and the pure logic behind its prompt.
 *
 * Everything here is deliberately free of the SDK client, Redis, and the Astro
 * request: the route owns the I/O, this module owns the shape of the
 * conversation. That split is what makes the multi-turn rules testable, and it
 * is why nothing below throws on a malformed log - a conversation replayed from
 * storage is untrusted input, not a guarantee.
 */

import type Anthropic from '@anthropic-ai/sdk';

export const VERSO_NAME = 'Verso';

/** Stored short: a conversation log is round-tripped through Redis on every
 *  turn, so the keys are one character each. */
export interface ConversationTurn {
  /** user | assistant */
  r: 'u' | 'a';
  t: string;
  /** epoch ms */
  ts: number;
  /** Assistant turns only: whether Jody answered or the model did. */
  by?: 'human' | 'llm';
}

/** How much of the past goes back up with each question. Six turns is three
 *  exchanges - enough for "what about the second one?" to resolve, short
 *  enough that the excerpts still dominate the context. */
export const MAX_HISTORY_TURNS = 6;
/** Turn count alone is a poor budget: one pasted essay can outweigh six
 *  exchanges. This is the real ceiling. */
export const MAX_HISTORY_CHARS = 3000;
export const MAX_QUERY_LEN = 600;
/** A single conversation cannot grow forever; past this the route starts a
 *  new one rather than paying to reread a transcript nobody is reading. */
export const MAX_TURNS_PER_CONV = 20;

/** Words per playback chunk. Three reads as typing; one reads as a stutter. */
const CHUNK_WORDS = 3;
const CHUNK_DELAY_MS = 28;
const PLAYBACK_CAP_MS = 4000;
/** Below this the pacing stops reading as typing and starts reading as lag. */
const MIN_CHUNK_DELAY_MS = 4;

export const SYSTEM_PROMPT = `You are ${VERSO_NAME}, the reading assistant on Jody Brewster's site, answering from his published writing, work briefs, and case studies about building useful products and AI-powered software.

VOICE RULES (non-negotiable):
- Always refer to Jody in the third person, using he/him pronouns ("Jody has written…", "his essay argues…", "he thinks…"). Never speak as Jody.
- You are speaking ABOUT a body of work, not AS its author.
- Voice cloning is explicitly a design choice this site refuses.
- Your own name is ${VERSO_NAME}. If someone asks what you are or what to call you, say so plainly.

GROUNDING RULES:
- Only synthesize from the provided excerpts. If the excerpts don't support an answer, say so plainly.
- Quote sparingly. When you do quote, mark it with italics or quotation marks.
- Cite essays/notes/briefs by their title inline (e.g., "in his essay 'Runtime is the new design surface', Jody argues…"). Do not fabricate titles.
- Treat product work, shipped interfaces, and case studies as first-class source material. When the excerpts support it, describe what Jody built, who it served, and how it moved from idea to a usable product. Do not turn every answer into a discussion of enterprise architecture.
- If asked about specific clients, employers, ongoing projects, or things outside the provided excerpts, refuse politely and redirect to what is documented.

STYLE:
- Editorial, considered, lowercase-leaning where natural. Match the register of the source material.
- 2–4 short paragraphs unless the question demands more. No headers, no bullet lists, no markdown formatting beyond italics for quotes.
- Never invent quotes. If you don't have a quote, paraphrase and cite the source.`;

/** A `MessageParam` narrowed to plain text. Pinned to the SDK type so an
 *  upstream change fails the build here rather than at the first request. */
type PromptMessage = Anthropic.MessageParam & { role: 'user' | 'assistant'; content: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The id is interpolated into Redis key names, so anything that is not a
 *  canonical UUID is rejected outright rather than escaped. */
export function isValidConversationId(id: unknown): id is string {
  return typeof id === 'string' && UUID.test(id);
}

/**
 * Coerce a stored log into a transcript the Messages API will accept: strictly
 * alternating, opening on the user, closing on the assistant. The API rejects
 * anything else with a 400, and a conversation is easy to leave malformed - a
 * double-send, an aborted stream, a page reload mid-answer.
 */
export function normalizeTurns(history: ConversationTurn[]): ConversationTurn[] {
  if (!Array.isArray(history)) return [];
  const turns: ConversationTurn[] = [];

  for (const entry of history) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const raw = entry as ConversationTurn;
    if (raw.r !== 'u' && raw.r !== 'a') continue;
    if (typeof raw.t !== 'string' || !raw.t.trim()) continue;

    const previous = turns[turns.length - 1];
    if (previous && previous.r === raw.r) {
      // Two turns in one role is the shape a retry leaves behind. Fold the run
      // into the turn it ended on so the exchange survives and the shape heals.
      previous.t = `${previous.t}\n\n${raw.t}`;
      previous.ts = typeof raw.ts === 'number' ? raw.ts : previous.ts;
      if (raw.by === 'human' || raw.by === 'llm') previous.by = raw.by;
      continue;
    }

    const turn: ConversationTurn = {
      r: raw.r,
      t: raw.t,
      ts: typeof raw.ts === 'number' ? raw.ts : 0,
    };
    if (raw.r === 'a' && (raw.by === 'human' || raw.by === 'llm')) turn.by = raw.by;
    turns.push(turn);
  }

  // A transcript that opens on an answer or closes on an unanswered question
  // is a fragment, not a conversation.
  if (turns.length && turns[0].r === 'a') turns.shift();
  if (turns.length && turns[turns.length - 1].r === 'u') turns.pop();
  return turns;
}

/**
 * "what about the second one?" embeds as noise on its own - there is nothing in
 * it to match against. Carrying the previous question along gives the vector
 * search the nouns the follow-up dropped. Nothing more clever than that: two
 * turns of context, no rewriting, no extra model call.
 */
export function retrievalQuery(history: ConversationTurn[], query: string): string {
  if (!Array.isArray(history)) return query;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const turn = history[i];
    if (!turn || typeof turn !== 'object') continue;
    if (turn.r !== 'u') continue;
    if (typeof turn.t !== 'string' || !turn.t.trim()) continue;
    return `${turn.t}\n${query}`;
  }
  return query;
}

/**
 * Assemble the transcript that goes up with this question.
 *
 * The excerpts ride on the final user message and nowhere else. Reattaching
 * them to historical turns would multiply the retrieved corpus by the length of
 * the conversation, and would leave the model reading last turn's sources as if
 * they answered this turn's question.
 */
export function buildMessages(
  history: ConversationTurn[],
  query: string,
  contextBlock: string,
): PromptMessage[] {
  const turns = normalizeTurns(history).slice(-MAX_HISTORY_TURNS);

  let chars = turns.reduce((total, turn) => total + turn.t.length, 0);
  while (turns.length && chars > MAX_HISTORY_CHARS) {
    chars -= turns[0].t.length;
    turns.shift();
  }

  // Trimming by either budget can strand a leading assistant turn, so the
  // shape has to be healed after the cut, not before it.
  const messages: PromptMessage[] = normalizeTurns(turns).map(turn => ({
    role: turn.r === 'u' ? 'user' : 'assistant',
    content: turn.t,
  }));

  messages.push({
    role: 'user',
    content: `Question: ${query}\n\nExcerpts from Jody's published writing:\n\n${contextBlock}`,
  });

  return messages;
}

/**
 * Split a reply into pieces for paced playback.
 *
 * The invariant is that `chunkForTyping(x).join('') === x` for every input:
 * playback reassembles the chunks into the answer the reader keeps, so a chunker
 * that drops a space or eats a newline corrupts the transcript rather than just
 * the animation. Whitespace therefore travels attached to the word that follows
 * it, and whatever trails the last word rides on the last chunk.
 */
export function chunkForTyping(text: string, wordsPerChunk = CHUNK_WORDS): string[] {
  if (typeof text !== 'string' || text === '') return [];
  const size = Number.isFinite(wordsPerChunk) && wordsPerChunk >= 1 ? Math.floor(wordsPerChunk) : CHUNK_WORDS;

  const chunks: string[] = [];
  const word = /\s*\S+/g;
  let buffer = '';
  let words = 0;
  let consumed = 0;
  let match: RegExpExecArray | null;

  while ((match = word.exec(text)) !== null) {
    buffer += match[0];
    words += 1;
    consumed = word.lastIndex;
    if (words === size) {
      chunks.push(buffer);
      buffer = '';
      words = 0;
    }
  }
  if (buffer) chunks.push(buffer);

  const tail = text.slice(consumed);
  if (tail) {
    if (chunks.length) chunks[chunks.length - 1] += tail;
    else chunks.push(tail);
  }

  return chunks;
}

/**
 * How long to sleep between chunks. A short answer types at the natural rate; a
 * long one compresses so the reader is never held at a crawl waiting for text
 * that has already arrived.
 */
export function typingDelayMs(
  chunkCount: number,
  perChunk = CHUNK_DELAY_MS,
  capMs = PLAYBACK_CAP_MS,
): number {
  if (!Number.isFinite(chunkCount) || chunkCount <= 0) return 0;
  return Math.max(MIN_CHUNK_DELAY_MS, Math.min(perChunk, Math.floor(capMs / chunkCount)));
}
