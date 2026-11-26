// openapi.json, generated from the same tool registry the REST and MCP routes use.
import { z } from 'zod';
import { TOOLS } from './tools.js';

export function openapi(baseUrl: string) {
  const paths: Record<string, unknown> = {
    '/api/health': { get: { operationId: 'health', summary: 'Health check', responses: { '200': { description: 'OK' } } } },
  };
  for (const t of TOOLS) {
    paths[`/api/tools/${t.name}`] = {
      post: {
        operationId: t.name,
        summary: t.title,
        description: t.description,
        requestBody: { required: true, content: { 'application/json': { schema: z.toJSONSchema(t.input, { io: 'input' }) } } },
        responses: {
          '200': { description: 'Result', content: { 'application/json': { schema: { type: 'object' } } } },
          '400': { description: 'Missing or invalid parameters' },
          '404': { description: 'Unknown project or tool' },
          '429': { description: 'Rate limited' },
        },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Agent Dan facts API',
      version: '0.1.0',
      description: "Checked facts about Dan Stoner's work, served to Agent Dan on Agentplace. Read-only except send_message, which saves a visitor-confirmed message for Dan. Also available as an MCP server at /mcp.",
    },
    servers: [{ url: baseUrl }],
    paths,
  };
}
