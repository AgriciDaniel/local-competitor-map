# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project aims to follow
[Semantic Versioning](https://semver.org/).

## 0.1.0 - 2026-06-28

Initial release.

### Added

- Natural-language and `/competitors` search that finds a business's local
  competitors (or any category) via the Google Places API.
- Photorealistic Google 3D map with competitor pins labelled by star rating; the
  searched business is highlighted.
- In-chat competitor results list; click a row to fly the camera and pinpoint it.
- Google-Maps-style detail card with photo, rating, reviews, category, address,
  phone, hours, website, and a Google Maps link.
- Map declutter filter that hides Google's place labels for a competitor-only view.
- Gemini 2.5 Flash agent wired over an in-process Model Context Protocol transport.
- Client-side key handling via the Settings tab or a gitignored `runtime-keys.ts`.
