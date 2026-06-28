# Security

Do not open public issues containing credentials, API keys, or private data.

This is a client-side app: your Gemini and Google Maps keys live only in your
browser (`localStorage`) or in a gitignored `runtime-keys.ts`. They are never
committed. The bundled fallback key is empty, and `runtime-keys.ts`, `.env*`, and
`*.zip` are gitignored.

## Reporting a vulnerability

Report vulnerabilities privately via GitHub Security Advisories:
https://github.com/AgriciDaniel/local-competitor-map/security/advisories/new

Please include steps to reproduce and the impact. Do not include real keys or
secrets in the report.

## Key hygiene

- Restrict your Google Maps key by HTTP referrer, and your Gemini key as
  appropriate, in the respective consoles.
- Rotate any key you suspect has leaked.
