// Client/src/lib/adminFetch.ts

const ADMIN_TOKEN_KEY = "flavaai-admin-token";

export function getAdminToken(): string {
  return String(localStorage.getItem(ADMIN_TOKEN_KEY) || "").trim();
}

export function setAdminToken(token: string) {
  localStorage.setItem(ADMIN_TOKEN_KEY, String(token || "").trim());
}

export function clearAdminToken() {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}

export async function adminFetch(url: string, init?: RequestInit) {
  const token = getAdminToken();
  const headers = new Headers(init?.headers || {});

  if (token) headers.set("x-admin-token", token);

  return fetch(url, {
    ...init,
    headers,
  });
}