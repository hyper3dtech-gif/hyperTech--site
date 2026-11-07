// Avis clients publiés directement ; seule la propriétaire peut les supprimer.
import { json, text, clean, sha, isAdmin, clientIp, listJSON, rateLimit, noStore } from "../../lib/shared.js";
export async function onRequest({ request, env }) {
  if (noStore(env)) return text("Stockage non configuré", 503);
  const kv = env.HT, url = new URL(request.url), m = request.method;
  if (m === "GET") {
    if (url.searchParams.has("admin")) { const ok = await isAdmin(request); return json({ admin: ok }, ok ? 200 : 403); }
    const list = await listJSON(kv, "avis/r/");
    list.sort((a, b) => b.date.localeCompare(a.date));
    return json(list);
  }
  if (m === "POST") {
    let d; try { d = await request.json(); } catch { return text("Demande invalide", 400); }
    if (d.website) return json({ ok: true });
    const name = clean(d.name, 30).replace(/\s+/g, " "), t = clean(d.text, 400).replace(/\s+/g, " "), stars = Math.round(Number(d.stars));
    if (!name || t.length < 3 || !(stars >= 1 && stars <= 5)) return text("Avis incomplet", 400);
    if (/https?:\/\/|www\./i.test(t + name)) return text("Les liens ne sont pas acceptés dans les avis.", 400);
    if (!(await rateLimit(kv, "avis/rl/" + (await sha(clientIp(request) + "hypertech")), 3, 864e5))) return text("Vous avez déjà laissé plusieurs avis aujourd'hui.", 429);
    const now = new Date().toISOString(), id = now.replace(/\D/g, "").slice(0, 14) + Math.random().toString(36).slice(2, 8);
    const review = { id, name, stars, text: t, date: now };
    await kv.put("avis/r/" + id, JSON.stringify(review));
    return json(review, 201);
  }
  if (m === "DELETE") {
    if (!(await isAdmin(request))) return text("Accès refusé", 403);
    const id = url.searchParams.get("id") || "";
    if (!/^[a-z0-9]{10,30}$/i.test(id)) return text("Avis inconnu", 400);
    await kv.delete("avis/r/" + id);
    return json({ ok: true });
  }
  return text("Méthode non permise", 405);
}
