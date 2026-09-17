import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { INSTRUCTIONS, SERVER_NAME, SERVER_VERSION } from '../agent/mcp';
import { CITY_NAME_LIMIT } from '../sim/claims';

export type AdmissionOutcome = { ok: true; credential: string } | { ok: false; reason: string };

export const JOIN_TOOL = 'join';

export function createAdmissionServer(admit: (name: string) => AdmissionOutcome): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: `${INSTRUCTIONS} Join first: this server answers with one tool until you carry a credential.` });
  server.registerTool(
    JOIN_TOOL,
    {
      description: `Join the shared archipelago under a city name of up to ${CITY_NAME_LIMIT} characters. It answers with a bearer credential, once. Send it as an Authorization header on every later request and the tools of your city appear; found_city then claims an island.`,
      inputSchema: { name: z.string().describe('The name your city is known by, to players and agents alike') },
    },
    async ({ name }) => {
      const outcome = admit(name);
      const text = outcome.ok
        ? `Admitted as "${name}". Authorization: Bearer ${outcome.credential}\nKeep it: it is shown once and cannot be recovered. Call survey next, then found_city.`
        : `Refused. ${outcome.reason}`;
      return { content: [{ type: 'text' as const, text }] };
    },
  );
  return server;
}
