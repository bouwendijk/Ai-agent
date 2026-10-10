// FinSight-server: serveert de app, bewaart de data en praat met bunq.
// Draait overal waar Node draait (Render, eigen VPS, thuis). Geen externe AI nodig.
//
// Env: APP_PASSWORD  (verplicht — wachtwoord voor de app)
//      DATABASE_URL  (Postgres; zonder = lokale map ./data, alleen voor tests)
//      BUNQ_API_KEY  (optioneel — zonder werkt alles behalve de automatische bunq-sync)
//      BUNQ_API_BASE (alleen voor tests/mocks)
const express = require("express");
const fs = require("fs");
const path = require("path");
const { Store } = require("./store");
const { BunqClient } = require("./bunq");

const app = express();
app.use(express.json({ limit: "6mb" }));

const PASS = process.env.APP_PASSWORD || "";
if (!PASS) console.warn("WAARSCHUWING: APP_PASSWORD is niet gezet — inloggen is onmogelijk.");
const store = new Store(process.env.DATABASE_URL, process.env.DATA_DIR || path.join(__dirname, "data"));

const safeEq = (a, b) => {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ba.length === bb.length && require("crypto").timingSafeEqual(ba, bb);
};
const auth = (req, res, next) => {
  const t = (req.headers.authorization || "").replace(/^Bearer /, "");
  if (!PASS || !safeEq(t, PASS)) return res.status(401).json({ error: "unauthorized" });
  next();
};
const DOC_RE = /^[A-Za-z0-9_\-./]{1,200}$/;

app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.post("/api/login", (req, res) => {
  if (PASS && safeEq(req.body?.password || "", PASS)) res.json({ ok: true });
  else res.status(401).json({ error: "verkeerd wachtwoord" });
});
app.get("/api/ping", auth, (_req, res) => res.json({ ok: true }));

app.get(/^\/api\/doc\/(.+)$/, auth, async (req, res) => {
  const p = req.params[0];
  if (!DOC_RE.test(p)) return res.status(400).json({ error: "pad" });
  const data = await store.get(p);
  res.json({ exists: data != null, data });
});
app.put(/^\/api\/doc\/(.+)$/, auth, async (req, res) => {
  const p = req.params[0];
  if (!DOC_RE.test(p)) return res.status(400).json({ error: "pad" });
  await store.set(p, req.body?.data ?? {});
  res.json({ ok: true });
});
app.get("/api/col/:name", auth, async (req, res) => {
  if (!DOC_RE.test(req.params.name)) return res.status(400).json({ error: "pad" });
  let docs = await store.list(req.params.name);
  const { order, dir, limit } = req.query;
  if (order) docs.sort((a, b) => ((a.data?.[order] ?? "") < (b.data?.[order] ?? "") ? -1 : 1) * (dir === "desc" ? -1 : 1));
  if (limit) docs = docs.slice(0, Math.max(1, +limit || 100));
  res.json({ docs });
});
app.post("/api/col/:name", auth, async (req, res) => {
  if (!DOC_RE.test(req.params.name)) return res.status(400).json({ error: "pad" });
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  await store.set(req.params.name + "/" + id, req.body?.data ?? {});
  res.json({ ok: true, id });
});

// bunq-proxy: de sleutel blijft op de server; de app krijgt alleen de rijen.
// Cache van 10 minuten zodat "openen" nooit traag wordt door bunq zelf.
let bunqBusy = null, bunqAt = 0, bunqCache = null;
app.get("/api/bunq/rows", auth, async (req, res) => {
  if (!process.env.BUNQ_API_KEY) return res.json({ error: "Geen BUNQ_API_KEY op de server ingesteld.", rows: [] });
  const days = Math.min(400, +(req.query.days || 45) || 45);
  const force = req.query.force === "1";
  if (bunqCache && !force && Date.now() - bunqAt < 10 * 60 * 1000) return res.json(bunqCache);
  if (!bunqBusy) bunqBusy = (async () => {
    try {
      const out = await new BunqClient(process.env.BUNQ_API_KEY, store).rows(days);
      bunqCache = out; bunqAt = Date.now();
      return out;
    } finally { bunqBusy = null; }
  })();
  try { res.json(await bunqBusy); }
  catch (e) { res.json({ error: String(e.message || e), rows: [] }); }
});

// De app zelf: één HTML-bestand, ingepakt in een pagina-skelet.
const appHtml = `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="manifest" href="manifest.webmanifest">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="apple-touch-icon" href="icon-180.png">
` + fs.readFileSync(path.join(__dirname, "app.html"), "utf8") + "\n</html>\n";

app.get("/", (_req, res) => res.type("html").send(appHtml));
app.get("/manifest.webmanifest", (_req, res) => res.json({
  name: "FinSight", short_name: "FinSight", start_url: "/", display: "standalone",
  background_color: "#f2f2f7", theme_color: "#0a84ff",
  icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
}));
const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#0a84ff"/><text x="50" y="68" font-family="-apple-system,Segoe UI,sans-serif" font-size="52" font-weight="800" fill="#fff" text-anchor="middle">F</text></svg>`;
app.get("/icon.svg", (_req, res) => res.type("image/svg+xml").send(ICON));
app.get("/icon-180.png", (_req, res) => res.type("image/svg+xml").send(ICON));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`FinSight server draait op :${port} (${process.env.DATABASE_URL ? "Postgres" : "lokale map"})`));
