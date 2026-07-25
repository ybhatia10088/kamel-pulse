# Kamel Pulse

Corridor liquidity and trust-funnel analytics for Kamel Ride, built on a typed event pipeline (Next.js 15, Drizzle, Neon Postgres).

**Status: build in progress.** This README will be replaced with the full writeup (metrics rationale, the Thanksgiving directional-asymmetry finding, architecture, and setup) at the end of the build. See commit history for milestone-by-milestone progress.

## Local setup (current)

```bash
pnpm install
cp .env.example .env.local   # fill in DATABASE_URL from a Neon project
pnpm db:push                 # push schema.ts to Postgres
pnpm dev
```

Requires Node 20 LTS and pnpm.
