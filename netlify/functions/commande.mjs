// Suivi des commandes : le client voit l'avancement, seule la propriétaire le met à jour.
// POST /api/commande : nouvelle commande · GET /api/commande?id=… : suivi public
// GET /api/commande?all=1 et PATCH /api/commande?id=… : propriétaire (clé)
import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";
import nodemailer from "nodemailer";

const ADMIN_HASH = "763e97bb45af5d11dc35c7d23691359aa60b22b5e02eb9cc44e8e32944cec42d";
const sha = s => createHash("sha256").update(String(s)).digest("hex");
const isAdmin = req => sha(req.headers.get("x-admin-key") || "") === ADMIN_HASH;
const ID = /^HT-\d{4}-[A-Z0-9]{6}$/;
const STATUSES = ["recue", "devis", "payee", "impression", "imprimee", "envoyee"];
const clean = (s, n) => String(s || "").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").trim().slice(0, n);
const pub = o => ({ id: o.id, created: o.created, quote: o.quote, amount: o.amount, summary: o.summary, steps: o.steps, tracking: o.tracking || "" });

// E-mail de confirmation envoyé depuis la boîte Gmail de la boutique (variables GMAIL_USER et GMAIL_APP_PASSWORD dans Netlify)
const escH = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const chf = n => "CHF " + Number(n).toFixed(2);
async function sendConfirmation(o, to, details, origin) {
  const user = process.env.GMAIL_USER, pass = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s/g, "");
  if (!user || !pass || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return false;
  const twint = process.env.TWINT_NUMERO || "+41 79 615 02 03";
  const link = `${origin}/?commande=${o.id}#suivi`;
  const pay = o.quote
    ? "Ne payez pas encore : je vérifie votre demande et je vous envoie le prix exact par e-mail en 24 heures maximum. Vous payerez ensuite par TWINT."
    : `Montant à payer maintenant : ${chf(o.amount)}\nEnvoyez-le par TWINT au ${twint}, avec le message « ${o.id} ». Dès que je reçois votre paiement, je lance l'impression.`;
  const text = `Bonjour ${o.name || ""},\n\nMerci pour votre commande ! Je l'ai bien reçue.\n\nCode de commande : ${o.id}\n\n${pay}\n\nSuivi de votre commande : à tout moment, allez sur le site, dans « Livraison », tout en bas à « Suivre ma commande », et entrez ce code.\nOu ouvrez directement : ${link}\n\nRécapitulatif :\n${details}\n\nÀ bientôt,\nHyper Tech · Impression 3D en Suisse`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#0a0c10;max-width:560px">
    <div style="background:#0a0c10;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;font-weight:bold;font-size:18px">Hyper Tech</div>
    <div style="border:3px solid #0aa6da;border-top:0;border-radius:0 0 12px 12px;padding:20px">
      <p>Bonjour ${escH(o.name || "")},</p><p>Merci pour votre commande ! Je l'ai bien reçue.</p>
      <p>Code de commande : <b style="font-size:18px">${o.id}</b></p>
      ${o.quote
        ? `<p style="background:#e3f6fc;border-radius:10px;padding:12px"><b>Ne payez pas encore.</b> Je vérifie votre demande et je vous envoie le prix exact par e-mail en 24 heures maximum. Vous payerez ensuite par TWINT.</p>`
        : `<div style="background:#5ad1f0;border-radius:10px;padding:14px"><div>Montant à payer maintenant</div><div style="font-size:26px;font-weight:bold">${chf(o.amount)}</div><div>Par TWINT au <b>${escH(twint)}</b>, avec le message « <b>${o.id}</b> ».</div></div><p>Dès que je reçois votre paiement, je lance l'impression.</p>`}
      <p style="border:2px solid #0aa6da;border-radius:10px;padding:10px 12px"><b>Suivi de votre commande :</b> à tout moment, allez sur le site, dans <b>Livraison</b>, tout en bas à « Suivre ma commande », et entrez votre code <b>${o.id}</b>.</p>
      <p><a href="${link}" style="display:inline-block;background:#0a0c10;color:#fff;text-decoration:none;padding:10px 18px;border-radius:99px;font-weight:bold">Suivre ma commande</a></p>
      <p style="font-weight:bold;margin-bottom:4px">Récapitulatif</p><pre style="white-space:pre-wrap;font-family:Arial,sans-serif;font-size:13px;background:#f2f5f7;border-radius:10px;padding:12px;margin:0">${escH(details)}</pre>
      <p>À bientôt,<br>Hyper Tech · Impression 3D en Suisse</p></div></div>`;
  const tr = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
  await tr.sendMail({ from: `"Hyper Tech" <${user}>`, to, replyTo: user, subject: `Votre commande Hyper Tech ${o.id}`, text, html });
  return true;
}

// Notification sur le téléphone de la propriétaire (application gratuite ntfy, abonnement au sujet ci-dessous)
const NTFY_TOPIC = process.env.NTFY_TOPIC || "hypertech-i25s9hj8pplgxx";
async function pushPhone(o, origin) {
  const n = (o.files && o.files.length) || (o.file ? 1 : 0);
  const r = await fetch("https://ntfy.sh/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
    topic: NTFY_TOPIC, title: `Nouvelle commande ${o.id}`, tags: ["package"], priority: 4, click: `${origin}/#suivi`,
    message: `${o.summary || "Commande"} · ${o.quote ? "prix à confirmer" : chf(o.amount) + " à recevoir par TWINT"}${n ? ` · ${n} fichier${n > 1 ? "s" : ""} 3D` : ""}. Ouvrez Mes commandes pour la traiter.`
  }) });
  return r.ok;
}

