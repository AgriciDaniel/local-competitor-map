/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * This file defines the main `gdm-map-app` LitElement component.
 * This component is responsible for:
 * - Rendering the user interface, including the Google Photorealistic 3D Map,
 *   chat messages area, and user input field.
 * - Managing the state of the chat (e.g., idle, generating, thinking).
 * - Handling user input and sending messages to the Gemini AI model.
 * - Processing responses from the AI, including displaying text and handling
 *   function calls (tool usage) related to map interactions.
 * - Integrating with the Google Maps JavaScript API to load and control the map,
 *   display markers, polylines for routes, and geocode locations.
 * - Providing the `handleMapQuery` method, which is called by the MCP server
 *   (via index.tsx) to update the map based on AI tool invocations.
 */

// Google Maps JS API Loader: Used to load the Google Maps JavaScript API.
import {Loader} from '@googlemaps/js-api-loader';
import hljs from 'highlight.js';
import {html, LitElement, PropertyValueMap} from 'lit';
import {customElement, query, state} from 'lit/decorators.js';
import {classMap} from 'lit/directives/class-map.js';
import {Marked} from 'marked';
import {markedHighlight} from 'marked-highlight';

import {CompetitorParams, MapParams} from './mcp_maps_server';
import {AppSettings, getSettings, saveSettings} from './settings';
import {Competitor, CompetitorResult, searchCompetitors} from './places';

// Google Maps invokes this global on authentication failure (invalid/expired
// key, referer not allowed, API not activated, billing off). We define it so we
// can replace Google's cryptic gray overlay with an actionable message.
declare global {
  interface Window {
    gm_authFailure?: () => void;
  }
}

/** Markdown formatting function with syntax hilighting */
export const marked = new Marked(
  markedHighlight({
    async: true,
    emptyLangClass: 'hljs',
    langPrefix: 'hljs language-',
    highlight(code, lang, info) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, {language}).value;
    },
  }),
);

const ICON_BUSY = html`<svg
  class="rotating"
  xmlns="http://www.w3.org/2000/svg"
  height="24px"
  viewBox="0 -960 960 960"
  width="24px"
  fill="currentColor">
  <path
    d="M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-155.5t86-127Q252-817 325-848.5T480-880q17 0 28.5 11.5T520-840q0 17-11.5 28.5T480-800q-133 0-226.5 93.5T160-480q0 133 93.5 226.5T480-160q133 0 226.5-93.5T800-480q0-17 11.5-28.5T840-520q17 0 28.5 11.5T880-480q0 82-31.5 155t-86 127.5q-54.5 54.5-127 86T480-80Z" />
</svg>`;

/**
 * Chat state enum to manage the current state of the chat interface.
 */
export enum ChatState {
  IDLE,
  GENERATING,
  THINKING,
  EXECUTING,
}

/**
 * Chat tab enum to manage the current selected tab in the chat interface.
 */
enum ChatTab {
  GEMINI,
  SETTINGS,
}

/**
 * Chat role enum to manage the current role of the message.
 */
export enum ChatRole {
  USER,
  ASSISTANT,
  SYSTEM,
}

// Last-resort Google Maps key fallback. Intentionally empty: real keys come
// from the Settings tab or the gitignored runtime-keys.ts (see settings.ts).
// When empty, loadMap() shows an actionable "configure in Settings" message
// instead of loading a dead key (which produced Google's gray "Oops" overlay).
const USER_PROVIDED_GOOGLE_MAPS_API_KEY = '';

const EXAMPLE_PROMPTS = [
  "Show me the top 10 plumbers in New York",
  "/competitors Blue Bottle Coffee in San Francisco",
  "Best coffee shops in Austin, Texas",
  "/competitors Joe's Pizza in Brooklyn, New York",
  "Who competes with Tartine Bakery in San Francisco?",
  "/competitors Equinox in Los Angeles for gym",
  "Find the best-rated dentists in Miami, Florida",
  "Who are Sweetgreen's competitors in Washington, DC?",
  "/competitors The Ritz-Carlton in Chicago for hotel",
  "Show me competitors near Philz Coffee in Palo Alto, California",
  "List nail salons around SoHo, New York",
  "/competitors a yoga studio in Boulder, Colorado",
];

/**
 * MapApp component for Photorealistic 3D Maps.
 */
@customElement('gdm-map-app')
export class MapApp extends LitElement {
  @query('#anchor') anchor?: HTMLDivElement;
  // Google Maps: Reference to the <gmp-map-3d> DOM element where the map is rendered.
  @query('#mapContainer') mapContainerElement?: HTMLElement; // Will be <gmp-map-3d>
  @query('#messageInput') messageInputElement?: HTMLInputElement;

  @state() chatState = ChatState.IDLE;
  @state() isRunning = true;
  @state() selectedChatTab = ChatTab.GEMINI;
  @state() inputMessage = '';
  @state() messages: HTMLElement[] = [];
  @state() mapInitialized = false;
  @state() mapError = '';

  // Competitor analysis state (the /competitors feature).
  @state() competitors: Competitor[] = [];
  @state() selectedCompetitor: Competitor | null = null;
  @state() competitorContext = '';
  @state() competitorLoading = false;
  // When true, the base map uses SATELLITE mode (no Google place labels), so
  // only our competitor pins are visible. False = HYBRID (labels on).
  @state() cleanMap = false;
  // UI theme. Flipping it sets color-scheme on <html>, which switches every
  // light-dark() CSS value across the app.
  @state() theme: 'light' | 'dark' = 'light';

  // Settings form fields (mirrored to localStorage on save).
  @state() private sGeminiKey = '';
  @state() private sMapsKey = '';
  @state() private settingsSaved = false;

  // Google Maps: Instance of the Google Maps 3D map.
  private map?: any;
  // Google Maps: Instance of the Google Maps Geocoding service.
  private geocoder?: any;
  // Google Maps: Instance of the current map marker (Marker3DElement).
  private marker?: any;

  // Google Maps: References to 3D map element constructors.
  private Map3DElement?: any;
  private Marker3DElement?: any;
  private Marker3DInteractiveElement?: any;
  private Polyline3DElement?: any;
  // Google Maps: Places library `Place` class (for competitor search).
  private PlaceClass?: any;

