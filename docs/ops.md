# Operations checks

Read-only commands for the owner (or an ops agent) to answer "is production
healthy?" without opening three dashboards. None of them writes to any
platform.

## Is production coherent?

```sh
VERCEL_TOKEN=… RAILWAY_TOKEN=… npm run ops:coherence
```

`scripts/ops/prod-coherence.mjs` exits `0` with one line when everything
agrees, otherwise `1` with the first difference, for example
`Vercel is on 916d7e2 but Railway is on 75b0bd4`. It checks:

| Check | Source | Must be |
| --- | --- | --- |
| `main` head | `git ls-remote origin refs/heads/main` (or `MAIN_SHA`) | readable |
| Vercel production deployment | `GET api.vercel.com/v6/deployments?target=production&limit=1` | `READY`, same commit as `main` |
| Railway worker deployment | Railway GraphQL `deployments(first: 1)` for service `blue-belt-` | `SUCCESS`, same commit as Vercel |
| Worker health | `GET https://blue-belt-production.up.railway.app/health` (public view) | `ok` and `browserReady` |

Tokens: `VERCEL_TOKEN` needs read access to the project's deployments (a
token scoped to the team works); `RAILWAY_TOKEN` is an account or workspace
token, sent as a Bearer token. Both are optional where a proxy injects the
credential. Ids default to the production project and can be overridden with
`VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID`, `RAILWAY_PROJECT_ID`,
`RAILWAY_ENVIRONMENT_ID`, `RAILWAY_SERVICE_ID`, `WORKER_URL`. The script
never prints a token or a response body.

A deploy in progress is reported as a difference (one platform is still on
the previous commit); run it again once both builds finish.
