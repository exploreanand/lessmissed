# syntax=docker/dockerfile:1
# Build context: the REPOSITORY ROOT (the worker imports shared library files
# across packages from ../../Web-App/lessmissed/lib). Build with:
#   docker build -f capture-service/Dockerfile -t lessmissed-capture .
#
# Base image is pinned to the exact Playwright version in the lockfile; it
# ships Chromium, every OS dependency it needs, and a non-root `pwuser`.
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS base
WORKDIR /app

# Install the worker's runtime deps at the repo-root level, so a single
# /app/node_modules resolves them for BOTH capture-service/src and the shared
# Web-App/lessmissed/lib/** it imports. We keep capture-service/package.json
# (its "type":"module" makes /app the ESM root for those shared .js files) but
# NOT its lockfile: that lockfile symlinks mongoose/@aws-sdk/sharp into the web
# app's node_modules (a local-dev convenience) and can't produce a standalone
# install. Instead we install the deps for real, pinned to the exact versions
# the web app resolves, so the shared library behaves identically to local — and
# a fresh Linux install also fetches sharp's linux binary (@img/sharp-linux-x64),
# which the macOS-generated lockfile omits.
COPY capture-service/package.json ./
RUN npm install --omit=dev --no-audit --no-fund \
      mongoose@9.4.1 \
      @aws-sdk/client-s3@3.1037.0 \
      @aws-sdk/credential-providers@3.1161.0 \
      sharp@0.34.5 \
      playwright@1.63.0
# Chromium is already present in the base image for this Playwright version;
# this is a fast no-op that fails loudly if the versions ever drift.
RUN npx playwright install chromium

# Worker source, plus the exact shared library it imports across packages.
# We deliberately do NOT copy Web-App/lessmissed/package.json: with no closer
# "typeless" package.json, those .js files inherit /app's "type":"module"
# (from capture-service/package.json copied above) and load as ESM with no
# reparse warning.
COPY capture-service/ ./capture-service/
COPY Web-App/lessmissed/lib/ ./Web-App/lessmissed/lib/

ENV NODE_ENV=production
WORKDIR /app/capture-service
USER pwuser
CMD ["node", "src/worker.js"]
