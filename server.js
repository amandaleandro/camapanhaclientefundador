const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "troque-esta-senha";
const root = __dirname;
const dataDir = path.join(root, "data");
const leadsFile = path.join(dataDir, "leads.json");

fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(leadsFile)) fs.writeFileSync(leadsFile, "[]\n", "utf8");

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
}

function readLeads() {
  return JSON.parse(fs.readFileSync(leadsFile, "utf8"));
}

function writeLeads(leads) {
  fs.writeFileSync(leadsFile, `${JSON.stringify(leads, null, 2)}\n`, "utf8");
}

function isAdmin(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Basic ")) return false;
  const [, password = ""] = Buffer.from(auth.slice(6), "base64").toString().split(":");
  return password === ADMIN_PASSWORD;
}

function requireAdmin(req, res) {
  if (isAdmin(req)) return true;
  res.writeHead(401, { "WWW-Authenticate": 'Basic realm="FechaPro Leads"' });
  res.end("Acesso restrito");
  return false;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 10_000) reject(new Error("Payload muito grande"));
    });
    req.on("end", () => {
      try { resolve(JSON.parse(body)); } catch { reject(new Error("JSON inválido")); }
    });
    req.on("error", reject);
  });
}

function serveFile(res, filePath) {
  const types = { ".html": "text/html; charset=utf-8", ".png": "image/png", ".js": "text/javascript; charset=utf-8" };
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return send(res, 404, { error: "Não encontrado" });
  send(res, 200, fs.readFileSync(filePath), types[path.extname(filePath)] || "application/octet-stream");
}

function csv(leads) {
  const escape = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [
    ["Nome", "WhatsApp", "Data de cadastro"].map(escape).join(","),
    ...leads.map(lead => [lead.nome, lead.whatsapp, lead.createdAt].map(escape).join(","))
  ].join("\n");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "POST" && url.pathname === "/api/leads") {
    try {
      const { nome = "", whatsapp = "" } = await parseBody(req);
      const cleanName = String(nome).trim().slice(0, 100);
      const cleanPhone = String(whatsapp).replace(/\D/g, "").slice(0, 11);
      if (cleanName.length < 2 || cleanPhone.length < 10) return send(res, 400, { error: "Preencha nome e WhatsApp corretamente." });
      const leads = readLeads();
      const existing = leads.find(lead => lead.whatsapp === cleanPhone);
      if (!existing) {
        leads.push({ id: crypto.randomUUID(), nome: cleanName, whatsapp: cleanPhone, createdAt: new Date().toISOString() });
        writeLeads(leads);
      }
      return send(res, existing ? 200 : 201, { ok: true });
    } catch {
      return send(res, 400, { error: "Não foi possível salvar o cadastro." });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/leads") {
    if (!requireAdmin(req, res)) return;
    return send(res, 200, readLeads().sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  if (req.method === "GET" && url.pathname === "/api/leads.csv") {
    if (!requireAdmin(req, res)) return;
    res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="leads-fechapro.csv"' });
    return res.end(`\uFEFF${csv(readLeads())}`);
  }

  if (req.method !== "GET") return send(res, 405, { error: "Método não permitido" });
  if (url.pathname === "/admin" || url.pathname === "/admin/") {
    if (!requireAdmin(req, res)) return;
    return serveFile(res, path.join(root, "admin.html"));
  }
  if (url.pathname === "/") return serveFile(res, path.join(root, "index.html"));
  const safePath = path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
  return serveFile(res, path.join(root, safePath));
});

server.listen(PORT, () => {
  console.log(`FechaPro disponível em http://localhost:${PORT}`);
  console.log(`Painel de leads: http://localhost:${PORT}/admin`);
  if (ADMIN_PASSWORD === "troque-esta-senha") console.warn("Defina ADMIN_PASSWORD antes de publicar.");
});