  // Set true by the gm_authFailure callback; guards the success path.
  private _authFailed = false;

  // Google Maps: Clickable markers for the competitor set.
  private competitorMarkers: any[] = [];
  // Monotonic id to ignore stale competitor searches that resolve out of order.
  private _competitorReqId = 0;

  // Google Maps: Instance of the Google Maps Directions service.
  private directionsService?: any;
  // Google Maps: Instance of the current route polyline.
  private routePolyline?: any;
  // Google Maps: Markers for origin and destination of a route.
  private originMarker?: any;
  private destinationMarker?: any;

  sendMessageHandler?: CallableFunction;
  // Set by index.tsx so a Gemini key change can rebuild the chat live.
  onSettingsSaved?: (settings: AppSettings) => void;

  constructor() {
    super();
    // Set initial input from a random example prompt
    this.setNewRandomPrompt();
    // Hydrate the settings form from localStorage.
    const s = getSettings();
    this.sGeminiKey = s.geminiKey;
    this.sMapsKey = s.mapsKey;
  }

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this._initTheme();
  }

  /** Loads the saved theme, or falls back to the OS preference. */
  private _initTheme() {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem('mcpMaps3d.theme');
    } catch (e) {
      // localStorage unavailable; fall through to OS preference.
    }
    const prefersDark =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;
    this.theme =
      stored === 'light' || stored === 'dark'
        ? stored
        : prefersDark
          ? 'dark'
          : 'light';
    this._applyTheme(this.theme);
  }

  /** Applies the theme by setting color-scheme on the document root. */
  private _applyTheme(theme: 'light' | 'dark') {
    document.documentElement.style.colorScheme = theme;
  }

  /** Toggles light/dark and persists the choice. */
  private _toggleTheme() {
    this.theme = this.theme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem('mcpMaps3d.theme', this.theme);
    } catch (e) {
      // Non-fatal: theme still applies for this session.
    }
    this._applyTheme(this.theme);
  }

  protected firstUpdated(
    _changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>,
  ): void {
    // Google Maps: Load the map when the component is first updated.
    this.loadMap();
    // Greet first-time visitors who have no keys yet (e.g. the live demo).
    this._maybeShowWelcome();
  }

  /**
   * Shows a one-time welcome that guides bring-your-own-key visitors (the
   * deployed demo) to add their keys. Skipped when keys are already configured.
   */
  private async _maybeShowWelcome() {
    const s = getSettings();
    if (s.geminiKey && s.mapsKey) return;
    await this._addSystemMessage(
      '👋 **Welcome to the Local Competitor Map demo.**\n\n' +
        'To try it, open the **Settings** tab and add your own **Gemini** and ' +
        '**Google Maps** API keys. They stay in your browser and are sent only ' +
        "to Google's APIs.\n\n" +
        'Then ask something like *"show me the top 10 plumbers in New York"*, or ' +
        'run `/competitors Blue Bottle Coffee in San Francisco`.',
    );
  }

  /**
   * Sets the input message to a new random prompt from EXAMPLE_PROMPTS.
   */
  private setNewRandomPrompt() {
    if (EXAMPLE_PROMPTS.length > 0) {
      this.inputMessage =
        EXAMPLE_PROMPTS[Math.floor(Math.random() * EXAMPLE_PROMPTS.length)];
    }
  }

  /**
   * Google Maps: Loads the Google Maps JavaScript API using the JS API Loader.
   * It initializes necessary map services like Geocoding and Directions,
   * and imports 3D map elements (Map3DElement, Marker3DElement, Polyline3DElement).
   * Handles API key validation and error reporting.
   */
  async loadMap() {
    // Key resolution: getSettings() returns the stored key or the RUNTIME_KEYS
    // fallback; the bundled demo key is the last resort (and likely auth-failing).
    const mapsKey = getSettings().mapsKey || USER_PROVIDED_GOOGLE_MAPS_API_KEY;

    const isApiKeyPlaceholder =
      mapsKey === 'YOUR_ACTUAL_GOOGLE_MAPS_API_KEY_REPLACE_ME' || mapsKey === '';

    if (isApiKeyPlaceholder) {
      this.mapError = `Google Maps API Key is not configured.
Open the Settings tab and add your Google Maps JavaScript API key
(with Maps JavaScript API, Geocoding API and Directions API enabled).`;
      console.error(this.mapError);
      this.requestUpdate();
      return;
    }

    // Register the auth-failure hook BEFORE the Maps script runs, so an
    // authentication failure surfaces our message instead of Google's gray
    // "Oops" overlay. Must be set before loader.load() (the API reads it at
    // auth time, which can resolve before/around load()).
    this._authFailed = false;
    window.gm_authFailure = () => {
      this._authFailed = true;
      this.mapInitialized = false;
      this.mapError =
        'Google Maps failed to authenticate. Open Settings and add a valid Google Maps API key (with the Maps JavaScript API, Geocoding API and Directions API enabled, and billing turned on).';
      this.requestUpdate();
    };

    const loader = new Loader({
      apiKey: mapsKey,
      version: 'beta', // Using 'beta' for Photorealistic 3D Maps features
      libraries: ['geocoding', 'routes', 'geometry', 'places'], // Request necessary libraries
    });

    try {
      await loader.load();
      // Google Maps: Import 3D map specific library elements.
      const maps3dLibrary = await (window as any).google.maps.importLibrary(
        'maps3d',
      );
      this.Map3DElement = maps3dLibrary.Map3DElement;
      this.Marker3DElement = maps3dLibrary.Marker3DElement;
      // Interactive marker supports click events (used for competitor pins).
      this.Marker3DInteractiveElement =
        maps3dLibrary.Marker3DInteractiveElement;
      this.Polyline3DElement = maps3dLibrary.Polyline3DElement;

      // Google Maps: Import the Places library for competitor search.
      const placesLibrary = await (window as any).google.maps.importLibrary(
        'places',
      );
      this.PlaceClass = placesLibrary.Place;

      if ((window as any).google && (window as any).google.maps) {
        // Google Maps: Initialize the DirectionsService.
        this.directionsService = new (
          window as any
        ).google.maps.DirectionsService();
      } else {
        console.error('DirectionsService not loaded.');
      }

      // Google Maps: Initialize the map itself.
      this.initializeMap();
      // Guard: if gm_authFailure already fired, do NOT mark the map as ready
      // (the load() promise can resolve even when auth failed).
      if (!this._authFailed) {
        this.mapInitialized = true;
        this.mapError = '';
      }
    } catch (error) {
      console.error('Error loading Google Maps API:', error);
      if (!this._authFailed) {
        this.mapError =
          'Could not load Google Maps. Check the console for details and confirm the API key is valid in Settings.';
      }
      this.mapInitialized = false;
    }
    this.requestUpdate();
  }

  /**
   * Google Maps: Initializes the map instance and the Geocoder service.
   * This is called after the Google Maps API has been successfully loaded.
   */
  initializeMap() {
    if (!this.mapContainerElement || !this.Map3DElement) {
      console.error('Map container or Map3DElement class not ready.');
      return;
    }
    // Google Maps: Assign the <gmp-map-3d> element to the map property.
    this.map = this.mapContainerElement;
    if ((window as any).google && (window as any).google.maps) {
      // Google Maps: Initialize the Geocoder.
      this.geocoder = new (window as any).google.maps.Geocoder();
    } else {
      console.error('Geocoder not loaded.');
    }
  }

  setChatState(state: ChatState) {
    this.chatState = state;
  }

  /**
   * Google Maps: Clears existing map elements like markers and polylines
   * before adding new ones. This ensures the map doesn't get cluttered with
   * old search results or routes.
   */
  private _clearMapElements() {
    if (this.marker) {
      this.marker.remove();
      this.marker = undefined;
    }
    if (this.routePolyline) {
      this.routePolyline.remove();
      this.routePolyline = undefined;
    }
    if (this.originMarker) {
      this.originMarker.remove();
      this.originMarker = undefined;
    }
    if (this.destinationMarker) {
      this.destinationMarker.remove();
      this.destinationMarker = undefined;
    }
    if (this.competitorMarkers.length) {
      for (const m of this.competitorMarkers) {
        try {
          m.remove();
        } catch (e) {
          // Ignore: element may already be detached.
        }
      }
      this.competitorMarkers = [];
    }
  }

  /**
   * Google Maps: Handles viewing a specific location on the map.
   * It uses the Geocoding service to find coordinates for the `locationQuery`,
   * then flies the camera to that location and places a 3D marker.
   * @param locationQuery The string query for the location (e.g., "Eiffel Tower").
   */
  private async _handleViewLocation(locationQuery: string) {
    if (
      !this.mapInitialized ||
      !this.map ||
      !this.geocoder ||
      !this.Marker3DElement
    ) {
      if (!this.mapError) {
        const {textElement} = this.addMessage('error', 'Processing error...');
        textElement.innerHTML = await marked.parse(
          'Map is not ready to display locations. Please check configuration.',
        );
      }
      console.warn(
        'Map not initialized, geocoder or Marker3DElement not available, cannot render query.',
      );
      return;
    }
    this._clearMapElements(); // Google Maps: Clear previous elements.

    // Google Maps: Use Geocoding service to find the location.
    this.geocoder.geocode(
      {address: locationQuery},
      async (results: any, status: string) => {
        if (status === 'OK' && results && results[0] && this.map) {
          const location = results[0].geometry.location;

          // Google Maps: Define camera options and fly to the location.
          const cameraOptions = {
            center: {lat: location.lat(), lng: location.lng(), altitude: 0},
            heading: 0,
            tilt: 67.5,
            range: 2000, // Distance from the target in meters
          };
          (this.map as any).flyCameraTo({
            endCamera: cameraOptions,
            durationMillis: 1500,
          });

          // Google Maps: Create and add a 3D marker to the map.
          this.marker = new this.Marker3DElement();
          this.marker.position = {
            lat: location.lat(),
            lng: location.lng(),
            altitude: 0,
          };
          const label =
            locationQuery.length > 30
              ? locationQuery.substring(0, 27) + '...'
              : locationQuery;
          this.marker.label = label;
          (this.map as any).appendChild(this.marker);
        } else {
          console.error(
            `Geocode was not successful for "${locationQuery}". Reason: ${status}`,
          );
          const rawErrorMessage = `Could not find location: ${locationQuery}. Reason: ${status}`;
          const {textElement} = this.addMessage('error', 'Processing error...');
          textElement.innerHTML = await marked.parse(rawErrorMessage);
        }
      },
    );
  }

  /**
   * Google Maps: Handles displaying directions between an origin and destination.
   * It uses the DirectionsService to calculate the route, then draws a 3D polyline
   * for the route and places 3D markers at the origin and destination.
   * The camera is adjusted to fit the entire route.
   * @param originQuery The starting point for directions.
   * @param destinationQuery The ending point for directions.
   */
  private async _handleDirections(
    originQuery: string,
    destinationQuery: string,
  ) {
    if (
      !this.mapInitialized ||
      !this.map ||
      !this.directionsService ||
      !this.Marker3DElement ||
      !this.Polyline3DElement
    ) {
      if (!this.mapError) {
        const {textElement} = this.addMessage('error', 'Processing error...');
        textElement.innerHTML = await marked.parse(
          'Map is not ready for directions. Please check configuration.',
        );
      }
      console.warn(
        'Map not initialized or DirectionsService/3D elements not available, cannot render directions.',
      );
      return;
    }
    this._clearMapElements(); // Google Maps: Clear previous elements.

    // Google Maps: Use DirectionsService to get the route.
    this.directionsService.route(
      {
        origin: originQuery,
        destination: destinationQuery,
        travelMode: (window as any).google.maps.TravelMode.DRIVING,
      },
      async (response: any, status: string) => {
        if (
          status === 'OK' &&
          response &&
          response.routes &&
          response.routes.length > 0
        ) {
          const route = response.routes[0];

          // Google Maps: Draw the route polyline using Polyline3DElement.
          if (route.overview_path && this.Polyline3DElement) {
            const pathCoordinates = route.overview_path.map((p: any) => ({
              lat: p.lat(),
              lng: p.lng(),
              altitude: 5,
            })); // Add slight altitude
            this.routePolyline = new this.Polyline3DElement();
            this.routePolyline.coordinates = pathCoordinates;
            this.routePolyline.strokeColor = 'blue';
            this.routePolyline.strokeWidth = 10;
            (this.map as any).appendChild(this.routePolyline);
          }

          // Google Maps: Add marker for the origin.
          if (
            route.legs &&
            route.legs[0] &&
            route.legs[0].start_location &&
            this.Marker3DElement
          ) {
            const originLocation = route.legs[0].start_location;
            this.originMarker = new this.Marker3DElement();
            this.originMarker.position = {
              lat: originLocation.lat(),
              lng: originLocation.lng(),
              altitude: 0,
            };
            this.originMarker.label = 'Origin';
            this.originMarker.style = {
              color: {r: 0, g: 128, b: 0, a: 1}, // Green
            };
            (this.map as any).appendChild(this.originMarker);
          }

          // Google Maps: Add marker for the destination.
          if (
            route.legs &&
            route.legs[0] &&
            route.legs[0].end_location &&
            this.Marker3DElement
          ) {
            const destinationLocation = route.legs[0].end_location;
            this.destinationMarker = new this.Marker3DElement();
            this.destinationMarker.position = {
              lat: destinationLocation.lat(),
              lng: destinationLocation.lng(),
              altitude: 0,
            };
            this.destinationMarker.label = 'Destination';
            this.destinationMarker.style = {
              color: {r: 255, g: 0, b: 0, a: 1}, // Red
            };
            (this.map as any).appendChild(this.destinationMarker);
          }

          // Google Maps: Adjust camera to fit the route bounds.
          if (route.bounds) {
            const bounds = route.bounds;
            const center = bounds.getCenter();
            let range = 10000; // Default range

            // Calculate a more appropriate range based on the route's diagonal distance
            if (
              (window as any).google.maps.geometry &&
              (window as any).google.maps.geometry.spherical
            ) {
              const spherical = (window as any).google.maps.geometry.spherical;
              const ne = bounds.getNorthEast();
              const sw = bounds.getSouthWest();
              const diagonalDistance = spherical.computeDistanceBetween(ne, sw);
              range = diagonalDistance * 1.7; // Multiplier to ensure bounds are visible
            } else {
              console.warn(
                'google.maps.geometry.spherical not available for range calculation. Using fallback range.',
              );
            }

            range = Math.max(range, 2000); // Ensure a minimum sensible range

            const cameraOptions = {
              center: {lat: center.lat(), lng: center.lng(), altitude: 0},
              heading: 0,
              tilt: 45, // Tilt for better 3D perspective of the route
              range: range,
            };
            (this.map as any).flyCameraTo({
              endCamera: cameraOptions,
              durationMillis: 2000,
            });
          }
        } else {
          console.error(
            `Directions request failed. Origin: "${originQuery}", Destination: "${destinationQuery}". Status: ${status}. Response:`,
            response,
          );
          const rawErrorMessage = `Could not get directions from "${originQuery}" to "${destinationQuery}". Reason: ${status}`;
          const {textElement} = this.addMessage('error', 'Processing error...');
          textElement.innerHTML = await marked.parse(rawErrorMessage);
        }
      },
    );
  }

  /**
   * Google Maps: This function is the primary interface for the MCP server (via index.tsx)
   * to trigger updates on the Google Map. When the AI model uses a map-related tool
   * (e.g., view location, get directions), the MCP server processes this request
   * and calls this function with the appropriate parameters.
   *
   * Based on the `params` received, this function will:
   * - If `params.location` is present, call `_handleViewLocation` to show a specific place.
   * - If `params.origin` and `params.destination` are present, call `_handleDirections`
   *   to display a route.
   * - If only `params.destination` is present (as a fallback), it will treat it as a location to view.
   *
   * This mechanism allows the AI's tool usage to be directly reflected on the map UI.
   * @param params An object containing parameters for the map query, like
   *               `location`, `origin`, or `destination`.
   */
  async handleMapQuery(params: MapParams) {
    if (params.location) {
      this._handleViewLocation(params.location);
    } else if (params.origin && params.destination) {
      this._handleDirections(params.origin, params.destination);
    } else if (params.destination) {
      // Fallback if only destination is provided, treat as viewing a location
      this._handleViewLocation(params.destination);
    }
  }

  /**
   * Runs a local-competitor search and plots the results on the map.
   * Shared by the `/competitors` slash command and the `find_local_competitors`
   * MCP tool (so the deterministic command and the Gemini agent behave the same).
   * Resolves with a short text summary suitable for display or for the model.
   */
  async handleCompetitors(
    params: CompetitorParams,
    viaAgent = false,
  ): Promise<string> {
    if (!this.mapInitialized || !this.PlaceClass) {
      const msg =
        'The map / Places library is not ready yet. If the map failed to load, open the **Settings** tab and check the Google Maps API key.';
      await this._addSystemMessage(msg);
      return msg;
    }

    // Enforce a location for relevance (both the slash command and the agent
    // tool funnel through here, so this keeps the two paths consistent).
    if (!params.location || !params.location.trim()) {
      const msg = `Please include a location, e.g. \`/competitors ${params.clientName} in Austin, Texas\`.`;
      await this._addSystemMessage(msg);
      return msg;
    }

    const reqId = ++this._competitorReqId;
    this.competitorLoading = true;
    try {
      const result = await searchCompetitors(this.PlaceClass, {
        clientName: params.clientName,
        location: params.location,
        keyword: params.keyword,
      });
      // Ignore if a newer search superseded this one while awaiting.
      if (reqId !== this._competitorReqId) return '';
      this._renderCompetitors(result);
      const summary = this._competitorSummary(result);
      // On the agent path Gemini narrates the result, so don't duplicate it as
      // a chat message; the interactive list still renders for both paths.
      if (!viaAgent) await this._addSystemMessage(summary);
      return summary;
    } catch (e: unknown) {
      if (reqId !== this._competitorReqId) return '';
      const detail = e instanceof Error ? e.message : String(e);
      const msg = `Competitor search failed: ${detail}`;
      await this._addSystemMessage(msg);
      return msg;
    } finally {
      if (reqId === this._competitorReqId) this.competitorLoading = false;
    }
  }

  /**
   * Renders the competitor set: stores it for the side list, clears prior map
   * elements, drops one pin per business (client highlighted), and frames the
   * camera to the whole set.
   */
  private _renderCompetitors(result: CompetitorResult) {
    // Set state first so the side list always reflects the data, even if
    // plotting on the 3D map fails (e.g. the map is still initializing).
    this.competitors = result.competitors;
    this.competitorContext = result.location
      ? `${result.keyword} · ${result.location}`
      : result.keyword;
    this.selectedCompetitor = null;

    if (!this.mapInitialized || !this.map) return;

    // Map mutations are isolated: a plotting error must NOT be reported by the
    // caller as a "search failed", because the search actually succeeded.
    try {
      this._clearMapElements();
      const points: Array<{lat: number; lng: number}> = [];
      for (const c of result.competitors) {
        const marker = this._makeCompetitorMarker(c);
        if (marker) {
          (this.map as any).appendChild(marker);
          this.competitorMarkers.push(marker);
        }
        points.push({lat: c.lat, lng: c.lng});
      }
      if (points.length) this._flyToPoints(points);
    } catch (e) {
      console.warn('Could not plot competitors on the 3D map:', e);
      void this._addSystemMessage(
        '_Results are listed on the left, but plotting them on the 3D map hit a snag (the map may still be loading)._',
      );
    }
  }

  /** Builds a 3D pin for one competitor; client pins are raised and starred. */
  private _makeCompetitorMarker(c: Competitor): any {
    const Ctor = this.Marker3DInteractiveElement || this.Marker3DElement;
    if (!Ctor) return null;

    const marker = new Ctor();
    marker.position = {lat: c.lat, lng: c.lng, altitude: c.isClient ? 40 : 0};
    // Show the rating (stars) on the pin, plus a short name. Client pins lead
    // with a ★ so they stand out.
    const ratingStr = c.rating != null ? `${c.rating}★  ` : '';
    const shortName =
      c.name.length > 26 ? `${c.name.slice(0, 24)}…` : c.name;
    marker.label = c.isClient
      ? `★ ${ratingStr}${shortName}`
      : `${ratingStr}${shortName}`;
    // Best-effort color (client gold, competitors red). Ignored by builds that
    // don't support the property; the side list carries the authoritative styling.
    try {
      marker.style = {
        color: c.isClient
          ? {r: 255, g: 193, b: 7, a: 1}
          : {r: 217, g: 48, b: 37, a: 1},
      };
    } catch (e) {
      // Property not supported in this Maps build; non-fatal.
    }
    // Only the interactive element emits clicks.
    if (this.Marker3DInteractiveElement) {
      marker.addEventListener('gmp-click', () => this._selectCompetitor(c));
    }
    return marker;
  }

  /** Selects a competitor (opens the detail card and flies the camera in). */
  private _selectCompetitor(c: Competitor) {
    this.selectedCompetitor = c;
    this.selectedChatTab = ChatTab.GEMINI;
    if (this.map) {
      (this.map as any).flyCameraTo({
        endCamera: {
          center: {lat: c.lat, lng: c.lng, altitude: 0},
          heading: 0,
          tilt: 67.5,
          range: 800,
        },
        durationMillis: 1200,
      });
    }
  }

  /**
   * Frames the camera to a set of points. Reuses the same bounds→range math as
   * `_handleDirections`, generalized to any list of coordinates.
   */
  private _flyToPoints(points: Array<{lat: number; lng: number}>) {
    if (!this.map || !points.length) return;
    const g = (window as any).google;

    if (points.length === 1) {
      (this.map as any).flyCameraTo({
        endCamera: {
          center: {...points[0], altitude: 0},
          heading: 0,
          tilt: 60,
          range: 3000,
        },
        durationMillis: 1500,
      });
      return;
    }

    if (!g?.maps?.LatLngBounds) return; // Can't frame without the geometry types.
    const bounds = new g.maps.LatLngBounds();
    for (const p of points) bounds.extend(p);
    const center = bounds.getCenter();

    let range = 10000;
    if (g.maps.geometry && g.maps.geometry.spherical) {
      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();
      range = g.maps.geometry.spherical.computeDistanceBetween(ne, sw) * 1.7;
    }
    range = Math.max(range, 1500);

    (this.map as any).flyCameraTo({
      endCamera: {
        center: {lat: center.lat(), lng: center.lng(), altitude: 0},
        heading: 0,
        tilt: 45,
        range,
      },
      durationMillis: 2000,
    });
  }

  /** Builds a short markdown summary of a competitor result. */
  private _competitorSummary(r: CompetitorResult): string {
    const n = r.competitors.length;
    const where = r.location ? ` in ${r.location}` : '';
    if (n === 0) {
      return `No results found for "${r.keyword}"${where}. Try a different category or a more specific location.`;
    }
    const top = r.competitors
      .slice(0, 5)
      .map((c) => {
        const pos = c.rank ? `#${c.rank} ` : '';
        const rating =
          c.rating != null
            ? `${c.rating}★${c.reviews != null ? ` (${c.reviews})` : ''}`
            : 'no rating';
        return `- ${pos}**${c.name}** · ${rating}`;
      })
      .join('\n');

    const clientLine = r.client
      ? `\n\n**${r.client.name}** ${r.client.rank ? `appears at position **#${r.client.rank}**` : 'appears'} for "${r.keyword}"${where}.`
      : `\n\n_Client not matched in the results, showing the competitive set for "${r.keyword}"._`;

    return `Found **${n}** businesses${where} for "${r.keyword}".${clientLine}\n\nTop results (Google Maps relevance order):\n${top}\n\n_Click any pin or list row for details._`;
  }

  /**
   * Toggles the base-map labels. SATELLITE mode drops Google's place labels
   * (parks, streets, unrelated businesses) so only our competitor pins remain;
   * HYBRID restores them. We set both the reactive attribute (via render) and
   * the live property, so an already-initialized map updates immediately.
   */
  private _toggleCleanMap() {
    this.cleanMap = !this.cleanMap;
    if (this.map) {
      try {
        (this.map as any).mode = this.cleanMap ? 'satellite' : 'hybrid';
      } catch (e) {
        console.warn('Could not switch map mode:', e);
      }
    }
  }

  /** Clears the competitor set from both the map and the UI. */
  private _clearCompetitors() {
    this.competitors = [];
    this.selectedCompetitor = null;
    this.competitorContext = '';
    this._clearMapElements();
    // Restore the labeled base map so we don't leave an empty satellite view.
    if (this.cleanMap) {
      this.cleanMap = false;
      if (this.map) {
        try {
          (this.map as any).mode = 'hybrid';
        } catch (e) {
          // Non-fatal.
        }
      }
    }
  }

  /** Adds a markdown-formatted system message to the chat. */
  private async _addSystemMessage(text: string) {
    const {textElement} = this.addMessage('system', '');
    textElement.innerHTML = await marked.parse(text);
  }

  /**
   * Handles leading-slash commands deterministically (no model call).
   * Currently: `/competitors <business> in <city> [for <keyword>]` and `/help`.
   */
  private async _handleSlashCommand(raw: string) {
    const text = raw.trim();
    const cmd = text.split(/\s+/)[0].toLowerCase();
    const arg = text.slice(cmd.length).trim();

    switch (cmd) {
      case '/competitors': {
        if (!arg) {
          await this._addSystemMessage(
            'Usage: `/competitors <business> in <city> [for <keyword>]`',
          );
          return;
        }
        const parsed = this._parseCompetitorArgs(arg);
        await this.handleCompetitors({
          clientName: parsed.client,
          location: parsed.location,
          keyword: parsed.keyword,
        });
        return;
      }
      case '/help':
        await this._addSystemMessage(
          '**Commands**\n' +
            '- `/competitors <business> in <city> [for <keyword>]`: plots a business\'s local competitors on the 3D map.\n' +
            '- Otherwise just chat naturally to explore the map.',
        );
        return;
      default:
        await this._addSystemMessage(
          `Unknown command \`${cmd}\`. Try \`/help\`.`,
        );
    }
  }

  /**
   * Parses `<client> [in <city>] [for <keyword>]` into its parts, order-
   * independently so "Joe's for coffee in Austin" and "Joe's in Austin for
   * coffee" both parse correctly (the `in` and `for` segments don't swallow
   * each other).
   */
  private _parseCompetitorArgs(arg: string): {
    client: string;
    location: string;
    keyword?: string;
  } {
    const text = arg.trim();

    // client = everything before the earliest "in"/"for" delimiter.
    const inIdx = text.search(/\s+in\s+/i);
    const forIdx = text.search(/\s+for\s+/i);
    const delims = [inIdx, forIdx].filter((i) => i >= 0);
    const firstDelim = delims.length ? Math.min(...delims) : -1;
    const client = (firstDelim >= 0 ? text.slice(0, firstDelim) : text).trim();

    // Each segment captures up to the next delimiter (or end), so neither
    // swallows the other regardless of order.
    const inMatch = /\s+in\s+(.+?)(?=\s+for\s+|$)/i.exec(text);
    const forMatch = /\s+for\s+(.+?)(?=\s+in\s+|$)/i.exec(text);

    return {
      client,
      location: inMatch ? inMatch[1].trim() : '',
      keyword: forMatch ? forMatch[1].trim() : undefined,
    };
  }

  /** Persists the settings form and applies the effects (chat rebuild / map reload). */
  private _saveSettings() {
    // Capture the prior Maps key BEFORE persisting, to detect a real change.
    const prevMapsKey = getSettings().mapsKey;

    const settings: AppSettings = {
      geminiKey: this.sGeminiKey.trim(),
      mapsKey: this.sMapsKey.trim(),
    };
    saveSettings(settings);
    this.settingsSaved = true;
    setTimeout(() => {
      this.settingsSaved = false;
    }, 2500);

    // The Google Maps JS API loads once per page and cannot hot-swap keys, so a
    // genuine Maps-key change requires a full reload (settings already persisted).
    if (settings.mapsKey !== prevMapsKey) {
      window.location.reload();
      return;
    }

    // Otherwise: let index.tsx rebuild the Gemini chat if its key changed, and
    // retry the map only if it never initialized (first-time key entry).
    this.onSettingsSaved?.(settings);
    if (!this.mapInitialized) {
      this.loadMap();
    }
  }

  /** Normalizes a possibly-bare domain into a clickable URL. */
  private _href(u: string): string {
    return /^https?:\/\//i.test(u) ? u : `https://${u}`;
  }

  setInputField(message: string) {
    this.inputMessage = message.trim();
  }

  addMessage(role: string, message: string) {
    const div = document.createElement('div');
    div.classList.add('turn');
    div.classList.add(`role-${role.trim()}`);
    div.setAttribute('aria-live', 'polite');

    const thinkingDetails = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Thinking process';
    thinkingDetails.classList.add('thinking');
    thinkingDetails.setAttribute('aria-label', 'Model thinking process');
    const thinkingElement = document.createElement('div');
    thinkingDetails.append(summary);
    thinkingDetails.append(thinkingElement);
    div.append(thinkingDetails);

    const textElement = document.createElement('div');
    textElement.className = 'text';
    textElement.innerHTML = message;
    div.append(textElement);

    this.messages = [...this.messages, div];
    this.scrollToTheEnd();
    return {
      thinkingContainer: thinkingDetails,
      thinkingElement: thinkingElement,
      textElement: textElement,
    };
  }

  scrollToTheEnd() {
    if (!this.anchor) return;
    this.anchor.scrollIntoView({
      behavior: 'smooth',
      block: 'end',
    });
  }

  async sendMessageAction(message?: string, role?: string) {
    if (this.chatState !== ChatState.IDLE) return;

    let msg = '';
    let usedComponentInput = false; // Flag to track if component's input was used

    if (message) {
      // Message is provided programmatically
      msg = message.trim();
    } else {
      // Message from the UI input field
      msg = this.inputMessage.trim();
      // Clear the input field state only if we are using its content
      // and there was actual content to send.
      if (msg.length > 0) {
        this.inputMessage = '';
        usedComponentInput = true;
      } else if (
        this.inputMessage.trim().length === 0 &&
        this.inputMessage.length > 0
      ) {
        // If inputMessage contained only whitespace, clear it and mark as used.
        this.inputMessage = '';
        usedComponentInput = true;
      }
    }

    if (msg.length === 0) {
      // If the final message to send is empty (e.g., user entered only spaces, or an empty programmatic message)
      // set a new random prompt if the component's input was cleared.
      if (usedComponentInput) {
        this.setNewRandomPrompt();
      }
      return;
    }

    const msgRole = role ? role.toLowerCase() : 'user';

    // Add user's message to the chat display
    if (msgRole === 'user' && msg) {
      const {textElement} = this.addMessage(msgRole, '...');
      textElement.innerHTML = await marked.parse(msg);
    }

    // Slash commands run locally (no model call) for deterministic behavior.
    if (msgRole === 'user' && msg.startsWith('/')) {
      await this._handleSlashCommand(msg);
      if (usedComponentInput) {
        this.setNewRandomPrompt();
      }
      return;
    }

    // Send the message via the handler (to AI)
    if (this.sendMessageHandler) {
      await this.sendMessageHandler(msg, msgRole);
    }

    // If the component's main input field was used and cleared, set a new random prompt.
    if (usedComponentInput) {
      this.setNewRandomPrompt();
    }
  }

  private async inputKeyDownAction(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.sendMessageAction();
    }
  }

  render() {
    // Google Maps: Initial camera parameters for the <gmp-map-3d> element.
    const initialCenter = '0,0,100'; // lat,lng,altitude
    const initialRange = '20000000'; // View range in meters
    const initialTilt = '45'; // Camera tilt in degrees
    const initialHeading = '0'; // Camera heading in degrees

    return html`<div class="gdm-map-app">
      <div
        class="main-container"
        role="application"
        aria-label="Interactive Map Area">
        ${this.mapError
          ? html`<div
              class="map-error-message"
              role="alert"
              aria-live="assertive"
              >${this.mapError}</div
            >`
          : ''}
        <!-- Google Maps: The core 3D Map custom element -->
        <gmp-map-3d
          id="mapContainer"
          style="height: 100%; width: 100%;"
          aria-label="Google Photorealistic 3D Map Display"
          mode="${this.cleanMap ? 'satellite' : 'hybrid'}"
          center="${initialCenter}"
          heading="${initialHeading}"
          tilt="${initialTilt}"
          range="${initialRange}"
          internal-usage-attribution-ids="gmp_aistudio_threedmapjsmcp_v0.1_showcase"
          default-ui-disabled="true"
          role="application">
        </gmp-map-3d>
        ${!this.mapInitialized
          ? html`<div class="map-backdrop" aria-hidden="true"></div>`
          : ''}
        <div class="map-controls">
          <button
            class="map-toggle icon"
            @click=${() => this._toggleTheme()}
            title="Toggle light / dark theme"
            aria-label="Toggle light or dark theme">
            ${this.theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button
            class=${classMap({'map-toggle': true, 'active': this.cleanMap})}
            @click=${() => this._toggleCleanMap()}
            aria-pressed=${this.cleanMap}
            title="Hide Google's place labels (parks, streets, other businesses) so only your competitor pins show">
            ${this.cleanMap ? '🏷️ Show map labels' : '🧹 Competitors only'}
          </button>
        </div>
        ${this.competitorLoading
          ? html`<div class="competitor-loading">${ICON_BUSY} Finding competitors…</div>`
          : ''}
        ${this.selectedChatTab === ChatTab.GEMINI && this.selectedCompetitor
          ? html`<div class="competitor-card" role="dialog" aria-label="Business details">
              <button
                class="competitor-close card-close"
                title="Close"
                aria-label="Close details"
                @click=${() => {
                  this.selectedCompetitor = null;
                }}>
                ✕
              </button>
              ${this.selectedCompetitor.photoUri
                ? html`<img
                    class="card-photo"
                    src=${this.selectedCompetitor.photoUri}
                    alt=${this.selectedCompetitor.name}
                    loading="lazy" />`
                : ''}
              <h3>
                ${this.selectedCompetitor.isClient ? '★ ' : ''}${this
                  .selectedCompetitor.name}
              </h3>
              <div class="rating-row">
                ${this.selectedCompetitor.rating != null
                  ? html`<span class="stars"
                        >${this.selectedCompetitor.rating}★</span
                      >
                      <span class="reviews"
                        >${this.selectedCompetitor.reviews != null
                          ? `${this.selectedCompetitor.reviews} reviews`
                          : 'no review count'}</span
                      >`
                  : html`<span class="reviews">No rating</span>`}
                ${this.selectedCompetitor.rank
                  ? html`<span class="rank-badge"
                      >Result #${this.selectedCompetitor.rank}</span
                    >`
                  : ''}
              </div>
              ${this.selectedCompetitor.category
                ? html`<div class="card-cat">
                    ${this.selectedCompetitor.category}
                  </div>`
                : ''}
              ${this.selectedCompetitor.address
                ? html`<div class="card-addr">
                    ${this.selectedCompetitor.address}
                  </div>`
                : ''}
              ${this.selectedCompetitor.phone
                ? html`<div class="card-phone">
                    ${this.selectedCompetitor.phone}
                  </div>`
                : ''}
              ${this.selectedCompetitor.hours &&
              this.selectedCompetitor.hours.length
                ? html`<details class="card-hours">
                    <summary>${this.selectedCompetitor.hours[0]}</summary>
                    ${this.selectedCompetitor.hours
                      .slice(1)
                      .map((h) => html`<div>${h}</div>`)}
                  </details>`
                : ''}
              <div class="card-links">
                ${this.selectedCompetitor.url
                  ? html`<a
                      class="card-link"
                      href=${this._href(this.selectedCompetitor.url)}
                      target="_blank"
                      rel="noopener"
                      >Website ↗</a
                    >`
                  : ''}
                ${this.selectedCompetitor.googleMapsUri
                  ? html`<a
                      class="card-link"
                      href=${this.selectedCompetitor.googleMapsUri}
                      target="_blank"
                      rel="noopener"
                      >Google Maps ↗</a
                    >`
                  : ''}
              </div>
            </div>`
          : ''}
      </div>
      <div class="sidebar" role="complementary" aria-labelledby="chat-heading">
        <div class="selector" role="tablist" aria-label="Chat providers">
          <button
            id="geminiTab"
            role="tab"
            aria-selected=${this.selectedChatTab === ChatTab.GEMINI}
            aria-controls="chat-panel"
            class=${classMap({
              'selected-tab': this.selectedChatTab === ChatTab.GEMINI,
            })}
            @click=${() => {
              this.selectedChatTab = ChatTab.GEMINI;
            }}>
            <span id="chat-heading">Gemini</span>
          </button>
          <button
            id="settingsTab"
            role="tab"
            aria-selected=${this.selectedChatTab === ChatTab.SETTINGS}
            aria-controls="settings-panel"
            class=${classMap({
              'selected-tab': this.selectedChatTab === ChatTab.SETTINGS,
            })}
            @click=${() => {
              this.selectedChatTab = ChatTab.SETTINGS;
            }}>
            <span>Settings</span>
          </button>
        </div>
        <div
          id="chat-panel"
          role="tabpanel"
          aria-labelledby="geminiTab"
          class=${classMap({
            'tabcontent': true,
            'showtab': this.selectedChatTab === ChatTab.GEMINI,
          })}>
          <div class="chat-messages" aria-live="polite" aria-atomic="false">
            ${this.messages}
            ${this.competitors.length
              ? html`<div class="chat-competitors" role="region" aria-label="Competitor results">
                  <div class="chat-competitors-head">
                    <span class="cc-title"
                      >📍 ${this.competitors.length} results · ${this
                        .competitorContext}</span
                    >
                    <button
                      class="competitor-close"
                      title="Clear results"
                      aria-label="Clear results"
                      @click=${() => this._clearCompetitors()}>
                      ✕
                    </button>
                  </div>
                  ${this.competitors.map(
                    (c) => html`<button
                      class=${classMap({
                        'competitor-row': true,
                        'is-client': !!c.isClient,
                        'selected': this.selectedCompetitor === c,
                      })}
                      title="Show on map"
                      @click=${() => this._selectCompetitor(c)}>
                      <span class="rank">${c.rank ?? '·'}</span>
                      <span class="cinfo">
                        <span class="cname"
                          >${c.isClient ? '★ ' : ''}${c.name}</span
                        >
                        <span class="cmeta"
                          >${c.rating != null
                            ? `${c.rating}★`
                            : 'No rating'}${c.reviews != null
                            ? ` · ${c.reviews} reviews`
                            : ''}${c.businessStatus === 'CLOSED_TEMPORARILY'
                            ? ' · temporarily closed'
                            : ''}</span
                        >
                      </span>
                      <span class="pin-hint" aria-hidden="true">📍</span>
                    </button>`,
                  )}
                </div>`
              : ''}
            <div id="anchor"></div>
          </div>
          <div class="footer">
            <div
              id="chatStatus"
              aria-live="assertive"
              class=${classMap({'hidden': this.chatState === ChatState.IDLE})}>
              ${this.chatState === ChatState.GENERATING
                ? html`${ICON_BUSY} Generating...`
                : html``}
              ${this.chatState === ChatState.THINKING
                ? html`${ICON_BUSY} Thinking...`
                : html``}
              ${this.chatState === ChatState.EXECUTING
                ? html`${ICON_BUSY} Executing...`
                : html``}
            </div>
            <div
              id="inputArea"
              role="form"
              aria-labelledby="message-input-label">
              <label id="message-input-label" class="hidden"
                >Type your message</label
              >
              <input
                type="text"
                id="messageInput"
                .value=${this.inputMessage}
                @input=${(e: InputEvent) => {
                  this.inputMessage = (e.target as HTMLInputElement).value;
                }}
                @keydown=${(e: KeyboardEvent) => {
                  this.inputKeyDownAction(e);
                }}
                placeholder="Type your message..."
                autocomplete="off"
                aria-labelledby="message-input-label"
                aria-describedby="sendButton-desc" />
              <button
                id="sendButton"
                @click=${() => {
                  this.sendMessageAction();
                }}
                aria-label="Send message"
                aria-describedby="sendButton-desc"
                ?disabled=${this.chatState !== ChatState.IDLE}
                class=${classMap({
                  'disabled': this.chatState !== ChatState.IDLE,
                })}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  height="30px"
                  viewBox="0 -960 960 960"
                  width="30px"
                  fill="currentColor"
                  aria-hidden="true">
                  <path d="M120-160v-240l320-80-320-80v-240l760 320-760 320Z" />
                </svg>
              </button>
              <p id="sendButton-desc" class="hidden"
                >Sends the typed message to the AI.</p
              >
            </div>
          </div>
        </div>
        <div
          id="settings-panel"
          role="tabpanel"
          aria-labelledby="settingsTab"
          class=${classMap({
            'tabcontent': true,
            'showtab': this.selectedChatTab === ChatTab.SETTINGS,
          })}>
          <div class="settings-form">
            <h3>Gemini</h3>
            <label for="set-gemini">Gemini API key</label>
            <input
              id="set-gemini"
              type="password"
              .value=${this.sGeminiKey}
              @input=${(e: InputEvent) => {
                this.sGeminiKey = (e.target as HTMLInputElement).value;
              }}
              placeholder="AIza… (or set it in runtime-keys.ts)"
              autocomplete="off" />

            <h3>Google Maps</h3>
            <label for="set-maps">Maps JavaScript API key</label>
            <input
              id="set-maps"
              type="password"
              .value=${this.sMapsKey}
              @input=${(e: InputEvent) => {
                this.sMapsKey = (e.target as HTMLInputElement).value;
              }}
              placeholder="Maps JavaScript API + Geocoding + Directions + Places"
              autocomplete="off" />

            <div class="settings-actions">
              <button class="save-btn" @click=${() => this._saveSettings()}>
                Save
              </button>
              ${this.settingsSaved
                ? html`<span class="saved-note">Saved ✓</span>`
                : ''}
            </div>
            <p class="settings-hint">
              Stored locally in your browser (localStorage). Sent only to
              Google's APIs. Used by the Gemini agent, the map, and the
              <code>/competitors</code> command. Leave blank to use the keys from
              <code>runtime-keys.ts</code>. Changing the Maps key reloads the page.
            </p>
          </div>
        </div>
      </div>
    </div>`;
  }
}
