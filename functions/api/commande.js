// Commandes : enregistrement, suivi public, gestion par la propriétaire, notification téléphone (ntfy).
import { json, text, clean, sha, isAdmin, clientIp, listJSON, rateLimit, noStore, NTFY_TOPIC } from "../../lib/shared.js";
const ID = /^HT-\d{4}-[A-Z0-9]{6}$/;
const STATUSES = ["recue", "devis", "payee", "impression", "imprimee", "envoyee"];
const chf = n => "CHF " + Number(n).toFixed(2);
const pub = o => ({ id: o.id, created: o.created, quote: o.quote, amount: o.amount, summary: o.summary, steps: o.steps });
async function pushPhone(o, origin, env) {
  const n = (o.files || []).length;
  await fetch("https://ntfy.sh/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
    topic: (env && env.NTFY_TOPIC) || NTFY_TOPIC, title: `Nouvelle commande ${o.id}`, tags: ["package"], priority: 4, click: `${origin}/#suivi`,
    message: `${o.summary || "Commande"} · ${o.quote ? "prix à confirmer" : chf(o.amount) + " à recevoir par TWINT"}${n ? ` · ${n} fichier${n > 1 ? "s" : ""} 3D` : ""}. Ouvrez Mes commandes pour la traiter.` }) });
}
export async function onRequest({ request, env, waitUntil }) {
  if (noStore(env)) return text("Stockage non configuré", 503);
  const kv = env.HT, url = new URL(request.url), m = request.method;
  const id = (url.searchParams.get("id") || "").toUpperCase();
  if (m === "GET") {
    if (url.searchParams.has("all")) {
      if (!(await isAdmin(request))) return text("Accès refusé", 403);
      const list = await listJSON(kv, "cmd/c/");
      list.sort((a, b) => b.created.localeCompare(a.created));
      return json(list);
    }
    if (!ID.test(id)) return text("Numéro de commande invalide", 400);
    const o = await kv.get("cmd/c/" + id, "json");
    return o ? json(pub(o)) : text("Commande introuvable", 404);
  }
  if (m === "POST") {
    let d; try { d = await request.json(); } catch { return text("Demande invalide", 400); }
    const oid = String(d.id || "").toUpperCase();
    if (!ID.test(oid)) return text("Numéro de commande invalide", 400);
    if (await kv.get("cmd/c/" + oid)) return text("Commande déjà enregistrée", 409);
    if (!(await rateLimit(kv, "cmd/rl/" + (await sha(clientIp(request) + "hypertech")), 15, 864e5))) return text("Trop de commandes aujourd'hui.", 429);
    const now = new Date().toISOString();
    const amount = Number(d.amount) > 0 && Number(d.amount) < 10000 ? Math.round(Number(d.amount) * 100) / 100 : null;
    const files = (Array.isArray(d.files) ? d.files : []).slice(0, 10).map(f => clean(f, 200)).filter(f => /^https:\/\//.test(f) || /^http:\/\/localhost/.test(f));
    const o = { id: oid, created: now, quote: !!d.quote, amount, summary: clean(d.summary, 160), name: clean(d.name, 60),
      contact: { email: clean(d.email, 80), phone: clean(d.phone, 30), address: clean(d.address, 200), note: clean(d.note, 300) },
      details: clean(d.full || d.details, 4000), file: files[0] || "", files, steps: [{ s: "recue", at: now }] };
    await kv.put("cmd/c/" + oid, JSON.stringify(o));
    const p = pushPhone(o, url.origin, env).catch(() => {});
    if (waitUntil) waitUntil(p); else await p;
    return json({ ...pub(o), mailed: false }, 201);
  }
  if (m === "PATCH" || m === "DELETE") {
    if (!(await isAdmin(request))) return text("Accès refusé", 403);
    if (!ID.test(id)) return text("Numéro de commande invalide", 400);
    if (m === "DELETE") { await kv.delete("cmd/c/" + id); return json({ ok: true }); }
    const o = await kv.get("cmd/c/" + id, "json");
    if (!o) return text("Commande introuvable", 404);
    let d; try { d = await request.json(); } catch { return text("Demande invalide", 400); }
    if (d.status) {
      if (!STATUSES.includes(d.status)) return text("Étape inconnue", 400);
      const idx = STATUSES.indexOf(d.status), now = new Date().toISOString(), had = Object.fromEntries(o.steps.map(x => [x.s, x.at]));
      o.steps = STATUSES.slice(0, idx + 1).filter(k => o.quote || k !== "devis").map(k => ({ s: k, at: had[k] || now }));
    }
    if (typeof d.amount !== "undefined") { const a = Number(d.amount); if (a > 0 && a < 10000) o.amount = Math.round(a * 100) / 100; }
    await kv.put("cmd/c/" + id, JSON.stringify(o));
    return json(o);
  }
  return text("Méthode non permise", 405);
}
