// Suivi des commandes : le client voit l'avancement, seule la propriétaire le met à jour.
// POST /api/commande : nouvelle commande · GET /api/commande?id=… : suivi public
// GET /api/commande?all=1 et PATCH /api/commande?id=… : propriétaire (clé)
import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

const ADMIN_HASH = "249446e8fe1724ac963d3352be1d4e1bcd5a535163b3ae7061614e93946269cb";
const sha = s => createHash("sha256").update(String(s)).digest("hex");
const isAdmin = req => sha(req.headers.get("x-admin-key") || "") === ADMIN_HASH;
const ID = /^HT-\d{4}-[A-Z0-9]{6}$/;
const STATUSES = ["recue", "devis", "payee", "impression", "imprimee", "envoyee"];
const clean = (s, n) => String(s || "").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").trim().slice(0, n);
const contactKey = (mail, tel) => { const m = String(mail || "").trim().toLowerCase(), t = String(tel || "").replace(/\D/g, "").replace(/^(00)?41/, "0"); return m && t.length >= 9 ? sha(m + "|" + t + "|hypertech") : ""; };
const pub = o => ({ id: o.id, created: o.created, quote: o.quote, amount: o.amount, summary: o.summary, steps: o.steps, tracking: o.tracking || "" });

export default async (req, context) => {
  const store = getStore("commandes");
  const url = new URL(req.url);
  const id = (url.searchParams.get("id") || "").toUpperCase();

  if (req.method === "GET") {
    if (url.searchParams.has("all")) {
      if (!isAdmin(req)) return new Response("Accès refusé", { status: 403 });
      const { blobs } = await store.list({ prefix: "c/" });
      const list = (await Promise.all(blobs.map(b => store.get(b.key, { type: "json" })))).filter(Boolean);
      list.sort((a, b) => b.created.localeCompare(a.created));
      return Response.json(list, { headers: { "Cache-Control": "no-store" } });
    }
    if (!ID.test(id)) return new Response("Numéro de commande invalide", { status: 400 });
    const o = await store.get("c/" + id, { type: "json" });
    if (!o) return new Response("Commande introuvable", { status: 404 });
    return Response.json(pub(o), { headers: { "Cache-Control": "no-store" } });
  }

  if (req.method === "POST" && url.searchParams.has("find")) {
    let d; try { d = await req.json(); } catch { return new Response("Demande invalide", { status: 400 }); }
    const key = contactKey(d.email, d.phone);
    if (!key) return new Response("Indiquez votre e-mail et votre téléphone.", { status: 400 });
    const who = sha((context.ip || "?") + "find");
    const rl = ((await store.get("rf/" + who, { type: "json" })) || []).filter(t => t > Date.now() - 36e5);
    if (rl.length >= 10) return new Response("Trop de recherches : réessayez dans une heure.", { status: 429 });
    await store.setJSON("rf/" + who, rl.concat(Date.now()));
    const { blobs } = await store.list({ prefix: "c/" });
    const list = (await Promise.all(blobs.map(b => store.get(b.key, { type: "json" })))).filter(o => o && o.ck === key);
    list.sort((a, b) => b.created.localeCompare(a.created));
    return Response.json(list.map(pub));
  }

  if (req.method === "POST") {
    let d; try { d = await req.json(); } catch { return new Response("Demande invalide", { status: 400 }); }
    const oid = String(d.id || "").toUpperCase();
    if (!ID.test(oid)) return new Response("Numéro de commande invalide", { status: 400 });
    if (await store.get("c/" + oid)) return new Response("Commande déjà enregistrée", { status: 409 });
    const who = sha((context.ip || "?") + "hypertech");
    const rl = (await store.get("rl/" + who, { type: "json" })) || [];
    const recent = rl.filter(t => t > Date.now() - 864e5);
    if (recent.length >= 15) return new Response("Trop de commandes aujourd'hui.", { status: 429 });
    await store.setJSON("rl/" + who, recent.concat(Date.now()));
    const now = new Date().toISOString();
    const amount = Number(d.amount) > 0 && Number(d.amount) < 10000 ? Math.round(Number(d.amount) * 100) / 100 : null;
    const o = { id: oid, created: now, quote: !!d.quote, amount, summary: clean(d.summary, 160), name: clean(d.name, 60), ck: contactKey(d.email, d.phone), steps: [{ s: "recue", at: now }], tracking: "" };
    await store.setJSON("c/" + oid, o);
    return Response.json(pub(o), { status: 201 });
  }

  if (req.method === "PATCH") {
    if (!isAdmin(req)) return new Response("Accès refusé", { status: 403 });
    if (!ID.test(id)) return new Response("Numéro de commande invalide", { status: 400 });
    const o = await store.get("c/" + id, { type: "json" });
    if (!o) return new Response("Commande introuvable", { status: 404 });
    let d; try { d = await req.json(); } catch { return new Response("Demande invalide", { status: 400 }); }
    if (d.status) {
      if (!STATUSES.includes(d.status)) return new Response("Étape inconnue", { status: 400 });
      const idx = STATUSES.indexOf(d.status);
      const now = new Date().toISOString(), had = Object.fromEntries(o.steps.map(x => [x.s, x.at]));
      o.steps = STATUSES.slice(0, idx + 1).filter(k => o.quote || k !== "devis").map(k => ({ s: k, at: k === d.status && !had[k] ? now : (had[k] || now) }));
    }
    if (typeof d.tracking === "string") o.tracking = clean(d.tracking, 40);
    if (typeof d.amount !== "undefined") { const a = Number(d.amount); o.amount = a > 0 && a < 10000 ? Math.round(a * 100) / 100 : o.amount; }
    await store.setJSON("c/" + id, o);
    return Response.json(o);
  }

  if (req.method === "DELETE") {
    if (!isAdmin(req)) return new Response("Accès refusé", { status: 403 });
    if (!ID.test(id)) return new Response("Numéro de commande invalide", { status: 400 });
    await store.delete("c/" + id);
    return Response.json({ ok: true });
  }
  return new Response("Méthode non permise", { status: 405 });
};

export const config = { path: "/api/commande" };
