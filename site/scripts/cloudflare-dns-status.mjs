import dns from "node:dns/promises";
import { spawnSync } from "node:child_process";

import {
  checkUrlVerificationStamp,
  checkPreflightStamp,
} from "./cloudflare-preflight-stamp.mjs";

const DEFAULT_DOMAIN = "chihougikai.com";
const DEFAULT_WORKERS_URL = "https://chihougikai-com.yohei-218.workers.dev";
const DEFAULT_CLOUDFLARE_NAMESERVERS = [
  "adi.ns.cloudflare.com",
  "david.ns.cloudflare.com",
];
const DEFAULT_PUBLIC_RESOLVERS = [
  ["cloudflare", "1.1.1.1"],
  ["google", "8.8.8.8"],
];
const VERCEL_NS_RE = /(^|\.)vercel-dns\.com$/i;
const CLOUDFLARE_NS_RE = /(^|\.)cloudflare\.com$/i;
const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);
const FETCH_ATTEMPTS = Number(process.env.CLOUDFLARE_DNS_STATUS_ATTEMPTS ?? "3");
const FETCH_RETRY_DELAY_MS = Number(process.env.CLOUDFLARE_DNS_STATUS_RETRY_DELAY_MS ?? "3000");
const FETCH_TIMEOUT_MS = Number(process.env.CLOUDFLARE_DNS_STATUS_FETCH_TIMEOUT_MS ?? "15000");
const WRANGLER_TIMEOUT_MS = Number(process.env.CLOUDFLARE_DNS_STATUS_WRANGLER_TIMEOUT_MS ?? "20000");

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function normalizeHost(value) {
  return String(value ?? "").trim().replace(/\.$/, "").toLowerCase();
}

async function resolveRecords(label, resolver) {
  try {
    const values = await resolver();
    return { ok: true, values: values.map(normalizeHost).sort() };
  } catch (error) {
    return {
      ok: false,
      values: [],
      error: error instanceof Error ? error.message : String(error),
      label,
    };
  }
}

async function resolveNsWithServer(label, domain, server) {
  const resolver = new dns.Resolver();
  resolver.setServers([server]);
  return resolveRecords(label, () => resolver.resolveNs(domain));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchStatus(url) {
  let lastResult;

  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    lastResult = await fetchStatusOnce(url);
    const shouldRetry =
      !lastResult.ok || RETRYABLE_STATUSES.has(lastResult.status);
    if (!shouldRetry || attempt === FETCH_ATTEMPTS) {
      return lastResult;
    }

    await wait(FETCH_RETRY_DELAY_MS * attempt);
  }

  return lastResult;
}

