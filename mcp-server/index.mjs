#!/usr/bin/env node
// gikai MCP — stdio 版（小川個人用）。
//
// ツール定義は site/src/lib/mcp/tools.mjs に集約されており、
// HTTP 配布版（site/src/app/api/mcp/route.ts）と共通化されている。
//
// この stdio 版は restricted index（札幌市等）を読み込む。
// stdio で個人の Claude Code/Desktop に返す MCP は著作権30条の私的使用の範囲。
// 配布版（HTTP）は restricted を読まないことで法的整理を維持している。

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerTools } from "../site/src/lib/mcp/tools.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "site", "data");
const RESTRICTED_INDEX_PATH = path.join(__dirname, "_restricted-index.json");

const server = new McpServer({ name: "gikai", version: "0.2.0" });
registerTools(server, {
  dataDir: DATA_DIR,
  restrictedIndexPath: RESTRICTED_INDEX_PATH,
});

const transport = new StdioServerTransport();
await server.connect(transport);
