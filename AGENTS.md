# AGENTS.md

Guidance for AI coding agents (and humans) working in this repo.

## What this is

A client-side TypeScript app (Lit + Vite). A Gemini agent drives a Google
photorealistic 3D map (`<gmp-map-3d>`) and finds local competitors via the Google
Places API, wired over an in-process Model Context Protocol transport.

## Layout

- `index.tsx` is the entry: Gemini chat plus MCP client/server wiring and the agent system prompt.
- `mcp_maps_server.ts` defines the MCP tools the agent can call.
- `map_app.ts` is the Lit component: the 3D map, chat, competitor list, detail card, and declutter filter.
- `places.ts` runs the Places competitor search.
- `settings.ts` resolves keys (localStorage, then the gitignored `runtime-keys.ts`).
- `dataforseo.ts` is shelved for a future local-SEO ranking layer.

## Workflow

- Install: `npm install` (a `prepare` step seeds `runtime-keys.ts` from the example).
- Run: `npm run dev`. Type-check: `npm run typecheck`. Build: `npm run build`.
- Keys come from the Settings tab or `runtime-keys.ts` at runtime, not from the build.

## House rules

- Never commit secrets. `runtime-keys.ts`, `.env*`, and `*.zip` are gitignored; keep the bundled fallback key empty.
- No em dashes anywhere. Use `-`, `:`, `,`, or `.`.
- Keep keys client-side. Do not reintroduce build-time secret injection.
- Match the surrounding style: small, dependency-light, declarative comments.
- `npm run typecheck` must pass before committing.
