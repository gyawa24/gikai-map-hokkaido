const base = (process.env.DATA_LOOP_PREVIEW_LOCAL_BASE_URL ?? "http://localhost:3100").replace(/\/+$/, "");
const password = process.env.POLICY_RESEARCH_ACCESS_PASSWORD;
const failures = [];

const baseUrl = new URL(base);
if (baseUrl.protocol !== "http:" || !["localhost", "127.0.0.1", "::1"].includes(baseUrl.hostname)) {
  console.error("DATA_LOOP_PREVIEW_LOCAL_BASE_URL must remain on local HTTP only.");
  process.exit(1);
}

function check(condition, message) {
  if (!condition) failures.push(message);
}

function checkRestrictedHeaders(response, label) {
  const cacheControl = response.headers.get("cache-control") ?? "";
  const robots = response.headers.get("x-robots-tag") ?? "";
  check(cacheControl.includes("private") && cacheControl.includes("no-store"), `${label}: Cache-Control is not private/no-store.`);
  check(robots.includes("noindex") && robots.includes("nofollow"), `${label}: X-Robots-Tag is not noindex/nofollow.`);
}

if (!password || password.length < 12) {
  console.error("POLICY_RESEARCH_ACCESS_PASSWORD must be provided without printing it.");
  process.exit(1);
}

const previewUrl = `${base}/data-loop-preview`;
const sessionUrl = `${base}/api/research/session`;

const anonymousResponse = await fetch(previewUrl, { redirect: "manual" });
const anonymousHtml = await anonymousResponse.text();
check(anonymousResponse.status === 200, `Anonymous page returned HTTP ${anonymousResponse.status}.`);
checkRestrictedHeaders(anonymousResponse, "anonymous page");
check(anonymousHtml.includes("パスワード付きテスト画面"), "Anonymous page does not show the access gate.");
for (const marker of ["comparison_id", "source_document_id", "budget.poc", "市税"]) {
  check(!anonymousHtml.includes(marker), `Anonymous page leaked protected marker: ${marker}.`);
}

const loginResponse = await fetch(sessionUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password }),
  redirect: "manual",
});
check(loginResponse.status === 200, `Login returned HTTP ${loginResponse.status}.`);
check((loginResponse.headers.get("cache-control") ?? "").includes("no-store"), "Login response is cacheable.");

const setCookie = loginResponse.headers.get("set-cookie") ?? "";
check(setCookie.startsWith("policy_research_session="), "Session cookie was not issued.");
check(/HttpOnly/i.test(setCookie), "Session cookie is not HttpOnly.");
check(/SameSite=Strict/i.test(setCookie), "Session cookie is not SameSite=Strict.");
check(/Path=\//i.test(setCookie), "Session cookie path is not root.");
check(/Secure/i.test(setCookie), "Production session cookie is not Secure.");

const cookie = setCookie.split(";", 1)[0];
const authenticatedResponse = await fetch(previewUrl, {
  headers: { Cookie: cookie },
  redirect: "manual",
});
const authenticatedHtml = await authenticatedResponse.text();
check(authenticatedResponse.status === 200, `Authenticated page returned HTTP ${authenticatedResponse.status}.`);
checkRestrictedHeaders(authenticatedResponse, "authenticated page");
for (const marker of ["canonical facts", "千歳市", "恵庭市", "江別市", "旭川市", "札幌市", "取得・解析状況"]) {
  check(authenticatedHtml.includes(marker), `Authenticated page is missing: ${marker}.`);
}

const logoutResponse = await fetch(sessionUrl, {
  method: "DELETE",
  headers: { Cookie: cookie },
  redirect: "manual",
});
check(logoutResponse.status === 200, `Logout returned HTTP ${logoutResponse.status}.`);
check(/Max-Age=0/i.test(logoutResponse.headers.get("set-cookie") ?? ""), "Logout did not expire the session cookie.");

if (failures.length) {
  console.error(JSON.stringify({ status: "failed", failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  status: "passed",
  base,
  anonymous_data_hidden: true,
  authenticated_preview_visible: true,
  cookie_policy_verified: true,
}, null, 2));