async function fetchStatusOnce(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
    });
    await response.body?.cancel().catch(() => undefined);
    return {
      ok: true,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      server: response.headers.get("server") ?? "",
      cfRay: response.headers.get("cf-ray") ?? "",
      xRobotsTag: response.headers.get("x-robots-tag") ?? "",
      location: response.headers.get("location") ?? "",
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function wranglerDeploymentStatus() {
  const result = spawnSync(
    "npx",
    ["wrangler", "deployments", "status", "--config", "wrangler.jsonc"],
    { encoding: "utf8", timeout: WRANGLER_TIMEOUT_MS }
  );
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}${result.error ? `\n${result.error.message}` : ""}`.trim(),
  };
}

function zoneStatusHint(nsValues) {
  if (nsValues.some((record) => CLOUDFLARE_NS_RE.test(record))) {
    return "cloudflare_nameservers";
  }
  if (nsValues.some((record) => VERCEL_NS_RE.test(record))) {
    return "vercel_nameservers";
  }
  if (nsValues.length > 0) {
    return "other_nameservers";
  }
  return "unknown";
}

function publicResolverStatus(records) {
  if (records.some((record) => zoneStatusHint(record.values) === "cloudflare_nameservers")) {
    return "cloudflare_nameservers";
  }
  if (records.some((record) => zoneStatusHint(record.values) === "vercel_nameservers")) {
    return "vercel_nameservers";
  }
  if (records.some((record) => record.values.length > 0)) {
    return "other_nameservers";
  }
  return "unknown";
}

async function main() {
  const domain = getArgValue("--domain") ?? DEFAULT_DOMAIN;
  const workersUrl = getArgValue("--workers-url") ?? DEFAULT_WORKERS_URL;
  const cloudflareNameservers = (
    getArgValue("--cloudflare-ns") ?? DEFAULT_CLOUDFLARE_NAMESERVERS.join(",")
  )
    .split(",")
    .map(normalizeHost)
    .filter(Boolean)
    .sort();
  const productionUrl = `https://${domain}`;
  const wwwUrl = `https://www.${domain}`;

  const [ns, apexA, apexCname, wwwCname, production, www, workers, ...publicNs] = await Promise.all([
    resolveRecords("NS", () => dns.resolveNs(domain)),
    resolveRecords("A", () => dns.resolve4(domain)),
    resolveRecords("CNAME", () => dns.resolveCname(domain)),
    resolveRecords("www CNAME", () => dns.resolveCname(`www.${domain}`)),
    fetchStatus(productionUrl),
    fetchStatus(wwwUrl),
    fetchStatus(workersUrl),
    ...DEFAULT_PUBLIC_RESOLVERS.map(([label, server]) =>
      resolveNsWithServer(`${label} NS`, domain, server).then((result) => ({
        ...result,
        resolver_label: label,
        resolver_server: server,
        nameserver_status: zoneStatusHint(result.values),
      }))
    ),
  ]);
  const deployment = wranglerDeploymentStatus();
  const preflight = checkPreflightStamp();
  const verifiedProduction = checkUrlVerificationStamp(preflight, { allowLocal: false });
  const nameserverStatus = zoneStatusHint(ns.values);
  const publicNameserverStatus = publicResolverStatus(publicNs);
  const missingCloudflareNameservers = cloudflareNameservers.filter(
    (record) => !ns.values.includes(record)
  );
  const status = {
    domain,
    production_url: productionUrl,
    www_url: wwwUrl,
    workers_url: workersUrl,
    nameserver_status: nameserverStatus,
    target_cloudflare_ns: cloudflareNameservers,
    ns: {
      ok: ns.ok,
      values: ns.values,
      error: ns.error ?? null,
      missing_target_values: missingCloudflareNameservers,
    },
    public_resolver_ns: publicNs.map((record) => ({
      resolver_label: record.resolver_label,
      resolver_server: record.resolver_server,
      nameserver_status: record.nameserver_status,
      ok: record.ok,
      values: record.values,
      error: record.error ?? null,
    })),
    public_nameserver_status: publicNameserverStatus,
    apex_a: {
      ok: apexA.ok,
      values: apexA.values,
      error: apexA.error ?? null,
    },
    apex_cname: {
      ok: apexCname.ok,
      values: apexCname.values,
      error: apexCname.error ?? null,
    },
    www_cname: {
      ok: wwwCname.ok,
      values: wwwCname.values,
      error: wwwCname.error ?? null,
    },
    urls: {
      production,
      www,
      workers,
    },
    worker_deployment: {
      ok: deployment.ok,
      output: deployment.output,
    },
    verified_deploy_url: verifiedProduction.ok
      ? verifiedProduction.verification.base_url
      : null,
    ready_for_production_verification:
      nameserverStatus === "cloudflare_nameservers" &&
      production.ok &&
      production.server.toLowerCase().includes("cloudflare"),
  };

  if (hasFlag("--json")) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  console.log("Cloudflare DNS status");
  console.log(`- domain: ${domain}`);
  console.log(`- workers URL: ${workersUrl}`);
  console.log(`- nameserver status: ${nameserverStatus}`);
  console.log(`- public resolver nameserver status: ${publicNameserverStatus}`);
  console.log(`- target Cloudflare NS: ${cloudflareNameservers.join(", ")}`);
  console.log(`- NS: ${ns.ok ? ns.values.join(", ") || "(none)" : `lookup failed (${ns.error})`}`);
  for (const record of publicNs) {
    console.log(
      `- ${record.resolver_label} NS: ${
        record.ok ? record.values.join(", ") || "(none)" : `lookup failed (${record.error})`
      }`
    );
  }
  if (missingCloudflareNameservers.length > 0) {
    console.log(`- missing target NS: ${missingCloudflareNameservers.join(", ")}`);
  }
  console.log(`- apex A: ${apexA.ok ? apexA.values.join(", ") || "(none)" : `lookup failed (${apexA.error})`}`);
  console.log(`- apex CNAME: ${apexCname.ok ? apexCname.values.join(", ") || "(none)" : "(none)"}`);
  console.log(`- www CNAME: ${wwwCname.ok ? wwwCname.values.join(", ") || "(none)" : "(none)"}`);
  console.log(`- ${productionUrl}: ${production.ok ? `${production.status} ${production.server}`.trim() : `failed (${production.error})`}`);
  console.log(`- ${wwwUrl}: ${www.ok ? `${www.status} ${www.server}`.trim() : `failed (${www.error})`}`);
  console.log(`- ${workersUrl}: ${workers.ok ? `${workers.status} ${workers.server}`.trim() : `failed (${workers.error})`}`);
  console.log(`- Worker deployment: ${deployment.ok ? "ok" : "not ready"}`);
  if (deployment.output) {
    const versionLine = deployment.output
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("Version(s):") || line.startsWith("Created:"));
    if (versionLine) console.log(`- Worker deployment detail: ${versionLine}`);
  }
  if (verifiedProduction.ok) {
    console.log(`- verified deploy URL: ${verifiedProduction.verification.base_url}`);
  } else {
    console.log("- verified deploy URL: not ready for production-host verification");
  }

  console.log("");
  if (status.ready_for_production_verification) {
    console.log("Next:");
    console.log("  npm run cf:finalize-production");
  } else if (publicNameserverStatus === "cloudflare_nameservers") {
    console.log("Next:");
    console.log("  Public resolvers have Cloudflare nameservers, but this environment is still not ready for production verification.");
    console.log("  1. Re-run: npm run cf:finalize-production");
    console.log(`  2. It will verify ${productionUrl} after the local resolver also reaches Cloudflare.`);
  } else {
    console.log("Next:");
    console.log("  Cloudflare zone and Worker routes are prepared; public DNS is still propagating.");
    console.log(`  1. Wait until NS becomes: ${cloudflareNameservers.join(", ")}`);
    console.log("  2. Re-run: npm run cf:finalize-production");
    console.log(`  3. It will verify ${productionUrl} automatically after propagation.`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
