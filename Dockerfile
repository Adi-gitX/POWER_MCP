# Power, as a container.
#
# Two things about this image are not obvious and are both deliberate.
#
# It keeps `git` and `pnpm` in the final stage. Power is not only a web server:
# the sandbox commits a project's history with real git, and a preview runs the
# project's own dev server, which means `pnpm install --ignore-workspace` and
# `pnpm start` as child processes. An image with only node in it starts fine and
# then fails the first time anyone asks to see their app.
#
# It installs with `--filter @power/mcp-server...`, so the marketing site and
# its Next.js toolchain never enter the build. The server project is built
# directly rather than through the root tsconfig, so nothing but the server
# and the packages it depends on is compiled.
#
# Built for whichever architecture it is built on. arm64 matters: the cheapest
# always-free compute is ARM, and PGlite ships wasm, so it does not care.

# ---------------------------------------------------------------- build
FROM node:22-slim AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app

# Manifests first, so a change to source does not re-resolve the dependency
# graph. The lockfile is copied with them or --frozen-lockfile has nothing to
# be frozen against.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.json ./
COPY packages/gates/package.json ./packages/gates/
COPY packages/protocol/package.json ./packages/protocol/
COPY packages/runstate/package.json ./packages/runstate/
COPY packages/sdk/package.json ./packages/sdk/
COPY apps/mcp-server/package.json ./apps/mcp-server/

RUN pnpm install --frozen-lockfile --filter "@power/mcp-server..."

COPY packages ./packages
COPY apps/mcp-server ./apps/mcp-server

# tsc --build follows this project's references, so the three packages it
# depends on are compiled with it.
RUN pnpm --filter @power/mcp-server run build

# Drop everything that was only needed to compile. Done here rather than by
# copying node_modules to a fresh stage, because pnpm's store is a tree of
# symlinks and copying it between stages is how that breaks quietly.
RUN pnpm install --frozen-lockfile --filter "@power/mcp-server..." --prod --ignore-scripts

# ---------------------------------------------------------------- run
FROM node:22-slim AS runner

ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

# git for the project history, ca-certificates for every outbound HTTPS call,
# and tini so a signal reaches node rather than being swallowed by PID 1.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates tini \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack install -g pnpm@10.0.0

WORKDIR /app

# node:22-slim already has an unprivileged `node` user. Power writes project
# files, git repositories and database branches under POWER_LOCAL_ROOT, so that
# directory has to belong to it.
COPY --from=builder --chown=node:node /app /app
RUN mkdir -p /data && chown node:node /data

# Generated projects are committed by git, which refuses to work without an
# identity, and the author of a checkpoint is Power rather than a person.
ENV GIT_AUTHOR_NAME=Power
ENV GIT_AUTHOR_EMAIL=power@localhost
ENV GIT_COMMITTER_NAME=Power
ENV GIT_COMMITTER_EMAIL=power@localhost

# Projects, checkpoints, previews and the local database branches. On a host
# with an ephemeral filesystem this must be a mounted volume, or every project
# disappears on deploy.
ENV POWER_LOCAL_ROOT=/data
ENV PORT=8080

USER node
EXPOSE 8080

# The check is a real one: it queries the control plane, so a node whose
# database has gone away is taken out of rotation instead of accepting tool
# calls it cannot serve.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/mcp-server/dist/index.js"]
