import { AppError, validateShop } from './security.mjs';
import { normalizeCatalog } from './spec.mjs';
export const API_VERSION = '2026-07';
export const QUERIES = {
  shop: `query StoreCrewShop { shop { name myshopifyDomain currencyCode currencyFormats { moneyWithCurrencyFormat } } currentAppInstallation { accessScopes { handle } } }`,
  products: `query StoreCrewProducts($after: String) { products(first: 5, after: $after, query: "status:active", sortKey: TITLE) { nodes { id handle title vendor description onlineStoreUrl media(first: 20) { nodes { ... on MediaImage { image { url } } } pageInfo { hasNextPage endCursor } } variants(first: 100) { nodes { id title price availableForSale } pageInfo { hasNextPage endCursor } } } pageInfo { hasNextPage endCursor } } }`,
  collections: `query StoreCrewCollections($after: String) { collections(first: 5, after: $after) { nodes { id handle title description image { url } products(first: 100) { nodes { handle } pageInfo { hasNextPage endCursor } } } pageInfo { hasNextPage endCursor } } }`,
  create: `mutation StoreCrewDraft($source: URL!, $name: String!) { themeCreate(source: $source, name: $name, role: UNPUBLISHED) { theme { id name role processing processingFailed } userErrors { field message code } } }`,
  theme: `query StoreCrewTheme($id: ID!) { theme(id: $id) { id name role processing processingFailed } }`
};
export async function graphql(connection, query, variables = {}, fetcher = fetch, attempt = 0) {
  const shop = validateShop(connection.shop);
  const r = await fetcher(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': connection.token }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(25000), redirect: 'error' });
  const readOnly = !/^\s*mutation\b/.test(query);
  if (readOnly && (r.status === 429 || r.status === 503) && attempt < 2) { await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))); return graphql(connection, query, variables, fetcher, attempt + 1); }
  if (!r.ok) throw new AppError(r.status === 401 ? 401 : 502, 'SHOPIFY_API', r.status === 401 ? 'De Shopify-autorisatie is verlopen. Koppel je winkel opnieuw.' : 'Shopify kon dit verzoek niet verwerken. Probeer het opnieuw.');
  const x = await r.json();
  if (readOnly && x.errors?.some(e => e.extensions?.code === 'THROTTLED') && attempt < 2) { await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))); return graphql(connection, query, variables, fetcher, attempt + 1); }
  if (x.errors?.length) { const denied = x.errors.some(e => /access.denied|denied|permission|scope|exemption/i.test(e.message || '') || e.extensions?.code === 'ACCESS_DENIED'); throw new AppError(denied ? 403 : 502, denied ? 'SHOPIFY_ACCESS' : 'SHOPIFY_QUERY', denied ? 'Deze Shopify-app heeft onvoldoende toegang. ZIP-export blijft beschikbaar.' : 'Shopify gaf een API-fout. Probeer de import opnieuw.'); }
  return x.data;
}
export async function importCatalog(connection, fetcher = fetch) {
  const data = await graphql(connection, QUERIES.shop, {}, fetcher), products = [], collections = []; let partial = false, after = null;
  for (let page = 0; page < 200; page++) {
    const r = (await graphql(connection, QUERIES.products, { after }, fetcher)).products;
    for (const p of r.nodes) {
      if (!p.onlineStoreUrl) continue;
      const images = p.media.nodes.map(x => x.image?.url).filter(Boolean), variants = p.variants.nodes.map(v => ({ ...v, id: v.id.split('/').at(-1), price: Math.round(Number(v.price) * 100), available: v.availableForSale }));
      products.push({ ...p, image: images[0] || '', images, variants, price: Math.min(...variants.map(v => v.price)), available: variants.some(v => v.available) });
      if (p.variants.pageInfo.hasNextPage || p.media.pageInfo.hasNextPage) partial = true;
    }
    if (!r.pageInfo.hasNextPage) break; after = r.pageInfo.endCursor; if (page === 199) partial = true;
  }
  after = null;
  for (let page = 0; page < 50; page++) {
    const r = (await graphql(connection, QUERIES.collections, { after }, fetcher)).collections;
    for (const c of r.nodes) { collections.push({ ...c, image: c.image?.url || '', productHandles: c.products.nodes.map(p => p.handle) }); if (c.products.pageInfo.hasNextPage) partial = true; }
    if (!r.pageInfo.hasNextPage) break; after = r.pageInfo.endCursor; if (page === 49) partial = true;
  }
  return { catalog: normalizeCatalog({ shop: connection.shop, name: data.shop.name, currency: data.shop.currencyCode, moneyFormat: data.shop.currencyFormats.moneyWithCurrencyFormat, products, collections, importedAt: new Date().toISOString(), partial: partial || collections.length > 250 }), scopes: data.currentAppInstallation.accessScopes.map(s => s.handle) };
}
export async function createDraft(connection, { source, name }, fetcher = fetch) {
  const r = (await graphql(connection, QUERIES.create, { source, name }, fetcher)).themeCreate;
  if (r.userErrors?.length) throw new AppError(422, 'THEME_REJECTED', 'Shopify heeft het concept niet geaccepteerd: ' + r.userErrors.map(e => e.message).join(' ').slice(0, 400));
  if (!r.theme || r.theme.role !== 'UNPUBLISHED') throw new AppError(502, 'THEME_ROLE', 'Shopify bevestigde geen ongepubliceerd concept. Controleer je themabibliotheek.');
  return r.theme;
}
