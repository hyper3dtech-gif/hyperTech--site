// Dépôt d'un fichier .stl envoyé avec une demande (morceaux de 4 Mo, 5 au maximum)
import { json, text, noStore } from "../../lib/shared.js";
const ID = /^[a-z0-9-]{16,40}$/i, MAX_PART = 4.5 * 1024 * 1024, MAX_PARTS = 5;
const cleanName = n => { n = String(n || "modele.stl").normalize("NFC").replace(/[^\p{L}\p{N} .()_-]/gu, "_").slice(0, 80).trim() || "modele.stl"; return /\.stl$/i.test(n) ? n : n + ".stl"; };
export async function onRequestPost({ request, env }) {
  if (noStore(env)) return text("Stockage non configuré", 503);
  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "", part = Number(url.searchParams.get("part")), total = Number(url.searchParams.get("total"));
  if (!ID.test(id) || !Number.isInteger(part) || !Number.isInteger(total) || total < 1 || total > MAX_PARTS || part < 0 || part >= total) return text("Demande invalide", 400);
  const buf = await request.arrayBuffer();
  if (!buf.byteLength || buf.byteLength > MAX_PART) return text("Fichier trop lourd", 413);
  const ttl = { expirationTtl: 365 * 86400 };
  await env.HT.put(`stl/${id}/${part}`, buf, ttl);
  if (part === total - 1) await env.HT.put(`stl/${id}/meta`, JSON.stringify({ name: cleanName(url.searchParams.get("name")), total, at: new Date().toISOString() }), ttl);
  return json({ ok: true, url: `${url.origin}/stl/${id}` });
}
