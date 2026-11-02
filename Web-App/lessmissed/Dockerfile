# syntax=docker/dockerfile:1
# Build context: Web-App/lessmissed/

# --- deps: install node_modules from a clean lockfile ------------------------
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- build: compile the Next.js standalone server ----------------------------
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# No secrets at build time. connectDB() reads MONGODB_URI lazily (see
# lib/mongoose.js), so the image builds with nothing configured — this stage
# is the proof that the production build needs no database or AWS keys.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- runner: minimal production image ----------------------------------------
FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# Next's standalone output is a self-contained server.js plus only the traced
# node_modules; static assets and public/ are copied in alongside it.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
