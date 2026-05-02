import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "../../mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StdioClientTransport } from "../../mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SERVER_PATH = path.join(REPO_ROOT, "mcp-server", "index.mjs");
const MUNICIPALITIES_PATH = path.join(REPO_ROOT, "site", "data", "municipalities.json");

let municipalitiesBySlug;

async function withClient(run) {
  const client = new Client({ name: "gikai-cli", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: "node",
    args: [SERVER_PATH],
    cwd: REPO_ROOT,
    stderr: "inherit",
  });

  try {
    await client.connect(transport);
    return await run(client);
  } finally {
    await transport.close();
  }
}

function parseToolText(result) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) {
    throw new Error("MCP tool returned no text content");
  }
  return JSON.parse(text);
}

export function getRepoRoot() {
  return REPO_ROOT;
}

export function getMunicipalityName(slug) {
  if (!municipalitiesBySlug) {
    const list = JSON.parse(fs.readFileSync(MUNICIPALITIES_PATH, "utf8"));
    municipalitiesBySlug = new Map(list.map((item) => [item.slug, item.name]));
  }
  return municipalitiesBySlug.get(slug) ?? slug;
}

export async function listTools() {
  return withClient(async (client) => {
    const result = await client.listTools();
    return result.tools.map((tool) => tool.name);
  });
}

export async function searchMinutes(args) {
  return withClient(async (client) => {
    const result = await client.callTool({
      name: "search_minutes",
      arguments: args,
    });
    return parseToolText(result);
  });
}
