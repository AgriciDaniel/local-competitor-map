/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Local-competitor discovery via the Google Maps **Places** library (New).
 *
 * This runs entirely client-side using `google.maps.places.Place.searchByText`,
 * authenticated by the already-loaded Maps JS API key — so there is no separate
 * key, no proxy and no CORS to manage. Given a client (business) and a location,
 * it returns the businesses Google surfaces for that category/area, with the
 * ratings, reviews, address, photos, hours, website and phone needed to plot
 * pins and render Maps-style detail cards. The client is flagged when matched.
 *
 * NOTE: Places returns results in Google's relevance/popularity order — that is
 * a useful proxy for "who shows up", but it is NOT a tracked local-SEO rank.
 * True local-pack rank / geo-grid tracking is a future layer (DataForSEO).
 */

/** A single normalized business. */
export interface Competitor {
  name: string;
  lat: number;
  lng: number;
  rating: number | null;
  reviews: number | null;
  address: string;
  category: string;
  /** 1-based position in the Places result list (relevance order, NOT SEO rank). */
  rank: number | null;
  placeId?: string;
  phone?: string;
  /** Business website. */
  url?: string;
  /** Link to the place on Google Maps. */
  googleMapsUri?: string;
  /** A preview photo URL, if available. */
  photoUri?: string;
  /** Human-readable weekday opening hours. */
  hours?: string[];
  /** Places business status, e.g. OPERATIONAL / CLOSED_TEMPORARILY. */
  businessStatus?: string;
  /** True when this row is the client we searched for. */
  isClient?: boolean;
}

export interface CompetitorResult {
  keyword: string;
  location: string;
  client: Competitor | null;
  competitors: Competitor[];
}

export interface CompetitorQuery {
  /** Business name or website to analyze and highlight. */
  clientName: string;
  /** City/region for relevance, e.g. "Austin, Texas". */
  location?: string;
  /** Optional explicit search keyword/category; defaults to clientName. */
  keyword?: string;
}

// Fields requested from the Places API (New). Keep in sync with normalizePlace.
const PLACE_FIELDS = [
  'displayName',
  'location',
  'rating',
  'userRatingCount',
  'formattedAddress',
  'types',
  'primaryType',
  'primaryTypeDisplayName',
  'googleMapsURI',
  'nationalPhoneNumber',
  'websiteURI',
  'regularOpeningHours',
  'photos',
  'businessStatus',
  'id',
];

/**
 * Searches for a client's local competitors.
 * @param PlaceClass The `google.maps.places.Place` class (from importLibrary('places')).
 */
export async function searchCompetitors(
  PlaceClass: any,
  query: CompetitorQuery,
): Promise<CompetitorResult> {
  const keyword = (query.keyword || query.clientName).trim();
  const location = (query.location || '').trim();
  const textQuery = location ? `${keyword} in ${location}` : keyword;

  const {places} = await PlaceClass.searchByText({
    textQuery,
    fields: PLACE_FIELDS,
    maxResultCount: 20,
    language: 'en',
  });

  const competitors: Competitor[] = (places ?? [])
    .map((p: any, i: number) => normalizePlace(p, i))
    .filter((c: Competitor | null): c is Competitor => c !== null)
    // Drop permanently-closed places; they are not live competitors.
    .filter((c) => c.businessStatus !== 'CLOSED_PERMANENTLY');

  // Re-rank so the displayed position reflects the post-filter list.
  competitors.forEach((c, i) => {
    c.rank = i + 1;
  });

  // Flag the client row by a normalized name match against the search term.
  const needle = normName(query.clientName);
  let client: Competitor | null = null;
  if (needle.length >= 3) {
    for (const c of competitors) {
      const name = normName(c.name);
      if (!name) continue;
      const match =
        name === needle ||
        name.includes(needle) ||
        (name.length >= 4 && needle.includes(name));
      if (match) {
        c.isClient = true;
        client = c;
        break;
      }
    }
  }

  return {keyword, location, client, competitors};
}

/** Normalizes a business name for fuzzy matching (case/punctuation/suffix). */
function normName(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/\b(inc|llc|ltd|co|corp|company)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Maps one Places `Place` object to our Competitor shape (or null if unusable). */
function normalizePlace(p: any, index: number): Competitor | null {
  if (!p) return null;

  const loc = p.location;
  const lat = typeof loc?.lat === 'function' ? loc.lat() : loc?.lat;
  const lng = typeof loc?.lng === 'function' ? loc.lng() : loc?.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;

  // displayName may be a string or a {text} object depending on API surface.
  const name =
    typeof p.displayName === 'string'
      ? p.displayName
      : (p.displayName?.text ?? 'Unknown place');

  const categoryRaw =
    (typeof p.primaryTypeDisplayName === 'string'
      ? p.primaryTypeDisplayName
      : p.primaryTypeDisplayName?.text) ??
    p.primaryType ??
    (Array.isArray(p.types) ? p.types[0] : '') ??
    '';

  let photoUri: string | undefined;
  try {
    const photo = Array.isArray(p.photos) ? p.photos[0] : undefined;
    if (photo && typeof photo.getURI === 'function') {
      photoUri = photo.getURI({maxWidth: 400, maxHeight: 300});
    }
  } catch (e) {
    // Photo URI not available; non-fatal.
  }

  const hours = p.regularOpeningHours?.weekdayDescriptions;

  return {
    name,
    lat,
    lng,
    rating: typeof p.rating === 'number' ? p.rating : null,
    reviews: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
    address: p.formattedAddress ?? '',
    category: typeof categoryRaw === 'string' ? categoryRaw : '',
    rank: index + 1,
    placeId: p.id,
    phone: p.nationalPhoneNumber ?? undefined,
    url: p.websiteURI ?? undefined,
    googleMapsUri: p.googleMapsURI ?? undefined,
    photoUri,
    hours: Array.isArray(hours) ? hours : undefined,
    businessStatus: p.businessStatus ?? undefined,
  };
}
