# Release

How a change reaches production, the GitHub settings that keep it to one path and how to roll it back.

## How a change ships

Merging a pull request into `main` deploys production.
`.github/workflows/deploy.yml` runs `npm test`, then `vercel deploy --prod` in a job of its own, with the Vercel secrets held by the GitHub `production` environment.
There are no preview deployments.
A PR is checked locally instead: the verifying block in `CLAUDE.md`, then a review against `REVIEW.md`.
The deploy pipeline is described in full in [`verso.md`](verso.md) under "Chat".

## Branch protection

This is a GitHub setting and Jody's click.
On 2026-10-16 `main` had no branch protection and no ruleset, while the `production` environment already allowed deployments from `main` only.
Without protection, anyone with push access, an agent included, can deploy production with one `git push`; a required pull request puts a reviewable diff in front of every production change.

In the repository, open Settings, then Rules, then Rulesets, then New ruleset, then New branch ruleset, and set:

| Setting | Value |
|---|---|
| Ruleset name | `main` |
| Enforcement status | Active |
| Bypass list | Empty: the rules hold for Jody's own pushes too |
| Target branches | Add target, then Include default branch |
| Restrict deletions | On |
| Require a pull request before merging | On, with Required approvals at 0 (GitHub never lets an author approve their own PR; 1 would block every merge) |
| Block force pushes | On |
| Require status checks to pass | Off for now: no workflow runs on pull requests yet, which leaves no check to require |

Then press Create.

Leave Settings, Environments, `production` as it is: Deployment branches and tags is set to Selected branches and tags, with `main` as the only rule.

To confirm, `gh api repos/jodybrewster/jodybrewster.dev/rulesets` should list the `main` ruleset as active.

## Rolling back

When production is broken, roll back first and fix forward after.
Run these from the main checkout, which is linked to the Vercel project (`.vercel/project.json`); the script refuses anywhere else.

| Step | Command |
|---|---|
| List recent production deployments (changes nothing) | `npm run rollback` |
| Make the last good one production again | `npm run rollback -- <its url or dpl_ id>` |
| Watch the rollback finish | `npm run rollback -- status` |
| Check the live site | `curl -I https://www.jodybrewster.dev/home` |

`npm run rollback` wraps `vercel rollback` with the CLI version the deploy workflow pins and never builds or deploys.

What comes back is the old deployment's code and its environment, kill switches included.
A switch turned off after that deployment was built is on again.
Check [`security.md`](security.md) under "Kill switches" before walking away.
Redis data does not roll back and neither does Verso's corpus pointer; [`verso-evaluation.md`](verso-evaluation.md) covers restoring that separately.

After a rollback Vercel stops giving the production domains to new production deployments.
The next merge to `main` builds but does not go live.
Once the fix is merged and deployed, promote it with `npx vercel promote <its url>` or use Undo Rollback in the Vercel dashboard.
Then add the incident to the evaluation set in [`verso-evaluation.md`](verso-evaluation.md).

The script has not been run against production yet.
Rehearse it once at a quiet hour: roll back to the deployment before the current one, check the site, then promote the current one again.
