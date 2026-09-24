export const VERSION = '2.0.0';
export const SECTION_TYPES = ['hero', 'products', 'story', 'features', 'faq', 'collections', 'statement'];
export const FONTS = { sans: 'Arial, Helvetica, sans-serif', serif: 'Georgia, Times New Roman, serif', mono: 'Courier New, monospace' };
const list = value => Array.isArray(value) ? value.filter(x => x != null) : [];
export const text = (s, max = 600) => typeof s === 'string' ? s.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, max) : '';
export function safeURL(value, image = false) {
  let s = text(value, 1500);
  if (!image && s === '/pages/about') s = '/?view=about';
  if (!image && s === '/pages/contact') s = '/?view=contact';
  if (!image && /^\/(?!\/)[a-zA-Z0-9/_?=&#%.,+-]*$/.test(s)) return s;
  if (!image && /^#[a-zA-Z][\w-]*$/.test(s)) return s;
  try { const u = new URL(s); if (u.protocol === 'https:' && !u.username && !u.password && !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/i.test(u.hostname)) return u.href; } catch {}
  return '';
}
const hex = (s, fallback) => /^#[a-f\d]{6}$/i.test(s || '') ? s.toLowerCase() : fallback;
const integer = (v, min, max, fallback) => Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Math.round(Number(v)))) : fallback;
export function validateDesign(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.sections) || !raw.sections.length || raw.sections.length > 12 || !text(raw.brand, 60)) throw new Error('Het ontwerp mist een merk of geldige secties.');
  const t = raw.tokens || {}, ids = new Set();
  const tokens = { background: hex(t.background, '#fafaf8'), text: hex(t.text, '#17231d'), surface: hex(t.surface, '#e9eee9'), accent: hex(t.accent, '#244b3a'), accentText: hex(t.accentText, '#ffffff'), muted: hex(t.muted, '#59665e'), headingFont: Object.hasOwn(FONTS, t.headingFont || '') ? t.headingFont : 'sans', radius: integer(t.radius, 0, 28, 2), maxWidth: integer(t.maxWidth, 960, 1600, 1320), spacing: integer(t.spacing, 40, 140, 88), headingScale: integer(t.headingScale, 44, 120, 86) };
  const sections = raw.sections.map((s, i) => {
    if (!s || !SECTION_TYPES.includes(s.type)) throw new Error('Onbekend sectietype in het AI-ontwerp.');
    let id = /^[a-z][a-z0-9_]{0,24}$/.test(s.id || '') ? s.id : `section_${i}`;
    let suffix = 0; while (ids.has(id)) id = `section_${i}_${++suffix}`; ids.add(id);
    return { id, type: s.type, layout: ['split', 'full', 'center', 'editorial'].includes(s.layout) ? s.layout : 'split', kicker: text(s.kicker, 90), title: text(s.title, 160), text: text(s.text, 1600), buttonLabel: text(s.buttonLabel, 60), buttonUrl: safeURL(s.buttonUrl) || '/collections/all', image: safeURL(s.image, true), imageAlt: text(s.imageAlt, 180), productHandles: (Array.isArray(s.productHandles) ? s.productHandles : []).filter(x => /^[a-z0-9][a-z0-9-]{0,180}$/.test(x)).slice(0, 12), items: list(s.items).slice(0, 8).map(x => ({ title: text(x.title, 120), text: text(x.text, 700), image: safeURL(x.image, true), url: safeURL(x.url) || '/collections/all' })) };
  });
  return { brand: text(raw.brand, 60), language: raw.language === 'en' ? 'en' : 'nl', description: text(raw.description, 400), announcement: text(raw.announcement, 180), tokens, nav: list(raw.nav).slice(0, 5).map(n => ({ label: text(n.label, 35), url: safeURL(n.url) || '/collections/all' })), sections, seo: { title: text(raw.seo?.title || raw.brand, 70), description: text(raw.seo?.description || raw.description, 160) } };
}
export function defaultDesign(origin = '') {
  return validateDesign({ brand: 'FORME', language: 'nl', description: 'Objecten met een eigen karakter.', announcement: '', tokens: { background: '#f8f9f6', text: '#20372b', surface: '#e2e8df', accent: '#264f3b', accentText: '#ffffff', muted: '#56695c', headingFont: 'serif', radius: 2, maxWidth: 1320, spacing: 88, headingScale: 100 }, nav: [{ label: 'Collectie', url: '/collections/all' }, { label: 'Het verhaal', url: '/pages/about' }], sections: [
    { id: 'hero', type: 'hero', layout: 'split', kicker: 'OBJECTEN / EEN ANDERE KIJK', title: 'Ruimte voor\nhet bijzondere.', text: 'Een plek voor objecten die je dagelijks leven net iets mooier maken. Ontdek jouw volgende favoriet.', buttonLabel: 'Ontdek de collectie', buttonUrl: '/collections/all', image: origin ? `${origin}/media/editorial.jpg` : '', imageAlt: 'Stoel in natuurlijk licht, foto van Preslav Rachev' },
    { id: 'collection', type: 'products', title: 'Jouw collectie, centraal.', kicker: 'MET AANDACHT GEKOZEN', text: 'Koppel je winkel om hier je eigen producten en foto’s te zien.', productHandles: [] },
    { id: 'story', type: 'story', layout: 'editorial', kicker: 'DE FILOSOFIE', title: 'Minder ruis.\nMeer karakter.', text: 'Een winkel begint met een verhaal. Vertel StoreCrew wat jouw merk bijzonder maakt, voor wie je er bent en welke sfeer je zoekt.', buttonLabel: 'Ons verhaal', buttonUrl: '/pages/about' }
  ], seo: { title: 'FORME — Objecten met karakter', description: 'Ontdek een collectie met een eigen karakter.' } });
}
export function normalizeCatalog(raw = {}) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const currency = /^[A-Z]{3}$/.test(raw.currency || '') ? raw.currency : 'EUR';
  const products = list(raw.products).slice(0, 1000).filter(p => /^[a-z0-9][a-z0-9-]*$/.test(p.handle || '')).map(p => ({
    id: text(String(p.id || ''), 100), handle: p.handle, title: text(p.title, 240), vendor: text(p.vendor, 160), description: text(p.description, 5000), image: safeURL(p.image, true), images: list(p.images).slice(0, 30).map(x => safeURL(x, true)).filter(Boolean), price: integer(p.price, 0, 1000000000, 0), available: p.available === true, variants: list(p.variants).slice(0, 250).map(v => ({ id: text(String(v.id || ''), 100).split('/').at(-1), title: text(v.title, 240), price: integer(v.price, 0, 1000000000, 0), available: v.available === true })), collections: list(p.collections).filter(x => /^[a-z0-9-]+$/.test(x)).slice(0, 100)
  }));
  return { shop: /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(raw.shop || '') ? raw.shop : '', name: text(raw.name, 100), currency, moneyFormat: text(raw.moneyFormat, 200).replace(/<[^>]*>/g, ''), importedAt: text(raw.importedAt, 40), partial: !!raw.partial, products, collections: list(raw.collections).slice(0, 250).map(c => ({ handle: text(c.handle, 180), title: text(c.title, 160), description: text(c.description, 1600), image: safeURL(c.image, true), productHandles: list(c.productHandles).filter(x => /^[a-z0-9-]+$/.test(x)).slice(0, 1000) })) };
}
export const EMPTY_CATALOG = normalizeCatalog();
export function reviewDesign(design, catalog) {
  const warnings = [];
  if (!catalog.products.length) warnings.push('Nog geen echte producten geïmporteerd. Koppel je winkel vóór je productpagina’s beoordeelt.');
  if (catalog.partial) warnings.push('De import is gedeeltelijk. Niet alle producten of varianten zijn beschikbaar in het voorbeeld.');
  const handles = new Set(catalog.products.map(p => p.handle));
  if (design.sections.some(s => s.productHandles.some(h => !handles.has(h)))) warnings.push('Een of meer gekozen producten staan niet in de huidige import. Importeer opnieuw.');
  if (catalog.products.length && catalog.products.some(p => !p.image)) warnings.push('Sommige producten missen een afbeelding.');
  return warnings;
}
