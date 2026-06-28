<div align="center">

<!-- TODO: replace with your logo/banner image -->
<img src="assets/banner.png" alt="Local Competitor Map" width="820" />

# 🗺️ Local Competitor Map

### AI-powered local-competitor intelligence on a photorealistic 3D map.

Ask in plain English — *"show me the top 10 plumbers in New York"* — and watch the
competitors appear as pins on Google's photoreal 3D globe, ranked with **ratings,
reviews and rich detail cards**. Powered by a **Gemini** agent that talks to
**Google Places** through the **Model Context Protocol**.

<br/>

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Lit](https://img.shields.io/badge/Lit-3-324FFF?logo=lit&logoColor=white)](https://lit.dev/)
[![Gemini](https://img.shields.io/badge/Gemini-2.5%20Flash-8E75B2?logo=googlegemini&logoColor=white)](https://ai.google.dev/)
[![Google Maps](https://img.shields.io/badge/Google%20Maps-Photorealistic%203D-4285F4?logo=googlemaps&logoColor=white)](https://developers.google.com/maps/documentation/javascript/3d-maps-overview)

<!-- TODO: replace with a demo GIF -->
<img src="assets/demo.gif" alt="Demo" width="820" />

</div>

---

## ✨ What it does

**Local Competitor Map** turns a question into a map. Give it a business (or a whole
category) and a place, and it finds the local competitive set, plots every result on
a photorealistic 3D map, and lets you click any one for a Google-Maps-style detail
card — all driven by a conversational Gemini agent.

- 🔍 **Natural-language search** — *"who competes with Blue Bottle Coffee in San Francisco?"* or the deterministic `/competitors <business> in <city>` command.
- 📍 **Pins with ratings** — each competitor is a 3D pin labelled with its star rating; the client you searched for is highlighted.
- 🧾 **Rich detail cards** — click a pin or a list row for photo, rating, review count, category, address, phone, hours, website and a Google Maps link.
- 💬 **In-chat results list** — competitors are listed right in the conversation; click a row to fly the camera and pinpoint it.
- 🧹 **Declutter filter** — one click hides Google's place labels (parks, streets, unrelated businesses) so only *your* competitor pins remain.
- 🔑 **Bring-your-own keys** — keys live in your browser (Settings tab) or a gitignored local file; nothing is hard-coded or committed.

---

## 📸 Screenshots

<!-- TODO: drop your images into assets/ and they'll render here -->

| Competitor search | Detail card | Declutter filter |
| :---: | :---: | :---: |
| ![Search](assets/screenshot-search.png) | ![Detail](assets/screenshot-detail.png) | ![Clean](assets/screenshot-clean.png) |

---

## 🚀 Quick start

**Prerequisites:** [Node.js](https://nodejs.org/) 18+ and a Google account with the
Maps Platform and Gemini APIs enabled (see [Configuration](#-configuration)).

```bash
# 1. Clone
git clone https://github.com/AgriciDaniel/local-competitor-map.git
cd local-competitor-map

# 2. Install
npm install

# 3. Add your keys — either:
#    a) run the app and paste them in the Settings tab, or
#    b) copy the example and fill it in (this file is gitignored)
cp runtime-keys.example.ts runtime-keys.ts

# 4. Run
npm run dev
```

Then open the printed URL (e.g. `http://localhost:3000`).

---

## 🔑 Configuration

The app needs two credentials. You can paste them into the in-app **Settings** tab
(stored in your browser's `localStorage`) **or** put them in `runtime-keys.ts`:

```ts
// runtime-keys.ts  (gitignored — never committed)
export const RUNTIME_KEYS = {
  geminiKey: 'YOUR_GEMINI_API_KEY',
  mapsKey: 'YOUR_GOOGLE_MAPS_API_KEY',
};
```

| Key | Where to get it | APIs that must be enabled |
| --- | --- | --- |
| **Gemini API key** | [Google AI Studio](https://aistudio.google.com/apikey) | Generative Language API |
| **Google Maps key** | [Google Cloud Console](https://console.cloud.google.com/google/maps-apis) | **Maps JavaScript API**, **Places API (New)**, **Geocoding API**, **Directions API** — with **billing enabled** |

> 🔒 **Security:** keys are used client-side only. `runtime-keys.ts`, `.env*` and
> `*.zip` are gitignored, and the bundled fallback key is empty by default, so no
> secret is ever committed.

---

## 🕹️ Usage

| You type | What happens |
| --- | --- |
| `show me the top 10 plumbers in New York` | Gemini routes to the competitor tool and plots them |
| `who competes with Sweetgreen in Washington, DC?` | Same, for a named business (highlighted as the client) |
| `/competitors Blue Bottle Coffee in San Francisco` | Deterministic slash command (no model call) |
| `/competitors a gym in Austin, Texas for fitness` | `<business> in <city> [for <keyword>]` grammar |

Then:

- **Click a list row or a pin** → the camera flies to it and a detail card opens.
- **Toggle "🧹 Competitors only"** (top-right) → hides Google's labels for a clean, competitor-only view.
- **Clear (✕)** on the results → resets the map.

---

## 🧠 How it works

A Lit web component renders the chat + the `<gmp-map-3d>` photorealistic map. A
Gemini agent is given map tools over an **in-process MCP** transport; when it calls
`find_local_competitors`, the app queries the **Places API** and renders the results.

```mermaid
flowchart LR
    U[User prompt] --> G[Gemini 2.5 Flash]
    G -- tool call --> M[MCP server]
    M -- callback --> A[MapApp · Lit]
    A -- Place.searchByText --> P[Google Places API]
    P -- competitors --> A
    A --> Pins[3D pins + in-chat list + detail card]
```

| Layer | File |
| --- | --- |
| App entry · Gemini chat · MCP wiring | `index.tsx` |
| MCP server · tool definitions | `mcp_maps_server.ts` |
| UI · 3D map · competitor rendering | `map_app.ts` |
| Places competitor search | `places.ts` |
| Local key resolution | `settings.ts` · `runtime-keys.ts` |
| DataForSEO ranking layer (shelved) | `dataforseo.ts` |

---

## 🗂️ Project structure

```
.
├── index.html              # App shell + import map
├── index.tsx               # Entry: Gemini chat + MCP client/server wiring
├── map_app.ts              # Lit component: 3D map, chat, competitor UI, filter
├── mcp_maps_server.ts      # MCP tools the agent can call
├── places.ts               # Google Places competitor search
├── settings.ts             # Key resolution (localStorage → runtime-keys.ts)
├── runtime-keys.example.ts # Template for your local keys (copy → runtime-keys.ts)
├── dataforseo.ts           # SHELVED: future local-SEO ranking layer
├── index.css               # Styles
└── vite.config.ts          # Vite config (+ dormant DataForSEO proxy)
```

---

## 🛣️ Roadmap

- [ ] **Organic competitors** panel (keyword/SERP overlap), as a second tab
- [ ] **Geo-grid rank heatmap** (true local-pack ranking via DataForSEO)
- [ ] **Granular POI filter** via a cloud Map style + Map ID (hide *specific* label types)
- [ ] Review / NAP intelligence in the detail card
- [ ] Optional one-click Google sign-in (Search Console / Business Profile)

---

## 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for the dev
setup, coding conventions, and how to open issues and pull requests.

---

## 📄 License

Licensed under the **Apache License 2.0** — see [LICENSE](LICENSE).

## 🙏 Acknowledgements

- Built on Google AI Studio's `mcp_maps_3d` sample.
- [Google Maps Platform — Photorealistic 3D Maps](https://developers.google.com/maps/documentation/javascript/3d-maps-overview), [Places API](https://developers.google.com/maps/documentation/places/web-service/op-overview), [Gemini API](https://ai.google.dev/), [Model Context Protocol](https://modelcontextprotocol.io/), [Lit](https://lit.dev/), [Vite](https://vitejs.dev/).

<div align="center">
<sub>Made with 🗺️ + 🤖</sub>
</div>
