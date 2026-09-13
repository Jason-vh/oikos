import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { AgentGame } from './game';
import { TOOLS, type AgentTool } from './tools';

export const SERVER_NAME = 'oikos';
export const SERVER_VERSION = '0.1.0';
export const INSTRUCTIONS = 'Found and run a city on a Greek island. Survey the ground, check a placement before you buy it, connect everything with roads, then ask for time to pass and read the report.';

export function createServer(game: AgentGame, tools: AgentTool[] = TOOLS): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.schema },
      async (args) => ({ content: [{ type: 'text', text: await tool.run(game, args) }] }),
    );
  }
  return server;
}

export async function serveStdio(game: AgentGame): Promise<McpServer> {
  const server = createServer(game);
  await server.connect(new StdioServerTransport());
  return server;
}
