import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: siteRoot,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });

  if (result.status !== 0) {
    if (options.capture) {
      process.stderr.write(result.stderr ?? "");
      process.stdout.write(result.stdout ?? "");
    }
    process.exit(result.status ?? 1);
  }

  return result.stdout ?? "";
}

function readDnsStatus() {
  const output = run("node", ["scripts/cloudflare-dns-status.mjs", "--json"], {
    capture: true,
  });
  return JSON.parse(output);
}

const status = readDnsStatus();
const productionServer = status.urls.production.ok
  ? status.urls.production.server.toLowerCase()
  : "";
const productionIsCloudflare = productionServer.includes("cloudflare");

if (!status.ready_for_production_verification) {
  console.log("Cloudflare production cutover is not ready yet.");
  console.log(`- nameserver status: ${status.nameserver_status}`);
  console.log(`- public resolver nameserver status: ${status.public_nameserver_status}`);
  console.log(`- current NS: ${status.ns.values.join(", ") || "(none)"}`);
  console.log(`- target NS: ${status.target_cloudflare_ns.join(", ")}`);
  console.log(`- production URL: ${status.urls.production.ok ? `${status.urls.production.status} ${status.urls.production.server}`.trim() : `failed (${status.urls.production.error})`}`);
  console.log(`- workers URL: ${status.urls.workers.ok ? `${status.urls.workers.status} ${status.urls.workers.server}`.trim() : `failed (${status.urls.workers.error})`}`);
  if (status.public_nameserver_status === "cloudflare_nameservers" && !productionIsCloudflare) {
    console.log("- note: public resolvers have Cloudflare nameservers, but this environment still reaches Vercel.");
  }
  console.log("");
  console.log("Next local command:");
  console.log("  npm run cf:finalize-production");
  process.exit(0);
}

console.log("Cloudflare nameservers are active. Verifying the production host...");
run("npm", [
  "run",
  "cf:verify-url",
  "--",
  "--base",
  status.production_url,
  "--allow-production-host",
]);

console.log("");
console.log("Checking release gate after production verification...");
run("npm", ["run", "cf:release-status"]);

console.log("");
console.log("Refreshing DNS status...");
run("npm", ["run", "cf:dns-status"]);

console.log("");
console.log("Production cutover verification passed.");
console.log("Keep Vercel rollback available until Cloudflare metrics and Search Console look stable.");
