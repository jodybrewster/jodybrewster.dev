import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { expectNoStrayRequests, mockNetwork } from './network';

/**
 * The privacy notice: the dock's short note with its link, and the /privacy
 * page it leads to. Both describe recipients by category, so neither may name
 * the services behind the site.
 */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const NOTE = "Verso is an AI and can get things wrong. Jody sees what's asked and sometimes replies. The site keeps conversations for 30 days; Jody's copies may be kept longer. Voice uses Google's speech AI. Privacy";
const UNNAMED = /Telegram|Upstash|Voyage|Vercel|Anthropic|Obsidian|Gemini|Spotify/i;
const SECTIONS = [
  'Who runs the site', 'What Verso is', 'What is collected and why', 'Who else receives it', 'How long it is kept',
  'Legal basis and your rights', 'Deleting a conversation', 'Do Not Track', 'Children', 'Changes',
];

async function expectNoViolations(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(violations.map(v => `${v.id} (${v.impact}): ${v.help}\n${v.nodes.map(n => `  ${n.target.join(' ')}`).join('\n')}`)).toEqual([]);
}

test('the dock shows the short notice, and its Privacy link is reached by keyboard and opens the page', async ({ page }) => {
  const net = await mockNetwork(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/home');
  await page.locator('[data-announcer="polite"]').waitFor({ state: 'attached' });
  await page.locator('.home-verso-button').click();
  await expect(page.locator('#chat-dock')).toHaveClass(/open/);
  await expect(page.locator('#dock-panel')).not.toHaveAttribute('inert', /.*/);

  const note = page.locator('#chat-dock .dock-data-note');
  await expect(note).toHaveText(NOTE);
  expect(await note.textContent()).not.toMatch(UNNAMED);
  const link = note.getByRole('link', { name: 'Privacy' });
  await expect(link).toHaveAttribute('href', '/privacy');

  // Tab from the panel's last header control until the link has focus: it must be in the order, not only clickable.
  await page.locator('#dock-close').focus();
  for (let i = 0; i < 12 && !await link.evaluate(el => el === document.activeElement); i++) await page.keyboard.press('Tab');
  await expect(link).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/privacy\/?$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy' })).toBeVisible();
  // The dock gets out of the way of the page it opened.
  await expect(page.locator('#chat-dock')).not.toHaveClass(/open/);
  expectNoStrayRequests(net);
});

test('/privacy renders every section, names no service behind the site and passes axe', async ({ page }) => {
  const net = await mockNetwork(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/privacy');
  await expect(page).toHaveTitle(/Privacy/);
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy' })).toBeVisible();
  await expect(page.locator('main h2')).toHaveText(SECTIONS);
  await expect(page.locator('main time')).toHaveAttribute('datetime', '2026-10-04');

  const main = page.locator('main');
  expect(await main.textContent()).not.toMatch(UNNAMED);
  await expect(main.getByRole('link', { name: 'jody@jodybrewster.dev' })).toHaveAttribute('href', 'mailto:jody@jodybrewster.dev');
  await expect(main.locator('a[href="https://policies.google.com/technologies/partner-sites"]')).toBeVisible();
  await expect(main).toContainText('not intended for anyone under 18');
  await expect(main).toContainText('does not respond to Do Not Track');
  await expect(main.locator('.privacy-retention dt')).toHaveCount(6);

  await expect(page.locator('footer.foot a[href="/privacy"]')).toHaveText('Privacy');
  await expectNoViolations(page);
  expectNoStrayRequests(net);
});
