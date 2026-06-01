const REPO_OWNER = process.env.GIKAI_REPO_OWNER ?? "gyawa24";
const REPO_NAME = process.env.GIKAI_REPO_NAME ?? "gikai-map-hokkaido";
const REPO_BRANCH = process.env.GIKAI_REPO_BRANCH ?? "main";
const RAW_BASE = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}`;

export function publicRawUrl(publicPath: string): string {
  if (/^https?:\/\//i.test(publicPath)) return publicPath;

  const normalizedPath = publicPath.startsWith("/") ? publicPath.slice(1) : publicPath;
  return `${RAW_BASE}/site/public/${normalizedPath}`;
}
