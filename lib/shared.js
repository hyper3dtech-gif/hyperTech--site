// Outils communs aux fonctions Cloudflare Pages (stockage : espace KV lié sous le nom HT)
export const ADMIN_HASH = "763e97bb45af5d11dc35c7d23691359aa60b22b5e02eb9cc44e8e32944cec42d";   // empreinte SHA-256 du mot de passe propriétaire
export const NTFY_TOPIC = "hypertech-i25s9hj8pplgxx";
export async function sha(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s)));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}
export const isAdmin = async req => (await sha(req.headers.get("x-admin-key") || "")) === ADMIN_HASH;
export const clientIp = req => req.headers.get("CF-Connecting-IP") || "?";
export const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
export const text = (t, status = 200) => new Response(t, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
export const clean = (s, n) => String(s || "").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").trim().slice(0, n);
export async function listJSON(kv, prefix) {
  const out = []; let cursor;
  do {
    const r = await kv.list({ prefix, cursor });
    const vals = await Promise.all(r.keys.map(k => kv.get(k.name, "json")));
    vals.forEach(v => v && out.push(v));
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return out;
}
export async function rateLimit(kv, key, max, windowMs) {
  const now = Date.now();
  const arr = ((await kv.get(key, "json")) || []).filter(t => t > now - windowMs);
  if (arr.length >= max) return false;
  await kv.put(key, JSON.stringify(arr.concat(now)), { expirationTtl: Math.max(60, Math.ceil(windowMs / 1000) + 60) });
  return true;
}
export function noStore(env) { return !env || !env.HT; }
