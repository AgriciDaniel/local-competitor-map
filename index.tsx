/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * This is the main entry point for the application.
 * It sets up the LitElement-based MapApp component, initializes the Google GenAI
 * client for chat interactions, and establishes communication between the
 * Model Context Protocol (MCP) client and server. The MCP server exposes
 * map-related tools that the AI model can use, and the client relays these
 * tool calls to the server.
 */

import {GoogleGenAI, mcpToTool} from '@google/genai';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {ChatState, MapApp, marked} from './map_app'; // Updated import path

import {startMcpGoogleMapServer} from './mcp_maps_server';
import {getSettings, AppSettings} from './settings';

/* --------- */

async function startClient(transport: Transport) {
  const client = new Client({name: 'AI Studio', version: '1.0.0'});
  await client.connect(transport);
  return client;
}

/* ------------ */

const SYSTEM_INSTRUCTIONS = `You are a local business and competitor intelligence assistant working with an interactive photorealistic 3D map. You help users discover, list, and compare businesses and their competitors.

You have three tools. Choosing the RIGHT one matters:

1. 'find_local_competitors' — THE PRIMARY TOOL. Use it for ANY request to find, show, list, rank, or compare MULTIPLE businesses, or a whole CATEGORY of businesses, in an area, or the competitors of a specific business. It searches Google Maps and plots every result as a clickable pin with ratings and reviews.
   *   Use it for: "top 10 plumbers in New York", "best coffee shops in Austin", "show me gyms near downtown Miami", "who competes with Blue Bottle Coffee in San Francisco?", "dentists in Chicago".
   *   Pass a 'client' (a specific business name to highlight, OR the category itself like "plumbers" or "coffee shops") and you MUST pass a 'location' (city/region). Optionally pass a 'keyword' for the category if the client is a specific business.
   *   If no location is given, ask which city or region to search — do NOT guess.
   *   GOOD: "top 10 plumbers in New York" -> find_local_competitors(client: "plumbers", location: "New York, NY").
   *   GOOD: "who competes with Joe's Pizza in Brooklyn?" -> find_local_competitors(client: "Joe's Pizza", location: "Brooklyn, NY").
   *   BAD: calling 'view_location_google_maps' with "top 10 plumbers in New York" — that only drops one pin and is WRONG for category/plural searches.

2. 'view_location_google_maps' — ONLY for navigating to ONE specific, named place, landmark, or address (a single point). Use it for "show me the Eiffel Tower", "take me to Venice, Italy", "where is Machu Picchu". NEVER use it for a category or a plural/"top N" search.

3. 'directions_on_google_maps' — for a route between a specific origin and a specific destination.

General guidelines:
- If the user names a category or asks for multiple/"top N" businesses plus a place, ALWAYS use 'find_local_competitors'. Treating a category as a single location is wrong.
- After a tool runs, give a brief summary (e.g. how the highlighted business ranks, a couple of standouts). The map and the side list already display the full details with ratings and reviews, so do not repeat the entire list.
- If a request is too vague to act on (e.g. "show me something cool"), ask a short clarifying question.`;

function buildAi(apiKey: string) {
  return new GoogleGenAI({apiKey});
}

let ai = buildAi(getSettings().geminiKey);

function createAiChat(mcpClient: Client) {
  return ai.chats.create({
    model: 'gemini-2.5-flash',
    config: {
      systemInstruction: SYSTEM_INSTRUCTIONS,
      tools: [mcpToTool(mcpClient)],
    },
  });
}

/** Turns a tool call into a short, human-friendly chat status line. */
function friendlyToolStatus(name?: string, args?: any): string {
  const n = (name || '').toLowerCase();
  const a = args || {};
  if (n.includes('competitor')) {
    const who = a.client || a.keyword || 'businesses';
    const where = a.location ? ` in ${a.location}` : '';
    return `🔍 Searching Google Maps for **${who}**${where}…`;
  }
  if (n.includes('direction')) {
    return `🧭 Getting directions from **${a.origin}** to **${a.destination}**…`;
  }
  if (n.includes('location') || n.includes('view')) {
    return `📍 Showing **${a.query}** on the map…`;
  }
  return '⚙️ Working on the map…';
}

