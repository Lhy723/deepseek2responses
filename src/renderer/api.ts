export function apiUrl(path: string): string {
  const params = new URLSearchParams(window.location.search);
  const apiBase = params.get("apiBase") || import.meta.env.VITE_API_BASE || "";
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return apiBase ? `${apiBase.replace(/\/$/, "")}${normalizedPath}` : normalizedPath;
}

export async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path));
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  if (!contentType.includes("application/json")) {
    const text = await response.text();
    throw new Error(`Expected JSON from ${apiUrl(path)}, got ${contentType || "unknown content-type"}: ${text.slice(0, 80)}`);
  }
  return response.json() as Promise<T>;
}
