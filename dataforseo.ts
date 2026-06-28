/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SHELVED — not currently imported anywhere. Kept for the planned local-SEO
 * ranking / geo-grid layer (true local-pack rank, which the Places-based
 * competitor search does not provide). Pairs with the dormant /api/dataforseo
 * proxy in vite.config.ts. Safe to delete if that layer is abandoned.
 *
 * DataForSEO client for local-competitor discovery.
 *
 * Given a business (client) name and a location, this queries the Google Maps
 * local pack via DataForSEO's SERP "Google Maps Live Advanced" endpoint and
 * normalizes the results into a competitive set: the businesses ranking for the
 * client's category in that area, with coordinates, ratings, reviews and local
 * rank. The client itself is flagged when it appears in the pack.
 *
 * Requests go through the Vite dev proxy at `/api/dataforseo` (see
 * vite.config.ts) to avoid CORS and keep the call same-origin. HTTP Basic auth
 * is built from the DataForSEO login/password held in settings.ts.
 */

/** A single normalized business from the local pack. */
export interface Competitor {
  name: string;
  lat: number;
  lng: number;
  rating: number | null;
  reviews: number | null;
  address: string;
  category: string;
  /** Local rank within the maps results (rank_group), if present. */
  rank: number | null;
  placeId?: string;
  phone?: string;
  url?: string;
  /** True when this row is the client we searched for. */
  isClient?: boolean;
}

/** The full result of a competitor search. */
export interface CompetitorResult {
  /** The keyword/category actually searched. */
  keyword: string;
  /** The human-readable location searched. */
  location: string;
  /** The client row, if it was found in the local pack. */
  client: Competitor | null;
  /** All businesses found, in rank order. */
  competitors: Competitor[];
}

export interface DataForSeoCreds {
  login: string;
  password: string;
}

export interface CompetitorQuery {
  /** Business name or website to analyze and highlight. */
  clientName: string;
  /** City/region, e.g. "Austin, Texas, United States". Required by DataForSEO. */
  location: string;
  /** Optional explicit search keyword/category; defaults to clientName. */
  keyword?: string;
}

// Proxied to https://api.dataforseo.com/v3/... by the Vite dev server.
const ENDPOINT = '/api/dataforseo/v3/serp/google/maps/live/advanced';

const DFS_OK = 20000; // DataForSEO success status_code

/**
 * Queries DataForSEO for the local competitive set around a client.
 * Throws on HTTP or API-level errors with a human-readable message.
 */
export async function fetchLocalCompetitors(
  query: CompetitorQuery,
  creds: DataForSeoCreds,
): Promise<CompetitorResult> {
  const keyword = (query.keyword || query.clientName).trim();
  const auth = btoa(`${creds.login}:${creds.password}`);

  const body = [
    {
      keyword,
      location_name: query.location,
      language_code: 'en',
    },
  ];

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`DataForSEO HTTP ${res.status} ${res.statusText}. ${detail}`.trim());
  }

  const data = await res.json();

  // Top-level auth/account errors surface on the response itself.
  if (typeof data?.status_code === 'number' && data.status_code !== DFS_OK) {
    throw new Error(`DataForSEO error ${data.status_code}: ${data.status_message ?? 'unknown'}`);
  }

  const task = data?.tasks?.[0];
  if (!task) throw new Error('DataForSEO returned no task.');
  if (typeof task.status_code === 'number' && task.status_code !== DFS_OK) {
    throw new Error(`DataForSEO task error ${task.status_code}: ${task.status_message ?? 'unknown'}`);
  }

  const items: any[] = task?.result?.[0]?.items ?? [];

  const competitors: Competitor[] = items
    .map((it) => normalizeItem(it))
    .filter(
      (c): c is Competitor =>
        c !== null &&
        typeof c.lat === 'number' &&
        typeof c.lng === 'number' &&
        Number.isFinite(c.lat) &&
        Number.isFinite(c.lng),
    );

  // Flag the client row by fuzzy name match against the search term.
  const needle = query.clientName.trim().toLowerCase();
  let client: Competitor | null = null;
  if (needle) {
    for (const c of competitors) {
      const name = c.name.toLowerCase();
      if (name.includes(needle) || needle.includes(name)) {
        c.isClient = true;
        client = c;
        break;
      }
    }
  }

  return {keyword, location: query.location, client, competitors};
}

/** Maps one raw DataForSEO maps item to our Competitor shape (or null). */
function normalizeItem(it: any): Competitor | null {
  if (!it || !it.title) return null;
  const rating = it.rating ?? {};
  return {
    name: String(it.title),
    lat: it.latitude,
    lng: it.longitude,
    rating: typeof rating.value === 'number' ? rating.value : null,
    reviews:
      typeof rating.votes_count === 'number'
        ? rating.votes_count
        : typeof rating.rating_count === 'number'
          ? rating.rating_count
          : null,
    address: it.address ?? it.address_info?.address ?? '',
    category: it.category ?? '',
    rank: it.rank_group ?? it.rank_absolute ?? null,
    placeId: it.place_id,
    phone: it.phone,
    url: it.url ?? it.domain,
  };
}
