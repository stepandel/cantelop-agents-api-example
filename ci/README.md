# Continuous deployment

`deploy.yml` in this directory is a GitHub Actions workflow that runs
`npm run check` and a dry-run deployment build (`npm run build`) on every pull
request and every push to `master`. Pushes to `master` additionally install the
Cantelop CLI and run `cantelop deploy`, releasing the app named in
`cantelop.json`. Deployments are serialized through a concurrency group so
concurrent merges cannot race the app upload lock.

## Activate the workflow

GitHub only runs workflows from `.github/workflows/`, and creating files there
requires credentials permitted to manage Actions workflows. Move the file into
place once with your own account:

```sh
mkdir -p .github/workflows
git mv ci/deploy.yml .github/workflows/deploy.yml
```

## One-time setup for the deploy job

1. Create the app and configure its production environment as described in the
   main README's deployment steps (`cantelop app create`,
   `npm run env:upload -- APP_ID`).
2. Run `cantelop login` locally, then copy the credential file it writes
   (`~/.config/cantelop/config.json`) into a GitHub Actions secret named
   `CANTELOP_CLI_CREDENTIALS`. The workflow writes it to the path named by
   `CANTELOP_CONFIG` with owner-only permissions; the credential is never
   printed.

The CLI refreshes the stored access token against the console when it expires.
If the console rotates or revokes the refresh token, deployments start failing
with a credential error; run `cantelop login` again and update the secret.
