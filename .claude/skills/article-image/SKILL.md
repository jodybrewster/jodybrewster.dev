---
name: article-image
description: Make the ink illustration for a writing or research piece on jodybrewster.dev, the image its /writing card and lead figure share. Use when a new article is added or published, when a piece is showing a fallback image, or when asked to redo an article's picture.
argument-hint: <article slug or path>
---

# Article image

Every writing and research piece gets one ink illustration.
The same file is the card on `/writing` and the lead figure on the article, so it has to work small and wide.

The house style is fixed in `scripts/article-images.ts` and is not yours to change per article: off-white etched ink linework with crosshatching on a flat mid-tone blue ground, exactly one small element in cyan, framed like a film still.
What you decide per article is the subject, the cyan element, the ground and the side.
Those go in `content/article-images.json`.

## 1. Read the piece

Read the whole article, not the description.
Find the one concrete thing it is about: an object, a scene or a situation the argument turns on.
The best subjects come from a specific detail in the text (the Jev piece's cake that the model filed as a technical issue with 0.94 confidence), not from the topic in general.

Pick a literal subject that a magazine illustrator would draw, with a little wit in it.
Name the single element that carries the cyan accent; it should be the part that makes the point.

Never:

- screens, phones, laptops, robots, brains, glowing heads, circuit boards or anything that says "AI" by costume
- scales of justice, lightbulbs, puzzle pieces, rockets or other stock metaphors
- people
- text, unless one short label is the joke, and then say exactly what it reads

These are the `PRODUCT.md` anti-references; the old image set failed on every one of them.

## 2. Choose ground and side

Grounds: `slate`, `denim`, `cornflower`, `steel`, all shades of blue. The accent is always light cyan, which is why no ground is.
Side: `left` or `right`, the third of the frame the subject sits on.

Cards on `/writing` run newest first, three to a row.
Look at the entries for the pieces that will sit next to this one and pick a ground neither neighbour uses, and the side opposite the card before it, so the grid keeps its checkerboard.

## 3. Write the entry

Add it under `writing` or `research` in `content/article-images.json`, keyed by the slug in the article's URL (`/writing/<slug>` or `/research/<slug>`):

```json
"the-slug": {
  "subject": "a literal description of the scene ... The <thing> is the cyan element",
  "ground": "steel",
  "side": "left"
}
```

A slug in the manifest is all `src/lib/article-images.ts` needs; there is no second place to register it.

## 4. Generate and look

```bash
npm run article-images -- the-slug
```

It calls OpenAI's `gpt-image-2`, so `OPENAI_API_KEY` must be set; it is exported from `~/.zshenv`, so run through `zsh -c "source ~/.zshenv; npm run article-images -- the-slug"` if the shell does not have it. The account allows five images a minute and the script paces itself.

Open `public/images/articles/the-slug.webp` and check it against the list below.
Then look at it on `/writing` beside its neighbours and on the article page, because the card crops to 2:1 and the hero to 21:9.

- The subject reads at card size and says something about the piece.
- One cyan element, small. Everything else is off-white on the ground.
- No stray text, captions, borders, frames, glow or devices.
- The subject sits on its third and is not cut off where it matters.

If it fails, tighten the subject wording and run it again. Do not edit the style in the script to fix one image.
The script remaps the ground colour after generation, so a ground that drifts toward the wrong blue is already handled, and a roll too far off to correct is refused with a message saying so. The fix for that, or for any image that fails the list above, is a new roll.
The original of each roll is kept in `.cache/article-images/`, so `npm run article-images -- --regrade` can reapply the correction without paying for another image.

## 5. Finish

Commit the manifest entry and the webp together.
The images are committed like the book jackets; nothing in the build generates them.
