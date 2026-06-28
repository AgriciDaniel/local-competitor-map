/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * This file defines and runs an MCP (Model Context Protocol) server.
 * The server exposes tools that an AI model (like Gemini) can call to interact
 * with Google Maps functionality. These tools include:
 * - `view_location_google_maps`: To display a specific location.
 * - `directions_on_google_maps`: To get and display directions.
 *
 * When the AI decides to use one of these tools, the MCP server receives the
 * call and then uses the `mapQueryHandler` callback to send the relevant
 * parameters (location, origin/destination) to the frontend
 * (MapApp component in map_app.ts) to update the map display.
 */

import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {z} from 'zod';

export interface MapParams {
  location?: string;
  origin?: string;
  destination?: string;
}

export interface CompetitorParams {
  /** Business name or website to analyze and highlight. */
  clientName: string;
  /** City/region, e.g. "Austin, Texas, United States". */
  location?: string;
  /** Optional search keyword/category; defaults to the client term. */
  keyword?: string;
}

export async function startMcpGoogleMapServer(
  transport: Transport,
  /**
   * Callback function provided by the frontend (index.tsx) to handle map updates.
   * This function is invoked when an AI tool call requires a map interaction,
   * passing the necessary parameters to update the map view (e.g., show location,
   * display directions). It is the bridge between MCP server tool execution and
   * the visual map representation in the MapApp component.
   */
  mapQueryHandler: (params: MapParams) => void,
  /**
   * Callback that runs a local-competitor search (via DataForSEO), plots the
   * results on the map, and resolves with a short text summary for the model.
   */
  competitorHandler: (params: CompetitorParams) => Promise<string>,
) {
  // Create an MCP server
  const server = new McpServer({
    name: 'AI Studio Google Map',
    version: '1.0.0',
  });

  server.tool(
    'view_location_google_maps',
    'View a specific query or geographical location and display in the embedded maps interface',
    {query: z.string()},
    async ({query}) => {
      mapQueryHandler({location: query});
      return {
        content: [{type: 'text', text: `Navigating to: ${query}`}],
      };
    },
  );

  server.tool(
    'directions_on_google_maps',
    'Search google maps for directions from origin to destination.',
    {origin: z.string(), destination: z.string()},
    async ({origin, destination}) => {
      mapQueryHandler({origin, destination});
      return {
        content: [
          {type: 'text', text: `Navigating from ${origin} to ${destination}`},
        ],
      };
    },
  );

  server.tool(
    'find_local_competitors',
    'Find and plot MULTIPLE local businesses on the 3D map: either the competitors ' +
      'of a specific business, OR every business in a category (e.g. "plumbers", ' +
      '"coffee shops"), in a given area. Use this for any "find / show / list / top N / ' +
      'best / compare" request about businesses or a category in a location. Always ' +
      'provide a location (city/region). Results come from Google Maps (Places) and ' +
      'are shown as clickable pins with ratings and reviews.',
    {
      client: z
        .string()
        .describe(
          'Either a specific business name to highlight (e.g. "Joe\'s Pizza"), OR a ' +
            'category to search (e.g. "plumbers", "coffee shops").',
        ),
      location: z
        .string()
        .describe(
          'City/region for the search, e.g. "New York, NY" or "Austin, Texas".',
        ),
      keyword: z
        .string()
        .optional()
        .describe(
          'Optional category/keyword to search; defaults to the client term. Use ' +
            'this when client is a specific business and you want its category.',
        ),
    },
    async ({client, location, keyword}) => {
      const summary = await competitorHandler({
        clientName: client,
        location,
        keyword,
      });
      return {
        content: [{type: 'text', text: summary}],
      };
    },
  );

  await server.connect(transport);
  console.log('server running');
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
