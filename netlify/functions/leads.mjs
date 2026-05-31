import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers });
}

function authorized(request) {
  const password = process.env.ADMIN_PASSWORD;
  return password && request.headers.get("x-admin-password") === password;
}

export default async (request) => {
  const store = getStore("fechapro-leads");

  if (request.method === "POST") {
    try {
      const { nome = "", whatsapp = "", email = "" } = await request.json();
      const cleanName = String(nome).trim().slice(0, 100);
      const cleanPhone = String(whatsapp).replace(/\D/g, "").slice(0, 11);
      const cleanEmail = String(email).trim().toLowerCase().slice(0, 150);
      if (cleanName.length < 2 || cleanPhone.length < 10 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return json(400, { error: "Preencha nome, WhatsApp e e-mail corretamente." });
      }
      await store.setJSON(`${new Date().toISOString()}-${crypto.randomUUID()}`, {
        id: crypto.randomUUID(),
        nome: cleanName,
        whatsapp: cleanPhone,
        email: cleanEmail,
        createdAt: new Date().toISOString()
      });
      return json(201, { ok: true });
    } catch {
      return json(400, { error: "Não foi possível salvar o cadastro." });
    }
  }

  if (request.method === "GET") {
    if (!authorized(request)) return json(401, { error: "Senha inválida." });
    const { blobs } = await store.list();
    const leads = await Promise.all(blobs.map(({ key }) => store.get(key, { type: "json" })));
    return json(200, leads.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  return json(405, { error: "Método não permitido." });
};