// Copie de chaque commande dans la boîte de la boutique
async function notifyOwner(o, origin) {
  const user = process.env.GMAIL_USER, pass = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s/g, "");
  if (!user || !pass) return false;
  const c = o.contact || {};
  const text = `Nouvelle commande ${o.id}\nPaiement : ${o.quote ? "après confirmation du prix (à envoyer au client)" : "TWINT immédiat, " + chf(o.amount)}\n\nClient : ${o.name}\nE-mail : ${c.email}\nTéléphone : ${c.phone}\nAdresse : ${c.address}${c.note ? "\nRemarque : " + c.note : ""}\n${(o.files && o.files.length ? o.files : o.file ? [o.file] : []).map((f, i, l) => "\nFichier 3D" + (l.length > 1 ? " " + (i + 1) : "") + " : " + f).join("")}\n\n${o.details}\n\nGérer la commande : ${origin}/#suivi`;
  const tr = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
  await tr.sendMail({ from: `"Site Hyper Tech" <${user}>`, to: user, replyTo: c.email || user, subject: `Nouvelle commande ${o.id} · ${o.name}${o.quote ? " · sur devis" : " · " + chf(o.amount)}`, text });
  return true;
}

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
    const o = { id: oid, created: now, quote: !!d.quote, amount, summary: clean(d.summary, 160), name: clean(d.name, 60), contact: { email: clean(d.email, 80), phone: clean(d.phone, 30), address: clean(d.address, 200), note: clean(d.note, 300) }, details: clean(d.full || d.details, 4000), file: clean(d.file, 200), files: (Array.isArray(d.files) ? d.files : []).slice(0, 10).map(f => clean(f, 200)).filter(f => /^https:\/\//.test(f) || /^http:\/\/localhost/.test(f)), steps: [{ s: "recue", at: now }], tracking: "" };
    await store.setJSON("c/" + oid, o);
    const mailed = await sendConfirmation(o, String(d.email || "").trim(), clean(d.details, 3000), url.origin).catch(() => false);
    await notifyOwner(o, url.origin).catch(() => false);
    await pushPhone(o, url.origin).catch(() => false);
    return Response.json({ ...pub(o), mailed }, { status: 201 });
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
