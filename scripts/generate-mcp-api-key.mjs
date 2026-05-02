#!/usr/bin/env node

import crypto from "node:crypto";

const countArg = process.argv[2];
const count = countArg ? Number.parseInt(countArg, 10) : 1;

if (!Number.isInteger(count) || count <= 0) {
  console.error("usage: node scripts/generate-mcp-api-key.mjs [count]");
  process.exit(1);
}

for (let i = 0; i < count; i += 1) {
  const token = `gkmcp_${crypto.randomBytes(32).toString("hex")}`;
  console.log(token);
}
