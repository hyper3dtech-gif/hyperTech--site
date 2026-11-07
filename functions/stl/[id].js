// Téléchargement d'un fichier .stl reçu : /stl/<id>
import { text, noStore } from "../../lib/shared.js";
export async function onRequestGet({ params, env }) {
  if (noStore(env)) return text("Stockage non configuré", 503);
  const id = String(params.id || "");
  if (!/^[a-z0-9-]{16,40}$/i.test(id)) return text("Lien invalide", 400);
  const meta = await env.HT.get(`stl/${id}/meta`, "json");
  if (!meta) return text("Fichier introuvable", 404);
  const parts = [];
  for (let i = 0; i < meta.total; i++) { const c = await env.HT.get(`stl/${id}/${i}`, "arrayBuffer"); if (c) parts.push(new Uint8Array(c)); }
  const ascii = meta.name.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/"/g, "");
  return new Response(new Blob(parts), { headers: { "Content-Type": "model/stl", "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(meta.name)}`, "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" } });
}
