import { createHash, createHmac, randomBytes, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
export const random = () => randomBytes(24).toString('base64url');
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const equal = (a, b) => { if (typeof a !== 'string' || typeof b !== 'string') return false; const left = Buffer.from(a), right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); };
export class AppError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
export function sealer(secret) {
  const key = createHash('sha256').update(secret).digest();
  return {
    seal(value, ttl = 86400000) { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv); const encrypted = Buffer.concat([c.update(JSON.stringify({ ...value, exp: Date.now() + ttl })), c.final()]); return Buffer.concat([iv, c.getAuthTag(), encrypted]).toString('base64url'); },
    open(token) { try { const b = Buffer.from(token || '', 'base64url'), c = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12)); c.setAuthTag(b.subarray(12, 28)); const x = JSON.parse(Buffer.concat([c.update(b.subarray(28)), c.final()]).toString()); return x.exp > Date.now() ? x : null; } catch { return null; } },
    csrf(id) { return createHmac('sha256', key).update('csrf:' + id).digest('base64url'); }
  };
}
export function cookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').map(x => x.trim().split(/=(.*)/s).slice(0, 2)).filter(x => x.length === 2)); }
export function setCookie(res, name, value, secure = true, maxAge = 86400) { const prev = res.getHeader('Set-Cookie') || []; res.setHeader('Set-Cookie', [...(Array.isArray(prev) ? prev : [prev]), `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`]); }
export async function readJSON(req, maxBytes = 1500000) {
  const chunks = []; let total = 0;
  for await (const chunk of req) { total += chunk.length; if (total > maxBytes) throw new AppError(413, 'TOO_LARGE', 'Het project is te groot.'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new AppError(400, 'INVALID_JSON', 'Ongeldig verzoek.'); }
}
export function validateShop(s) { const shop = String(s || '').trim().toLowerCase(); if (!/^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/.test(shop)) throw new AppError(400, 'SHOP_INVALID', 'Gebruik het exacte .myshopify.com-adres van je winkel.'); return shop; }
export function verifyOAuth(params, secret) {
  if (new Set(params.keys()).size !== [...params.keys()].length) return false;
  const signature = params.get('hmac');
  const message = [...params.entries()].filter(([key]) => key !== 'hmac' && key !== 'signature').sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
  return equal(createHmac('sha256', secret).update(message).digest('hex'), signature);
}
export function rateGate(limit = 60, ms = 60000) {
  const records = new Map();
  return (id) => { const now = Date.now(); if (records.size > 10000) for (const [k, v] of records) if (v.end < now) records.delete(k); let r = records.get(id); if (!r || r.end < now) records.set(id, r = { end: now + ms, count: 0 }); if (++r.count > limit) throw new AppError(429, 'RATE_LIMIT', 'Even wachten: te veel verzoeken. Probeer het over een minuut opnieuw.'); };
}
