/**
 * Rolls production back to an earlier deployment with `vercel rollback`, for
 * the jodybrewster.dev project only. Run it from a checkout linked to that
 * project (`.vercel/project.json`, made by `npx vercel link`) on the machine
 * that holds the Vercel login. It never builds or deploys.
 *
 *   npm run rollback                  # lists recent production deployments, changes nothing
 *   npm run rollback -- <url|dpl_id>  # makes that deployment production again
 *   npm run rollback -- status        # shows how the last rollback went
 *
 * A rollback brings back the old deployment's code and its environment,
 * kill switches included (docs/security.md). Vercel then stops giving the
 * production domains to new deployments until one is promoted. A merge after
 * a rollback does not go live on its own (docs/release.md).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PROJECT = 'jodybrewster.dev';

// The CLI version the Deploy workflow pins, which Dependabot keeps current.
const deployCli = JSON.parse(readFileSync('.github/deploy-cli/package.json', 'utf8')) as { dependencies: { vercel: string } };
const VERCEL_CLI = `vercel@${deployCli.dependencies.vercel}`;

function vercel(args: string[]): number {
  const result = spawnSync('npx', ['--yes', VERCEL_CLI, ...args], { stdio: 'inherit' });
  return result.status ?? 1;
}

function linkedProject(): string | undefined {
  try {
    return (JSON.parse(readFileSync('.vercel/project.json', 'utf8')) as { projectName?: string }).projectName;
  } catch {
    return undefined;
  }
}

function main(): void {
  const [target, extra] = process.argv.slice(2);
  if (extra !== undefined || target === '--help' || target === '-h') {
    console.error('Usage: npm run rollback [-- <deployment url|dpl_id> | -- status]');
    process.exit(1);
  }

  const linked = linkedProject();
  if (linked !== PROJECT) {
    console.error(
      linked
        ? `This checkout is linked to "${linked}", not ${PROJECT}. Nothing was rolled back.`
        : `This checkout is not linked to a Vercel project. Run it from the main checkout or \`npx vercel link\` to ${PROJECT} first.`,
    );
    process.exit(1);
  }

  if (target === undefined) {
    const status = vercel(['list', '--prod', '--status', 'READY']);
    console.log('\nPick the deployment to return to (the one before the bad one) and run `npm run rollback -- <its url>`.');
    process.exit(status);
  }

  if (target === 'status') process.exit(vercel(['rollback', 'status']));

  if (!/^(dpl_[A-Za-z0-9]+|(https:\/\/)?[a-z0-9-]+\.vercel\.app\/?)$/.test(target)) {
    console.error(`"${target}" is not a deployment id (dpl_...) or a *.vercel.app deployment url. Nothing was rolled back.`);
    process.exit(1);
  }

  const status = vercel(['rollback', target, '--timeout', '5m']);
  if (status === 0) {
    console.log(
      `\nProduction now serves ${target}, with that deployment's switches.` +
        '\nNew deployments will not take the production domains until one is promoted; see docs/release.md.',
    );
  }
  process.exit(status);
}

main();
