const key = "tony-journal-session";
// Keep the legacy key so existing signed-in tabs migrate without another login.
export function readSession() {
  try {
    const token = localStorage.getItem(key) || sessionStorage.getItem(key) || "";
    if (token) { try { localStorage.setItem(key, token); sessionStorage.removeItem(key); } catch {} }
    return /^[a-f0-9]{64}$/.test(token) ? token : "";
  } catch { try { return sessionStorage.getItem(key) || ""; } catch { return ""; } }
}
export function saveSession(token: string) {
  try { localStorage.setItem(key, token); sessionStorage.removeItem(key); }
  catch { try { sessionStorage.setItem(key, token); } catch {} }
}
export function clearSession() {
  try { localStorage.removeItem(key); } catch {}
  try { sessionStorage.removeItem(key); } catch {}
}
export const sessionKey = key;
