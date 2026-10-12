import { configDefaults, defineConfig } from 'vitest/config';

// Other branches checked out as git worktrees live inside this directory
// (.worktrees/, .claude/worktrees/). Without this, `npm test` runs their copies
// of every test too, at whatever state each branch is in.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '.worktrees/**', '.claude/**'],
  },
});
