/**
 * What a question to Verso is about, from a fixed list.
 *
 * The topic is what analytics and the transcript digest see instead of the
 * question itself: GA4 gets `topic=hiring`, never the words. A small model
 * call tags it alongside retrieval, and anything it answers that is not on the
 * list reads as `other`, so a model that rambles cannot put free text into GA4.
 */

export const TOPICS = [
  'work',       // a project, case study or product he built
  'experience', // background, roles, skills, tech stack
  'hiring',     // availability, rates, contact, résumé, working together
  'process',    // how he works, decides and ships
  'writing',    // essays, research, lab notes, ideas
  'personal',   // life, interests, the library shelf
  'verso',      // the chat itself, or AI in general
  'other',
] as const;

export type Topic = typeof TOPICS[number];

export const TOPIC_PROMPT = `Classify a question a visitor asked the AI assistant on Jody Brewster's personal site. Answer with exactly one word from this list:
work - a project, case study or product Jody built
experience - his background, roles, skills or tech stack
hiring - availability, rates, contacting him, his résumé, working together
process - how he works, makes decisions or ships
writing - his essays, research, notes or ideas
personal - his life, interests, books, music or games
verso - the assistant itself, or AI in general
other - anything else`;

export function parseTopic(text: unknown): Topic {
  if (typeof text !== 'string') return 'other';
  const word = text.trim().toLowerCase().replace(/[^a-z]/g, '');
  return (TOPICS as readonly string[]).includes(word) ? word as Topic : 'other';
}
