# Contributing

Thanks for your interest in improving **Local Competitor Map**! 🎉

## Development setup

```bash
git clone https://github.com/AgriciDaniel/local-competitor-map.git
cd local-competitor-map
npm install
cp runtime-keys.example.ts runtime-keys.ts   # add your keys (gitignored)
npm run dev
```

See the [README](README.md#-configuration) for which Google APIs each key needs.

## Before you open a PR

- **Type-check passes:** `npm run typecheck` (runs `tsc --noEmit`).
- **No secrets:** never commit real keys. `runtime-keys.ts`, `.env*` and `*.zip` are
  gitignored; keep it that way. The bundled fallback key must stay empty.
- **Match the surrounding style:** this is a small, dependency-light TypeScript + Lit
  codebase. Keep new code consistent with the existing comment density and idioms.
- **Keep keys client-side:** credentials are resolved at runtime via the Settings tab
  or `runtime-keys.ts`. Don't reintroduce build-time secret injection.

## Reporting bugs / requesting features

Open an issue with clear steps to reproduce (for bugs) or a short motivation and
sketch (for features). Screenshots help a lot for UI issues.

## Commit / PR conventions

- Keep PRs focused and reasonably small.
- Describe **what** changed and **why**, and note how you verified it.
- Reference any related issue.

By contributing, you agree that your contributions are licensed under the project's
[Apache 2.0 License](LICENSE).