document.addEventListener('DOMContentLoaded', async (event) => {
  const rootElement = document.querySelector('#root')! as HTMLElement;

  const mapApp = new MapApp();
  rootElement.appendChild(mapApp);

  const [transportA, transportB] = InMemoryTransport.createLinkedPair();

  void startMcpGoogleMapServer(
    transportA,
    (params: {location?: string; origin?: string; destination?: string}) => {
      mapApp.handleMapQuery(params);
    },
    // viaAgent=true: Gemini will narrate the result, so skip the duplicate
    // text summary in chat (the interactive list still renders).
    (params) => mapApp.handleCompetitors(params, true),
  );

  const mcpClient = await startClient(transportB);
  let aiChat = createAiChat(mcpClient);

  // Rebuild the Gemini client/chat when the resolved Gemini key changes after a
  // Settings save, so key changes take effect without a page reload. We read the
  // RESOLVED key (stored value || runtime fallback), not the raw form value.
  let currentGeminiKey = getSettings().geminiKey;
  mapApp.onSettingsSaved = (_s: AppSettings) => {
    const resolved = getSettings().geminiKey;
    if (resolved !== currentGeminiKey) {
      currentGeminiKey = resolved;
      ai = buildAi(resolved);
      aiChat = createAiChat(mcpClient);
    }
  };

  mapApp.sendMessageHandler = async (input: string, role: string) => {
    console.log('sendMessageHandler', input, role);

    const {thinkingElement, textElement, thinkingContainer} = mapApp.addMessage(
      'assistant',
      '',
    );

    mapApp.setChatState(ChatState.GENERATING);
    textElement.innerHTML = '...'; // Initial placeholder

    let newCode = '';
    let thoughtAccumulator = '';
    let toolCalled = false;

    try {
      // Outer try for overall message handling including post-processing
      try {
        // Inner try for AI interaction and message parsing
        const stream = await aiChat.sendMessageStream({message: input});

        for await (const chunk of stream) {
          for (const candidate of chunk.candidates ?? []) {
            for (const part of candidate.content?.parts ?? []) {
              if (part.functionCall) {
                toolCalled = true;
                console.log(
                  'FUNCTION CALL:',
                  part.functionCall.name,
                  part.functionCall.args,
                );
                // Show a clean, human-friendly status instead of a raw JSON dump.
                const status = friendlyToolStatus(
                  part.functionCall.name,
                  part.functionCall.args,
                );
                const {textElement: statusEl} = mapApp.addMessage('system', '');
                statusEl.innerHTML = await marked.parse(status);
              }

              if (part.thought) {
                mapApp.setChatState(ChatState.THINKING);
                thoughtAccumulator += ' ' + part.thought;
                thinkingElement.innerHTML =
                  await marked.parse(thoughtAccumulator);
                if (thinkingContainer) {
                  thinkingContainer.classList.remove('hidden');
                  thinkingContainer.setAttribute('open', 'true');
                }
              } else if (part.text) {
                mapApp.setChatState(ChatState.EXECUTING);
                newCode += part.text;
                textElement.innerHTML = await marked.parse(newCode);
              }
              mapApp.scrollToTheEnd();
            }
          }
        }
      } catch (e: unknown) {
        // Catch for AI interaction errors.
        console.error('GenAI SDK Error:', e);
        let baseErrorText: string;

        if (e instanceof Error) {
          baseErrorText = e.message;
        } else if (typeof e === 'string') {
          baseErrorText = e;
        } else if (
          e &&
          typeof e === 'object' &&
          'message' in e &&
          typeof (e as {message: unknown}).message === 'string'
        ) {
          baseErrorText = (e as {message: string}).message;
        } else {
          try {
            // Attempt to stringify complex objects, otherwise, simple String conversion.
            baseErrorText = `Unexpected error: ${JSON.stringify(e)}`;
          } catch (stringifyError) {
            baseErrorText = `Unexpected error: ${String(e)}`;
          }
        }

        let finalErrorMessage = baseErrorText; // Start with the extracted/formatted base error message.

        // Attempt to parse a JSON object from the baseErrorText, as some SDK errors embed details this way.
        // This is useful if baseErrorText itself is a string containing JSON.
        const jsonStartIndex = baseErrorText.indexOf('{');
        const jsonEndIndex = baseErrorText.lastIndexOf('}');

        if (jsonStartIndex > -1 && jsonEndIndex > jsonStartIndex) {
          const potentialJson = baseErrorText.substring(
            jsonStartIndex,
            jsonEndIndex + 1,
          );
          try {
            const sdkError = JSON.parse(potentialJson);
            let refinedMessageFromSdkJson: string | undefined;

            // Check for common nested error structures (e.g., sdkError.error.message)
            // or a direct message (sdkError.message) in the parsed JSON.
            if (
              sdkError &&
              typeof sdkError === 'object' &&
              sdkError.error && // Check if 'error' property exists and is truthy
              typeof sdkError.error === 'object' && // Check if 'error' property is an object
              typeof sdkError.error.message === 'string' // Check for 'message' string within 'error' object
            ) {
              refinedMessageFromSdkJson = sdkError.error.message;
            } else if (
              sdkError &&
              typeof sdkError === 'object' && // Check if sdkError itself is an object
              typeof sdkError.message === 'string' // Check for a direct 'message' string on sdkError
            ) {
              refinedMessageFromSdkJson = sdkError.message;
            }

            if (refinedMessageFromSdkJson) {
              finalErrorMessage = refinedMessageFromSdkJson; // Update if JSON parsing yielded a more specific message
            }
          } catch (parseError) {
            // If parsing fails, finalErrorMessage remains baseErrorText.
            console.warn(
              'Could not parse potential JSON from error message; using base error text.',
              parseError,
            );
          }
        }

        const {textElement: errorTextElement} = mapApp.addMessage('error', '');
        errorTextElement.innerHTML = await marked.parse(
          `Error: ${finalErrorMessage}`,
        );
      }

      // Post-processing logic (now inside the outer try)
      if (thinkingContainer && thinkingContainer.hasAttribute('open')) {
        if (!thoughtAccumulator) {
          thinkingContainer.classList.add('hidden');
        }
        thinkingContainer.removeAttribute('open');
      }

      if (
        textElement.innerHTML.trim() === '...' ||
        textElement.innerHTML.trim().length === 0
      ) {
        // If a tool ran (e.g. competitor search), the result is shown by the
        // status line + the in-chat list, so drop the empty assistant bubble.
        if (toolCalled) {
          textElement.innerHTML = '';
        } else {
          textElement.innerHTML = await marked.parse('Done.');
        }
      }
    } finally {
      // Finally for the outer try, ensures chat state is reset
      mapApp.setChatState(ChatState.IDLE);
    }
  };
});
