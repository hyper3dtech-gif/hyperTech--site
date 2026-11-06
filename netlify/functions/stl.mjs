// Reçoit les fichiers .stl envoyés avec une demande et les rend téléchargeables.
// Dépôt : POST /api/stl?id=…&part=…&total=…&name=…  (morceaux de 4 Mo, 5 au maximum)
// Téléchargement : GET /stl/<id>
import { getStore } from "@netlify/blobs";

const ID = /^[a-z0-9-]{16,40}$/i;
const MAX_PART = 4.5 * 1024 * 1024, MAX_PARTS = 5;

function cleanName(n) {
  n = String(n || "modele.stl").normalize("NFC").replace(/[^\p{L}\p{N} .()_-]/gu, "_").slice(0, 80).trim() || "modele.stl";
  return /\.stl$/i.test(n) ? n : n + ".stl";
}

export default async (req, context) => {
  const url = new URL(req.url);
  const store = getStore("stl");

  if (req.method === "POST") {
    const id = url.searchParams.get("id") || "";
    const part = Number(url.searchParams.get("part")), total = Number(url.searchParams.get("total"));
    if (!ID.test(id) || !Number.isInteger(part) || !Number.isInteger(total) || total < 1 || total > MAX_PARTS || part < 0 || part >= total)
      return new Response("Demande invalide", { status: 400 });
    const buf = await req.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > MAX_PART) return new Response("Fichier trop lourd", { status: 413 });
    await store.set(`${id}/${part}`, buf);
    if (part === total - 1)
      await store.setJSON(`${id}/meta`, { name: cleanName(url.searchParams.get("name")), total, at: new Date().toISOString() });
    return Response.json({ ok: true, url: `${url.origin}/stl/${id}` });
  }

  if (req.method === "GET") {
    const id = (context.params && context.params.id) || url.searchParams.get("id") || "";
    if (!ID.test(id)) return new Response("Lien invalide", { status: 400 });
    const meta = await store.get(`${id}/meta`, { type: "json" });
    if (!meta) return new Response("Fichier introuvable", { status: 404 });
    const body = new ReadableStream({
      async start(ctrl) {
        for (let i = 0; i < meta.total; i++) {
          const chunk = await store.get(`${id}/${i}`, { type: "arrayBuffer" });
          if (chunk) ctrl.enqueue(new Uint8Array(chunk));
        }
        ctrl.close();
      }
    });
    return new Response(body, {
      headers: {
        "Content-Type": "model/stl",
        "Content-Disposition": `attachment; filename="${meta.name.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex"
      }
    });
  }
  return new Response("Méthode non permise", { status: 405 });
};

export const config = { path: ["/api/stl", "/stl/:id"] };
