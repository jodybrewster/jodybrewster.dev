/**
 * Verso: the reading assistant on the site, and the pure logic behind its prompt.
 *
 * Everything here is deliberately free of the Gemini client, Redis, and the Astro
 * request: the route owns the I/O, this module owns the shape of the
 * conversation. That split is what makes the multi-turn rules testable, and it
 * is why nothing below throws on a malformed log - a conversation replayed from
 * storage is untrusted input, not a guarantee.
 */

export const VERSO_NAME = 'Verso';

/** Stored short: a conversation log is round-tripped through Redis on every
 *  turn, so the keys are one character each. */
export interface ConversationTurn {
  /** user | assistant | Jody, replying from Telegram (src/lib/operator.ts) */
  r: 'u' | 'a' | 'j';
  t: string;
  /** epoch ms */
  ts: number;
  /** On a Jody turn only: the question he was replying to. */
  q?: string;
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

SHOWING THE WORK:
- This conversation is a canvas. When a visitor asks about one of Jody's projects, show it here with show_case_study instead of pointing them elsewhere: the visual when they want to see it, facts for role, scale and outcome, summary for the problem and the fix, architecture for how it works. Pick the one to three parts that answer the question, in the order they should appear, and call them before you write.
- show_screens shows real product screens when someone wants to see what a project looks like.
- For essays, research, lab notes and the Now page, use the matching card tool when one piece is the heart of the answer.
- go_to_page only when the visitor asks to go to, open or read a page.
- When you name one of Jody's pages in your answer, link it in Markdown with its title and url, like [Moving a thousand site maps from PDF to runtime](/work/lennar-interactive-maps). Use only urls from the excerpts, never a bare path, and never put a path in backticks.
- A general or off-topic question gets nothing on screen. Use only slugs and urls that appear in the excerpts, and copy any quoted words exactly.
- What you show complements the prose; it does not replace it. Always answer in full sentences too, and do not describe what is on screen.

STYLE:
- Editorial, considered, lowercase-leaning where natural. Match the register of the source material.
- 2–4 short paragraphs unless the question demands more. No headers, no bullet lists, no markdown formatting beyond italics for quotes and links to Jody's pages.
- Never invent quotes. If you don't have a quote, paraphrase and cite the source.`;

/** A Gemini `Content` narrowed to one text part. Gemini calls the assistant
 *  role `model`. */
export interface PromptMessage {
  role: 'user' | 'model';
  parts: [{ text: string }];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The id is interpolated into Redis key names, so anything that is not a
 *  canonical UUID is rejected outright rather than escaped. */
export function isValidConversationId(id: unknown): id is string {
  return typeof id === 'string' && UUID.test(id);
}

/**
 * Coerce a stored log into a transcript the model should see: strictly
 * alternating, opening on the user, closing on the assistant. Anything else
 * reads as a broken exchange, and a conversation is easy to leave malformed - a
 * double-send, an aborted stream, a page reload mid-answer.
 */
export function normalizeTurns(history: ConversationTurn[]): ConversationTurn[] {
  if (!Array.isArray(history)) return [];
  const turns: ConversationTurn[] = [];

  for (const entry of history) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const raw = entry as ConversationTurn;
    // Jody's replies stay out of the prompt, or Verso would quote him as if
    // it had said them and learn to write in his voice.
    if (raw.r !== 'u' && raw.r !== 'a') continue;
    if (typeof raw.t !== 'string' || !raw.t.trim()) continue;

    const previous = turns[turns.length - 1];
    if (previous && previous.r === raw.r) {
      // Two turns in one role is the shape a retry leaves behind. Fold the run
      // into the turn it ended on so the exchange survives and the shape heals.
      previous.t = `${previous.t}\n\n${raw.t}`;
      previous.ts = typeof raw.ts === 'number' ? raw.ts : previous.ts;
      continue;
    }

    turns.push({ r: raw.r, t: raw.t, ts: typeof raw.ts === 'number' ? raw.ts : 0 });
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
    role: turn.r === 'u' ? 'user' : 'model',
    parts: [{ text: turn.t }],
  }));

  messages.push({
    role: 'user',
    parts: [{ text: `Question: ${query}\n\nExcerpts from Jody's published writing:\n\n${contextBlock}` }],
  });

  return messages;
}
