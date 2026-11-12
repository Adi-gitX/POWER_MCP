# Setting Power up

Written for whoever is operating Power, in the order the steps actually unblock
each other. Each stage says what it costs, what it gives you, and how to tell
it worked.

```sh
cp .env.example .env
```

`.env` is git-ignored and read at startup. Nothing in it is required to run
locally: `pnpm dev` works with the file untouched.

---

## Stage 0 — Run it locally

Nothing to sign up for. Works offline.

```sh
pnpm install
pnpm check          # typecheck + 288 unit tests
pnpm dev            # MCP on http://localhost:4321/mcp
```

In a second terminal, prove the whole pipeline runs:

```sh
pnpm e2e            # 93 steps through a real MCP client
```

**It worked if** `pnpm e2e` ends with `ALL PASSED`.

What you have: the full plan, gate, approve, build, verify and publish loop,
with publishing writing to disk and serving at a URL you can open. What you do
not have: anyone else can reach it.

---

## Stage 1 — Put it on the internet

**This is the one that matters.** Until it is done, Power cannot be added to
Claude by anyone, including you. Everything after this stage is optional; this
stage is not.

You need a host that gives you HTTPS, a domain, and somewhere to keep data.

### What to set

| Variable | Value | Why |
|---|---|---|
| `POWER_ISSUER_URL` | `https://mcp.yourdomain.com` | Every discovery document is built from it |
| `POWER_MCP_URL` | `https://mcp.yourdomain.com/mcp` | Must equal what a person types into Claude, exactly |
| `DATABASE_URL` | a Postgres connection string | Without it, each node keeps its own OAuth tokens |
| `POWER_SECRET_KEY` | 32 random bytes, base64 | The server refuses to start without it off loopback |
| `POWER_DEV_AUTH` | **remove it** | It is refused off loopback anyway, but do not ship it |
| `POWER_DEV_LOGIN` | **remove it** | Same |

Generate the key:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Keep a copy somewhere safe. Losing it means losing every stored credential.

### Where to host

| Option | Notes |
|---|---|
| Fly.io | Long-running process, simple volumes, cheap to start |
| Railway | Easiest path, Postgres in the same project |
| Render | Similar, managed Postgres alongside |

Power is a long-running HTTP server, not a set of serverless functions, so it
needs a host that keeps a process alive.

### Where to get a database

| Option | Notes |
|---|---|
| Neon | Branching Postgres, generous free tier |
| Supabase | Postgres plus a dashboard |
| Your host's | Railway and Render both offer one in the same project |

### Checking it worked

From your own machine, against the deployed host:

```sh
curl -s https://mcp.yourdomain.com/.well-known/oauth-protected-resource | jq .resource
# must print exactly your POWER_MCP_URL, with no trailing slash

curl -sI -X POST https://mcp.yourdomain.com/mcp | grep -i www-authenticate
# must contain resource_metadata="…" and that URL must return 200
```

If `resource` differs from the URL you type into Claude by even a slash, the
connection fails with nothing useful in any log. It is the single most common
cause.

### Then add it to Claude

Go to **Customize > Connectors**, choose **Add custom connector**, paste
`https://mcp.yourdomain.com/mcp`.

For authentication choose **Sign in now**. For the OAuth client choose
**Register automatically**. Do not choose "Use Claude's published identity":
Power supports dynamic client registration but not Client ID Metadata
Documents, so that option will fail.

On Claude Code instead:

```sh
claude mcp add --transport http power https://mcp.yourdomain.com/mcp
```

Authentication settings cannot be changed after a connector is added. To
change them, remove it and add it again.

---

## Stage 2 — Make sign-in work

Until this is set, Power prints sign-in links to the server log instead of
emailing them. Fine locally. Useless for anyone else, because they cannot see
your logs.

1. Sign up at **resend.com**, add your domain, and complete the DNS records it
   gives you.
2. Create a key at **resend.com/api-keys**.
3. Set `RESEND_API_KEY` and `POWER_MAIL_FROM`, where the From address is on the
   domain you verified.

**It worked if** signing in at `https://mcp.yourdomain.com/login` puts a link
in your inbox rather than in the log.

---

## Stage 3 — Let people publish

Nothing to configure. Set `POWER_DEPLOYER` to anything other than `local` and
each person is asked for their own hosting token through a single-use browser
form the first time they publish. It is stored encrypted against their account
and reused for every project afterwards.

They create one at **vercel.com/account/tokens**. Tell them to scope it to one
team and give it an expiry.

This is deliberate. Power operates no hosting, so a published app lives in the
account of whoever built it, and they keep it whether or not they keep using
Power.

---

## Stage 4 — Everything else

None of these block anyone from using Power. Do them when something specific
is missing.

| You want | Set | State |
|---|---|---|
| Quota that holds across more than one node | `REDIS_URL` | Works |
| The isolation suite run against real Postgres | `POWER_TEST_DATABASE_URL` | Works, throwaway database only |
| Object storage for uploads | `S3_BUCKET` and the other `S3_*` | Works. R2, MinIO or S3. Local disk without it |
| Billing | `STRIPE_SECRET_KEY` | **Not implemented.** Nothing charges anyone yet |

---

## What is still missing from the product

Honest, so you do not go looking for a setting that does not exist.

- **The generated app cannot reach a database from inside Power.** The preview
  serves its page, but nothing sets `DATABASE_URL` for a project, so every
  `/api/*` call fails. This is the largest remaining gap by a wide margin: it
  means `provision_database` creates branches the app never reads. It is code,
  not a setting. See `docs/ROADMAP.md`, Phase 1.
- **A published app gets no environment.** `publish_app` passes none, so a
  published app has neither its secrets nor a database.
- **Publishing locally serves a 404.** The release is written flat while the
  template's page is at `public/index.html`.
- **No mobile builds**, of any kind.
- **No billing.** The meter counts build actions and bills nobody.
- **Real hosting deploys are untested** against a live account. The local
  deployer is exercised on every run; the real one has only been tested against
  a stub.
- **No container and no deploy configuration** for the server itself, so there
  is no supported way to do Stage 1 yet.

---

## When something does not work

| Symptom | Cause, nearly always |
|---|---|
| Claude says it cannot reach the server | `resource` in the metadata does not match the URL you typed |
| Sign-in loops back to the form | Cookies blocked, or the issuer is not the origin being browsed |
| Server refuses to start | `POWER_SECRET_KEY` missing off loopback. Intentional |
| Every tool call says `wrong_phase` | Working as designed. Call `get_next_action` |
| A published app shows nothing | The project has no `public/index.html` |
| Tools fail after a restart | `DATABASE_URL` unset, so state was in memory |

The run state machine is strict on purpose. A refusal carrying a rule and a
next action is Power working, not Power broken.
