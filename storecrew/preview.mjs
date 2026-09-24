import { Liquid } from './vendor/liquidjs.mjs';
import { normalizeCatalog } from './spec.mjs';
const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function amount(cents, format, currency) {
  const n = Number(cents || 0) / 100;
  const formats = { amount: n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), amount_no_decimals: Math.round(n).toLocaleString('en-US'), amount_with_comma_separator: n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), amount_no_decimals_with_comma_separator: Math.round(n).toLocaleString('de-DE'), amount_with_apostrophe_separator: n.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), amount_with_space_separator: n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replaceAll('\u202f', ' ') };
  return escape(format ? format.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => formats[key] || formats.amount) : `${formats.amount_with_comma_separator} ${currency}`);
}
function adapt(source) {
  return source.replace(/{%\s*schema\s*%}[\s\S]*?{%\s*endschema\s*%}/g, '').replace(/{%\s*doc\s*%}[\s\S]*?{%\s*enddoc\s*%}/g, '').replace(/{%\s*form\s+['"]product['"][\s\S]*?%}/g, '<form method="post" action="/cart/add"><input type="hidden" name="form_type" value="product">').replace(/{%\s*form\s+['"]contact['"][\s\S]*?%}/g, '<form method="post" action="/contact"><input type="hidden" name="form_type" value="contact">').replace(/{%\s*endform\s*%}/g, '</form>').replace(/{%\s*paginate\s+[^%]*%}/g, '{% if true %}').replace(/{%\s*endpaginate\s*%}/g, '{% endif %}');
}
export async function renderTheme(files, catalogInput, route = '/', cartInput = []) {
  const catalog = normalizeCatalog(catalogInput), localeFile = Object.keys(files).find(n => n.startsWith('locales/') && n.endsWith('.default.json')), translations = JSON.parse(files[localeFile]);
  const engine = new Liquid({ strictFilters: true, ownPropertyOnly: true, renderLimit: 5000, memoryLimit: 100000000 });
  engine.registerFilter('t', key => String(key).split('.').reduce((x, k) => x?.[k], translations) || key);
  engine.registerFilter('money_with_currency', value => amount(value, catalog.moneyFormat, catalog.currency));
  engine.registerFilter('image_url', (value, ...args) => { const url = typeof value === 'object' ? value?.src : value; if (!url) return ''; try { const u = new URL(url); const width = args.find(a => Array.isArray(a) && a[0] === 'width')?.[1]; if (width && u.hostname.endsWith('shopify.com')) u.searchParams.set('width', width); return u.href; } catch { return ''; } });
  engine.registerFilter('default_errors', () => '');
  engine.registerFilter('default_pagination', p => (p.previous ? `<a href="${escape(p.previous.url)}">${translations.general.previous}</a>` : '') + (p.pages > 1 ? `<span>${p.current_page} / ${p.pages}</span>` : '') + (p.next ? `<a href="${escape(p.next.url)}">${translations.general.next}</a>` : ''));
  const products = catalog.products.map(p => ({ ...p, url: '/products/' + p.handle, featured_image: p.image ? { src: p.image } : null, images: (p.images.length ? p.images : p.image ? [p.image] : []).map(src => ({ src })), selected_or_first_available_variant: p.variants.find(v => v.available) || p.variants[0] }));
  const all = Object.fromEntries(products.map(p => [p.handle, p]));
  const collections = Object.fromEntries(catalog.collections.map(c => [c.handle, { ...c, url: '/collections/' + c.handle, products: c.productHandles.length ? c.productHandles.map(h => all[h]).filter(Boolean) : products.filter(p => p.collections.includes(c.handle)) }]));
  collections.all ||= { title: 'Products', products: [...products].sort((a, b) => a.title.localeCompare(b.title)), description: '' };
  const url = new URL(route, 'https://preview.invalid'), parts = url.pathname.split('/').filter(Boolean);
  let pageType = 'index', product = null, collection = collections.all, page = { title: '', content: '', handle: '' };
  if (parts[0] === 'products') { pageType = 'product'; product = all[parts[1]]; }
  else if (parts[0] === 'collections') { pageType = 'collection'; collection = collections[parts[1]] || collections.all; }
  else if (parts[0] === 'cart') pageType = 'cart';
  else if (parts[0] === 'search') pageType = 'search';
  else if (parts[0] === 'pages') { pageType = parts[1] === 'contact' ? 'page.contact' : 'page'; page = { title: translations.general.about, content: '', handle: parts[1] }; }
  else if (parts.length) pageType = '404';
  else if (['about', 'contact'].includes(url.searchParams.get('view'))) pageType = 'index.' + url.searchParams.get('view');
  const terms = (url.searchParams.get('q') || '').slice(0, 150), results = products.filter(p => p.title.toLowerCase().includes(terms.toLowerCase()));
  const sourceList = pageType === 'search' ? results : collection.products;
  const pages = Math.max(1, Math.ceil(sourceList.length / 24)), currentPage = Math.min(pages, Math.max(1, parseInt(url.searchParams.get('page')) || 1));
  const pageURL = n => { const u = new URL(url); u.searchParams.set('page', n); return u.pathname + u.search; };
  const list = sourceList.slice((currentPage - 1) * 24, currentPage * 24);
  if (pageType === 'collection') collection = { ...collection, products: list };
  const cartItems = (Array.isArray(cartInput) ? cartInput : []).slice(0, 80).map(item => { const p = products.find(p => p.variants.some(v => v.id === String(item.id))); const variant = p?.variants.find(v => v.id === String(item.id)); const quantity = Math.min(99, Math.max(0, Number(item.quantity) || 0)); return variant && quantity ? { ...p, title: p.title + (variant.title === 'Default Title' ? '' : ' — ' + variant.title), variant_id: variant.id, quantity, final_line_price: variant.price * quantity } : null; }).filter(Boolean);
  const context = { settings: JSON.parse(files['config/settings_data.json']).current, shop: { name: catalog.name, policies: [] }, collections, all_products: all, product, collection, page, page_title: product?.title || '', page_description: product?.description?.slice(0, 160) || '', canonical_url: url.pathname, cart: { items: cartItems, item_count: cartItems.reduce((n, i) => n + i.quantity, 0), total_price: cartItems.reduce((n, i) => n + i.final_line_price, 0) }, routes: { root_url: '/', all_products_collection_url: '/collections/all', cart_url: '/cart', cart_add_url: '/cart/add', search_url: '/search' }, content_for_header: '', form: {}, search: { performed: url.searchParams.has('q'), terms, results: list }, paginate: { pages, current_page: currentPage, previous: currentPage > 1 ? { url: pageURL(currentPage - 1) } : null, next: currentPage < pages ? { url: pageURL(currentPage + 1) } : null } };
  const template = JSON.parse(files[`templates/${pageType}.json`]); let content = '';
  for (const id of template.order) {
    const s = template.sections[id], blocks = (s.block_order || []).map(key => { const b = s.blocks[key], settings = { ...b.settings }; if (b.type === 'product') settings.product = all[settings.product] || null; return { id: key, type: b.type, settings, shopify_attributes: '' }; });
    content += `<div id="shopify-section-${id}" class="shopify-section">` + await engine.parseAndRender(adapt(files[`sections/${s.type}.liquid`]), { ...context, section: { id, settings: s.settings, blocks } }) + '</div>';
  }
  return engine.parseAndRender(adapt(files['layout/theme.liquid']), { ...context, content_for_layout: content });
}
export const previewBridge = `<script>document.addEventListener('click',function(e){var a=e.target.closest('a');if(!a)return;var h=a.getAttribute('href');if(!h||h.charAt(0)==='#')return;e.preventDefault();parent.postMessage({type:'storecrew:navigate',url:h},'*');});document.addEventListener('submit',function(e){e.preventDefault();var f=e.target;var data=Array.from(new FormData(f).entries());var button=e.submitter;parent.postMessage({type:'storecrew:form',action:f.getAttribute('action')||'/',data:data,submit:button&&button.name},'*');});</script>`;
