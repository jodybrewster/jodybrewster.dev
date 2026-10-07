# vendor

`jodybrewster-gemini-live-<version>.tgz` is the `@jodybrewster/gemini-live` package, built in Jody's private gemini-live-nextjs repo and installed from here with `file:` so Vercel needs no registry or token.

It is not covered by this repository's LICENSE.
It is licensed by the `@jodybrewster/gemini-live` license (`packages/gemini-live-bundle/LICENSE` in the framework repo), shipped as `package/LICENSE` in the tarball from version 0.4.0: a narrow grant that does not allow reuse outside the terms it states.
Tarballs from earlier versions carry no license grant and are not licensed for use.
Read that file before doing anything with the tarball beyond running this site.

## Updating it

```bash
npm run bundle:update -- <version>   # for example 0.4.0
```

`scripts/bundle-update.sh` takes the tarball only from an immutable GitHub Release (`gemini-live@<version>`) that the framework's release workflow made on main.
It checks the release, the workflow run, the asset list and the sha256 against both GitHub's recorded digest and the release's `.sha256` file, then replaces the tarball here, points `package.json` at it and updates the lockfile with `npm install --ignore-scripts`.
It needs the GitHub CLI (`gh`) signed in with access to the private repo.
Then run the tests, type check, build, `npm run test:headers` and `npm run test:a11y`, and open a PR; merging it deploys production.
