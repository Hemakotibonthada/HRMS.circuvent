# Circuvent HRMS — production image for Platform VM (port 3013)
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
# Import-time env for server modules during `next build` (not used at runtime).
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
ENV DATABASE_DRIVER=pg
ENV AUTH_ISSUER=https://myaccount.circuvent.com
ENV AUTH_JWT_SECRET=build-only-placeholder-not-for-runtime
ENV ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
ENV SSO_CLIENT_ID=hrms
ENV SSO_REDIRECT_URI=https://hrms.circuvent.com/api/auth/callback
ENV NEXT_PUBLIC_APP_URL=https://hrms.circuvent.com
ENV NEXT_PUBLIC_HRMS_URL=https://hrms.circuvent.com
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3013
ENV HOSTNAME=0.0.0.0
RUN useradd --system --uid 1001 --create-home nextjs
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
# drizzle migrations + scripts kept for on-box ops (db:verify etc.)
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts ./scripts
USER nextjs
EXPOSE 3013
CMD ["npm", "run", "start", "--", "-p", "3013", "-H", "0.0.0.0"]
