import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localWrangler = path.join(
  siteRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "wrangler.cmd" : "wrangler"
);

function wranglerCommand() {
  if (fs.existsSync(localWrangler)) {
    return {
      command: localWrangler,
      args: ["whoami"],
    };
  }

  return {
    command: "npx",
    args: ["wrangler", "whoami"],
  };
}

export function checkCloudflareAuth() {
  const { command, args } = wranglerCommand();
  const result = spawnSync(command, args, {
    cwd: siteRoot,
    encoding: "utf8",
    env: process.env,
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  const notAuthenticated = /not authenticated|wrangler login/i.test(output);
  if (result.status === 0 && !notAuthenticated) {
    return {
      ok: true,
      output,
      method: process.env.CLOUDFLARE_API_TOKEN ? "api_token" : "wrangler_login",
    };
  }

  return {
    ok: false,
    output,
    status: result.status,
    error: result.error,
  };
}

export function cloudflareAuthHelpLines() {
  return [
    "Authenticate Cloudflare first:",
    "  npm run cf:login",
    "",
    "For CI or a non-interactive run, provide a least-privilege token:",
    "  CLOUDFLARE_API_TOKEN=... CLOUDFLARE_RELEASE_CONFIRM=upload-and-verify npm run cf:upload-verify",
  ];
}
