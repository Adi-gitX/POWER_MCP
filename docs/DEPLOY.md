# Deploying Power

Written for whoever is putting Power on the internet for the first time. Until
this is done nobody can add Power to Claude, including you, so this is the step
that turns a repository into a product.

## The one constraint that decides everything

Power needs three things from its host:

1. **A long-running process.** It is a server, not a set of functions.
2. **A persistent filesystem.** Projects, their git history, and the local
   database branches live on disk.
3. **Permission to spawn child processes.** A preview *is* the project's own dev
   server, started by Power and proxied to.

That combination rules out most of what is advertised as free hosting. Vercel,
Netlify, Cloudflare Workers and Deno Deploy fail (1) and (3). Heroku's free-ish
student credit fails (2): its filesystem is ephemeral, so every project would
disappear on each deploy. Fly.io would fit, but
[it ended its free tier for new organizations in October 2024](https://agentdeals.dev/vendor/fly-io)
and is now pay-as-you-go from the end of a two-hour trial.

What fits is a plain virtual machine. That is the whole reason this directory
contains a Docker Compose file and a Caddyfile rather than a platform config.

## The free stack

| Need | Use | Cost | Notes |
|---|---|---|---|
| The machine | DigitalOcean droplet | **$200 credit** from the [GitHub Student Developer Pack](https://education.github.com/pack) | A 1 GB droplet is about $6/month, so the credit covers a year comfortably. Reliable, and the simplest of the options. |
| The machine, forever | [Oracle Cloud Always Free](https://cloudpricecheck.com/free-tier/oracle) | **$0, no expiry** | 2 ARM cores, 12 GB RAM, 200 GB storage. Halved in 2026 from 4/24 but still far more than Power needs. Pick this if you want it never to start costing money; the image builds for ARM. |
| Control-plane Postgres | [Neon](https://neon.com) free tier | **$0** | 1 GB per project, scales to zero, managed backups. Ample for a control plane, which stores accounts, tokens and project metadata rather than app data. |
| Domain | Namecheap `.me` via the Student Pack | **$0 for a year** | Power needs a stable HTTPS origin. Any domain works; this one is free. |
| TLS | Caddy | **$0** | In the Compose file. Gets and renews a Let's Encrypt certificate with no certbot and no cron. |
| Sign-in email | [Resend](https://resend.com) free tier | **$0** | 3,000/month, capped at 100/day, one verified domain. Plenty for sign-in links. |
| Error reporting | Sentry free tier | **$0** | Not yet wired in. |
| CI | GitHub Actions | **$0** on a public repo | |

Also in the Student Pack and worth knowing about: $100 Azure credit, $50
MongoDB Atlas credit, and JetBrains IDEs. Copilot Pro is in there too, though it
does not help with hosting.

The two credits that matter are DigitalOcean's $200 and the free domain. Nothing
else in this list costs anything at Power's current size.

> One caution on Oracle: its always-free instances have a reputation for being
> reclaimed if left idle, and capacity for ARM instances is often unavailable in
> popular regions. Free forever is worth something; so is not losing the box.

## Before you deploy: verify the security model

**Do this first.** Power's entire tenant isolation is three mutually exclusive
row-level security policies in Postgres. They have only ever run against PGlite,
which is a different implementation of the same protocol, and the production
path uses a connection-level `role` parameter that PGlite does not exercise.

Create a throwaway Neon database — not the one you will deploy against — and:

```sh
POWER_TEST_DATABASE_URL='postgres://…?sslmode=require' pnpm test:postgres
```

The suite creates roles and tables, so it must not be pointed at anything you
care about. It checks that a tenant's transaction reads zero OAuth rows and zero
secret rows, that sealed secrets survive a `bytea` round trip, and that the
server refuses to start if it connects as the wrong role.

If this does not pass, do not deploy. Everything else here is reversible.

## Deploying

**1. The machine.** Create the smallest droplet with Docker preinstalled, or
install Docker on an Oracle ARM instance. Open ports 80 and 443 only.

**2. DNS.** Point your domain's A record at the machine's IP and wait for it to
resolve. Caddy serves the certificate challenge over port 80, so a domain that
does not resolve yet will fail and back off.

**3. The database.** Create a Neon project and copy its connection string.

**4. Configure.**

```sh
git clone <your repo> power && cd power/deploy
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # POWER_SECRET_KEY
$EDITOR .env
```

`POWER_ISSUER_URL` must be the public origin with its scheme and no trailing
slash. `POWER_MCP_URL` is derived from it as `<issuer>/mcp`, and that value has
to equal what a person types into Claude byte for byte. A single extra slash
fails the connection with nothing useful in any log, and it is the most common
mistake by a wide margin.

**5. Start.**

```sh
docker compose up -d --build
docker compose logs -f power
```

The startup banner says which control plane it opened. If it says `pglite`,
`DATABASE_URL` did not reach the container and state will not survive a deploy.

**6. Check it from somewhere else.** From your own machine, not the server:

```sh
curl -s https://mcp.example.com/.well-known/oauth-protected-resource | jq .resource
# must print exactly your POWER_MCP_URL

curl -sI -X POST https://mcp.example.com/mcp | grep -i www-authenticate
# must contain resource_metadata="…", and that URL must return 200

curl -s https://mcp.example.com/health
# "ok" means the control plane answered; 503 names what is unreachable
```

## Connecting

In Claude Code:

```sh
claude mcp add --transport http power https://mcp.example.com/mcp
claude mcp list          # "! Needs authentication" is expected
# then in a session:  /mcp  →  power  →  Authenticate
```

On claude.ai: **Settings → Connectors → Add custom connector**, paste the same
URL. Choose **Sign in now**, and for the client choose **Register
automatically** — Power supports dynamic client registration but not Client ID
Metadata Documents, so "use Claude's published identity" will fail.

Authentication settings cannot be changed after a connector is added. To change
them, remove it and add it again.

## Updating

```sh
cd power && git pull && cd deploy && docker compose up -d --build
```

The control plane migration takes an advisory lock, so two containers starting
at once wait for each other instead of racing on the policy statements.

## What is still missing

Honest, so you do not go looking for it:

- **The billing ledger is a local file.** It is on the volume, so it survives a
  restart, but it is not queryable and a second machine would keep its own.
- **No structured logging and no metrics.** The first production bug will be
  harder than it needs to be.
- **`VercelDeployer` has never run against a real account.** Local publishing is
  exercised on every test run; the real path has only met a stub. Expect to fix
  something the first time a user publishes.
- **No backups of the volume.** Neon backs up the control plane; the project
  files on disk are your responsibility. A DigitalOcean snapshot is the easy
  answer.
