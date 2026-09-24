import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHmac } from 'node:crypto';
import { VERSION, defaultDesign, validateDesign, normalizeCatalog, reviewDesign, text } from './spec.mjs';
import { compileTheme } from './theme.mjs';
import { renderTheme, previewBridge } from './preview.mjs';
import { zipFiles } from './zip.mjs';
import { makeAI } from './ai.mjs';
import { AppError, random, hash, equal, sealer, cookies, setCookie, readJSON, validateShop, verifyOAuth, rateGate } from './security.mjs';
import { QUERIES, graphql, importCatalog, createDraft } from './shopify.mjs';
export function createApp({ env = process.env, fetcher = fetch, logger = console } = {}) {
  const origin = new URL(env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${env.PORT || 3000}`).origin;
  const secure = origin.startsWith('https:');
  const secret = env.STORECREW_SESSION_SECRET || env.SESSION_SECRET || random() + random(), seal = sealer(secret), ai = makeAI(env, fetcher);
  const shopifyConfigured = !!(env.SHOPIFY_API_KEY && env.SHOPIFY_API_SECRET && (env.STORECREW_SESSION_SECRET || env.SESSION_SECRET)?.length >= 32 && secure);
  const uploadEnabled = env.SHOPIFY_THEME_UPLOAD_ENABLED === '1';
  const jobs = new Map(), previews = new Map(), uploads = new Map(), usedStates = new Map(), themeCache = new Map(), renderCache = new Map();
  const ipGate = rateGate(160), generationGate = rateGate(6), previewGate = rateGate(60);
  const clean = () => { for (const map of [jobs, previews, uploads, usedStates]) for (const [key, value] of map) if (value.exp < Date.now()) map.delete(key); };
  const cleanup = setInterval(clean, 60000); cleanup.unref();
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  const safeHeaders = res => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()'); if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000'); };
  function project(data) { let design, catalog; try { design = validateDesign(data?.design); catalog = normalizeCatalog(data?.catalog); } catch { throw new AppError(400, 'INVALID_PROJECT', 'Het project bevat geen geldig ontwerp of catalogus.'); } const themeKey = hash(design); let compiled = themeCache.get(themeKey); if (!compiled) { compiled = compileTheme(design); themeCache.set(themeKey, compiled); if (themeCache.size > 40) themeCache.delete(themeCache.keys().next().value); } return { ...compiled, catalog, catalogDigest: hash(catalog), warnings: reviewDesign(design, catalog) }; }
  function approve(data, sid) { const p = project(data); const approval = seal.open(data.approval); if (!approval || approval.kind !== 'approval' || approval.sid !== sid || approval.digest !== p.digest || approval.catalogDigest !== p.catalogDigest) throw new AppError(409, 'APPROVAL_REQUIRED', 'Beoordeel en keur deze exacte versie eerst goed.'); return { ...p, approval }; }
  const publicConnection = connection => connection ? { connected: true, shop: connection.shop, scopes: connection.scopes || [], uploadAvailable: uploadEnabled && connection.scopes?.includes('write_themes'), exemptionVerified: false } : { connected: false, uploadAvailable: false };
  async function handle(req, res) {
    safeHeaders(res); const u = new URL(req.url, origin), route = u.pathname;
    try {
      if (route === '/health') return json(res, 200, { ok: true, version: VERSION, aiConfigured: ai.stats().configured, shopifyConfigured, themeSource: 'shared-liquid', commit: env.RENDER_GIT_COMMIT?.slice(0, 12) || 'local' });
      if (route === '/api/shopify/webhooks' && req.method === 'POST') {
        const chunks = []; let n = 0; for await (const chunk of req) { n += chunk.length; if (n > 1000000) throw new AppError(413, 'TOO_LARGE', 'Request too large'); chunks.push(chunk); }
        if (!env.SHOPIFY_API_SECRET || !equal(createHmac('sha256', env.SHOPIFY_API_SECRET).update(Buffer.concat(chunks)).digest('base64'), req.headers['x-shopify-hmac-sha256'])) throw new AppError(401, 'HMAC_INVALID', 'Invalid signature');
        return json(res, 200, { ok: true });
      }
      if (route.startsWith('/theme-source/') && req.method === 'GET') {
        const item = uploads.get(route.split('/').at(-1));
        if (!item || item.exp < Date.now()) throw new AppError(404, 'SOURCE_EXPIRED', 'Deze tijdelijke themabron is verlopen.');
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Cache-Control': 'no-store', 'Content-Disposition': 'attachment; filename="storecrew-theme.zip"' }); return res.end(item.zip);
      }
      const incoming = cookies(req); let session = seal.open(incoming.sc_session);
      if (!session?.sid) { session = { sid: random() }; setCookie(res, 'sc_session', seal.seal(session, 30 * 86400000), secure, 30 * 86400); }
      const sid = session.sid, connection = seal.open(incoming.sc_shop), connected = connection?.sid === sid ? connection : null;
      if (route.startsWith('/api/')) {
        const ip = env.RENDER ? String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',').at(-1).trim() : req.socket.remoteAddress;
        ipGate(ip);
        if (req.method !== 'GET') { if (req.headers.origin !== origin || !equal(req.headers['x-csrf-token'], seal.csrf(sid))) throw new AppError(403, 'CSRF', 'Deze sessie is verlopen. Ververs StoreCrew.'); if (!String(req.headers['content-type']).startsWith('application/json')) throw new AppError(415, 'JSON_REQUIRED', 'JSON vereist.'); }
      }
      if (route === '/api/session' && req.method === 'GET') return json(res, 200, { version: VERSION, csrf: seal.csrf(sid), ai: ai.stats(), shopify: { configured: shopifyConfigured, ...publicConnection(connected) }, defaultDesign: defaultDesign(existsSync(new URL('./public/media/editorial.jpg', import.meta.url)) ? origin : ''), storage: 'browser', themeUploadNeedsExemption: true });
      if (route === '/api/capacity' && req.method === 'GET') return json(res, 200, ai.stats());
      if (route === '/api/generate' && req.method === 'POST') {
        generationGate(sid); const data = await readJSON(req, 8000000), p = project(data), prompt = text(data.prompt, 6000);
        if (prompt.length < 2) throw new AppError(400, 'EMPTY_PROMPT', 'Beschrijf wat je wilt maken of aanpassen.');
        if (!ai.stats().configured) throw new AppError(503, 'AI_NOT_CONFIGURED', 'Echte AI is nog niet geactiveerd. Stel als beheerder één AI-sleutel in bij Render. Je ontwerp blijft bewaard.');
        if ([...jobs.values()].some(j => j.sid === sid && j.status === 'running')) throw new AppError(409, 'JOB_RUNNING', 'Je vorige ontwerp wordt nog gemaakt.');
        const id = random(), job = { sid, status: 'running', startedAt: Date.now(), exp: Date.now() + 900000 }; jobs.set(id, job);
        void ai.generate({ design: p.design, catalog: p.catalog, prompt, history: Array.isArray(data.history) ? data.history : [], memory: data.memory }).then(result => { const compiled = compileTheme(result.design); job.status = 'complete'; job.result = { ...result, digest: compiled.digest, warnings: reviewDesign(result.design, p.catalog) }; }).catch(error => { job.status = 'failed'; job.error = { code: error.code || 'AI_ERROR', message: error.message }; logger.warn(JSON.stringify({ event: 'ai_failed', code: error.code || 'AI_ERROR', upstreamStatus: error.upstreamStatus || null })); });
        return json(res, 202, { jobId: id });
      }
      if (route.startsWith('/api/jobs/') && req.method === 'GET') { const job = jobs.get(route.split('/').at(-1)); if (!job || job.sid !== sid || job.exp < Date.now()) throw new AppError(404, 'JOB_MISSING', 'De server is mogelijk herstart. Je opgeslagen ontwerp blijft intact; probeer opnieuw.'); return json(res, 200, { status: job.status, result: job.result, error: job.error }); }
      if (route === '/api/preview' && req.method === 'POST') {
        previewGate(sid); const data = await readJSON(req, 8000000), p = project(data), routeKey = text(data.route, 300) || '/', cartKey = Array.isArray(data.cart) ? data.cart : [], renderKey = hash({ digest: p.digest, catalogDigest: p.catalogDigest, route: routeKey, cart: cartKey }); let html = renderCache.get(renderKey); if (!html) { html = await renderTheme(p.files, p.catalog, routeKey, cartKey); renderCache.set(renderKey, html); if (renderCache.size > 80) renderCache.delete(renderCache.keys().next().value); }
        const id = random(), previous = [...previews].filter(([, value]) => value.sid === sid); for (const [key] of previous.slice(0, -7)) previews.delete(key);
        if (previews.size > 500) throw new AppError(429, 'PREVIEW_BUSY', 'De preview is even bezet.');
        previews.set(id, { sid, html, exp: Date.now() + 3600000 });
        return json(res, 200, { url: '/preview/' + id, digest: p.digest, warnings: p.warnings, files: Object.keys(p.files).length });
      }
      if (route.startsWith('/preview/') && req.method === 'GET') {
        const item = previews.get(route.split('/').at(-1)); if (!item || item.sid !== sid || item.exp < Date.now()) throw new AppError(404, 'PREVIEW_EXPIRED', 'Ververs het voorbeeld in StoreCrew.');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: data:; form-action 'none'; base-uri 'none'; frame-ancestors 'self'" }); return res.end(item.html.replace('</body>', previewBridge + '</body>'));
      }
      if (route === '/api/approve' && req.method === 'POST') {
        const data = await readJSON(req, 8000000), p = project(data); if (data.confirm !== true || data.digest !== p.digest) throw new AppError(409, 'REVIEW_CHANGED', 'Het ontwerp is gewijzigd. Bekijk eerst de nieuwe versie.');
        const approval = seal.seal({ kind: 'approval', aid: random(), sid, digest: p.digest, catalogDigest: p.catalogDigest }, 3600000);
        return json(res, 200, { approval, digest: p.digest, expiresAt: Date.now() + 3600000, warnings: p.warnings });
      }
      if (route === '/api/export' && req.method === 'POST') {
        const data = await readJSON(req, 8000000), p = approve(data, sid), zip = zipFiles(p.files);
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="storecrew-${p.design.brand.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 45)}.zip"`, 'X-Theme-Digest': p.digest }); return res.end(zip);
      }
      if (route === '/api/shopify/connect' && req.method === 'POST') {
        if (!shopifyConfigured) throw new AppError(503, 'SHOPIFY_NOT_CONFIGURED', 'De StoreCrew-app is nog niet ingesteld. De beheerder moet de Shopify Client ID en Client Secret toevoegen.');
        const data = await readJSON(req), shop = validateShop(data.shop), state = random(); setCookie(res, 'sc_oauth', seal.seal({ sid, shop, state }, 600000), secure, 600);
        const params = new URLSearchParams({ client_id: env.SHOPIFY_API_KEY, scope: uploadEnabled ? 'read_products,read_themes,write_themes' : 'read_products', redirect_uri: origin + '/auth/shopify/callback', state });
        return json(res, 200, { url: `https://${shop}/admin/oauth/authorize?${params}` });
      }
      if (route === '/auth/shopify/callback' && req.method === 'GET') {
        const state = seal.open(incoming.sc_oauth), shop = validateShop(u.searchParams.get('shop')), timestamp = Number(u.searchParams.get('timestamp'));
        if (!shopifyConfigured || !state || state.sid !== sid || state.shop !== shop || !equal(state.state, u.searchParams.get('state')) || usedStates.has(state.state) || !Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 600 || !verifyOAuth(u.searchParams, env.SHOPIFY_API_SECRET) || !u.searchParams.get('code')) throw new AppError(403, 'OAUTH_INVALID', 'Shopify-autorisatie is verlopen of ongeldig. Start de koppeling opnieuw vanuit StoreCrew.');
        usedStates.set(state.state, { exp: Date.now() + 600000 }); setCookie(res, 'sc_oauth', '', secure, 0);
        const r = await fetcher(`https://${shop}/admin/oauth/access_token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: env.SHOPIFY_API_KEY, client_secret: env.SHOPIFY_API_SECRET, code: u.searchParams.get('code') }), signal: AbortSignal.timeout(25000), redirect: 'error' });
        if (!r.ok) throw new AppError(502, 'OAUTH_EXCHANGE', 'Shopify kon de autorisatie niet afronden. Start opnieuw.');
        const token = await r.json(); if (!token.access_token || !String(token.scope).split(',').includes('read_products')) throw new AppError(403, 'OAUTH_SCOPE', 'Leestoegang tot producten is vereist.');
        const ttl = Math.min(86400, Number(token.expires_in) || 86400); setCookie(res, 'sc_shop', seal.seal({ sid, shop, token: token.access_token, scopes: String(token.scope).split(','), issuedAt: Date.now() }, ttl * 1000), secure, ttl);
        res.writeHead(303, { Location: '/?shopify=connected' }); return res.end();
      }
      if (route === '/api/shopify/disconnect' && req.method === 'POST') { setCookie(res, 'sc_shop', '', secure, 0); return json(res, 200, { ok: true }); }
      if (route === '/api/shopify/import' && req.method === 'POST') { if (!connected) throw new AppError(401, 'SHOPIFY_CONNECT', 'Autoriseer je Shopify-winkel eerst.'); return json(res, 200, await importCatalog(connected, fetcher)); }
      if (route === '/api/shopify/upload' && req.method === 'POST') {
        if (!connected) throw new AppError(401, 'SHOPIFY_CONNECT', 'Autoriseer je Shopify-winkel eerst.');
        const data = await readJSON(req, 8000000), p = approve(data, sid);
        if (data.confirmUpload !== true) throw new AppError(403, 'UPLOAD_CONFIRM', 'Bevestig het aanmaken van dit ongepubliceerde concept.');
        if (p.catalog.shop && p.catalog.shop !== connected.shop) throw new AppError(409, 'SHOP_MISMATCH', 'Het ontwerp bevat producten van een andere winkel. Importeer eerst de gekoppelde winkel.');
        if (!uploadEnabled) throw new AppError(403, 'THEME_ACCESS_MISSING', 'Direct uploaden is nog niet geautoriseerd voor deze app. Gebruik de ZIP-export.');
        const granted = (await graphql(connected, QUERIES.shop, {}, fetcher)).currentAppInstallation.accessScopes.map(s => s.handle);
        if (!granted.includes('write_themes')) throw new AppError(403, 'THEME_SCOPE_MISSING', 'De app mist write_themes. Download de ZIP of autoriseer opnieuw na Shopify-goedkeuring.');
        const jobKey = 'upload_' + p.approval.aid; if (jobs.has(jobKey)) return json(res, 202, { jobId: jobKey });
        const sourceToken = random(), zip = zipFiles(p.files); uploads.set(sourceToken, { zip, exp: Date.now() + 900000 });
        const job = { sid, status: 'running', exp: Date.now() + 3600000 }; jobs.set(jobKey, job);
        void (async () => {
          try {
            const theme = await createDraft(connected, { source: origin + '/theme-source/' + sourceToken, name: 'StoreCrew ' + p.design.brand.slice(0, 30) + ' ' + p.digest.slice(0, 6) }, fetcher);
            job.result = { theme, adminUrl: `https://${connected.shop}/admin/themes/${theme.id.split('/').at(-1)}/editor`, previewUrl: `https://${connected.shop}/?preview_theme_id=${theme.id.split('/').at(-1)}` };
            for (let attempt = 0; attempt < 24 && theme.processing; attempt++) { await new Promise(r => setTimeout(r, 2500)); Object.assign(theme, (await graphql(connected, QUERIES.theme, { id: theme.id }, fetcher)).theme); }
            if (theme.processingFailed) throw new AppError(422, 'THEME_PROCESSING_FAILED', 'Shopify kon de ZIP niet verwerken. Controleer het concept in je themabibliotheek.');
            if (theme.processing) throw new AppError(504, 'THEME_STILL_PROCESSING', 'Shopify verwerkt het thema nog. Open de themabibliotheek; upload niet opnieuw.');
            job.status = 'complete'; logger.info(JSON.stringify({ event: 'draft_created', role: theme.role, digest: p.digest }));
          } catch (e) { job.status = 'failed'; job.error = { code: e.code || 'UPLOAD_UNKNOWN', message: e.code ? e.message : 'De uploadstatus is onzeker. Controleer je themabibliotheek voordat je opnieuw uploadt.' }; logger.warn(JSON.stringify({ event: 'draft_failed', code: e.code || 'UPLOAD_UNKNOWN' })); }
        })();
        return json(res, 202, { jobId: jobKey });
      }
      if (route === '/device-check' && req.method === 'GET') { const width = u.searchParams.get('width') === '375' ? 375 : 390; res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>StoreCrew mobiele controle</title></head><body style="margin:0;background:#dce2df;display:grid;place-items:center;min-height:100vh"><iframe title="StoreCrew op ${width} pixels" src="/" style="width:${width}px;height:844px;max-width:100%;border:0;background:white"></iframe></body></html>`); }
      const staticFiles = { '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'], '/vendor/webllm.bundle.mjs.part00': ['vendor/webllm.bundle.mjs.part00', 'application/octet-stream'], '/vendor/webllm.bundle.mjs.part01': ['vendor/webllm.bundle.mjs.part01', 'application/octet-stream'], '/vendor/webllm.bundle.mjs.part02': ['vendor/webllm.bundle.mjs.part02', 'application/octet-stream'], '/vendor/webllm.bundle.mjs.part03': ['vendor/webllm.bundle.mjs.part03', 'application/octet-stream'], '/media/editorial.jpg': ['media/editorial.jpg', 'image/jpeg'] };
      if (staticFiles[route] && ['GET', 'HEAD'].includes(req.method)) { const [name, mime] = staticFiles[route], content = await readFile(new URL('./public/' + name, import.meta.url)); res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': route.startsWith('/vendor/') ? 'public, max-age=31536000, immutable' : route.startsWith('/media/') ? 'public, max-age=86400' : 'no-cache', 'Content-Security-Policy': "default-src 'self'; script-src 'self' blob:; style-src 'self'; img-src 'self' https: data:; connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co https://raw.githubusercontent.com https://github.com; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'" }); return res.end(req.method === 'HEAD' ? undefined : content); }
      throw new AppError(404, 'NOT_FOUND', 'Niet gevonden.');
    } catch (error) {
      if (!error.status) logger.error(JSON.stringify({ event: 'request_failed', route, name: error.name, message: error.message.slice(0, 200) }));
      if (error.status === 401) setCookie(res, 'sc_shop', '', secure, 0); if (error.status === 429) res.setHeader('Retry-After', '60');
      if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'Er ging iets mis. Je opgeslagen ontwerp blijft intact.', code: error.code || 'SERVER_ERROR' }); else res.end();
    }
  }
  const server = http.createServer(handle); server.requestTimeout = 30000; server.headersTimeout = 15000; server.on('close', () => clearInterval(cleanup)); return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) createApp().listen(process.env.PORT || 3000, '0.0.0.0', () => console.log(JSON.stringify({ event: 'storecrew_started', version: VERSION })));
