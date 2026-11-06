// Avis clients publiés directement ; seule la propriétaire peut les supprimer.
// GET /api/avis : liste · POST /api/avis : nouvel avis · DELETE /api/avis?id=… (clé propriétaire)
import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

const ADMIN_HASH = "249446e8fe1724ac963d3352be1d4e1bcd5a535163b3ae7061614e93946269cb";   // empreinte SHA-256 du mot de passe propriétaire
const sha = s => createHash("sha256").update(String(s)).digest("hex");
const isAdmin = req => sha(req.headers.get("x-admin-key") || "") === ADMIN_HASH;
const clean = (s, n) => String(s || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

export default async (req, context) => {
  const store = getStore("avis");
  const url = new URL(req.url);

  if (req.method === "GET") {
    if (url.searchParams.has("admin")) return Response.json({ admin: isAdmin(req) }, { status: isAdmin(req) ? 200 : 403 });
    const { blobs } = await store.list({ prefix: "r/" });
    const list = (await Promise.all(blobs.map(b => store.get(b.key, { type: "json" })))).filter(Boolean);
    list.sort((a, b) => b.date.localeCompare(a.date));
    return Response.json(list, { headers: { "Cache-Control": "no-store" } });
  }

  if (req.method === "POST") {
    let d; try { d = await req.json(); } catch { return new Response("Demande invalide", { status: 400 }); }
    if (d.website) return Response.json({ ok: true });                       // robot (champ piège rempli)
    const name = clean(d.name, 30), text = clean(d.text, 400), stars = Math.round(Number(d.stars));
    if (!name || text.length < 3 || !(stars >= 1 && stars <= 5)) return new Response("Avis incomplet", { status: 400 });
    if (/https?:\/\/|www\./i.test(text + name)) return new Response("Les liens ne sont pas acceptés dans les avis.", { status: 400 });
    const who = sha((context.ip || req.headers.get("x-nf-client-connection-ip") || "?") + "hypertech");
    const rl = (await store.get("rl/" + who, { type: "json" })) || [];
    const day = Date.now() - 864e5, recent = rl.filter(t => t > day);
    if (recent.length >= 3) return new Response("Vous avez déjà laissé plusieurs avis aujourd'hui.", { status: 429 });
    await store.setJSON("rl/" + who, recent.concat(Date.now()));
    const now = new Date().toISOString(), id = now.replace(/\D/g, "").slice(0, 14) + Math.random().toString(36).slice(2, 8);
    const review = { id, name, stars, text, date: now };
    await store.setJSON("r/" + id, review);
    return Response.json(review, { status: 201 });
  }

  if (req.method === "DELETE") {
    if (!isAdmin(req)) return new Response("Accès refusé", { status: 403 });
    const id = url.searchParams.get("id") || "";
    if (!/^[a-z0-9]{10,30}$/i.test(id)) return new Response("Avis inconnu", { status: 400 });
    await store.delete("r/" + id);
    return Response.json({ ok: true });
  }
  return new Response("Méthode non permise", { status: 405 });
};

export const config = { path: "/api/avis" };
