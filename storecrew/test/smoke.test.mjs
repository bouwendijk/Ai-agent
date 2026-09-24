import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { inflateRawSync } from 'node:zlib';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createApp } from '../server.mjs';
import { defaultDesign, normalizeCatalog, safeURL, validateDesign } from '../spec.mjs';
import { compileTheme } from '../theme.mjs';
import { renderTheme } from '../preview.mjs';
import { zipFiles } from '../zip.mjs';
import { makeAI } from '../ai.mjs';
import { equal, sealer, verifyOAuth, validateShop } from '../security.mjs';
import { importCatalog, QUERIES } from '../shopify.mjs';

const origin = 'https://studio.example';
const secret = 'test-only-32-byte-secret-not-a-real-key';
const design = defaultDesign(origin);
const catalog = normalizeCatalog({ shop: 'sample.myshopify.com', name: 'A real fixture', currency: 'EUR', moneyFormat: '€{{amount_with_comma_separator}} EUR', products: [{ id:'1', handle:'chair', vendor:'Maker', title:'Chair & stool', description:'A chair.', image:'https://cdn.shopify.com/chair.jpg', images:['https://cdn.shopify.com/chair.jpg'], price:1999, available:true, variants:[{id:'21',title:'Oak',price:1999,available:true},{id:'22',title:'Walnut',price:2499,available:false}] }], collections:[{handle:'seating',title:'Seating',productHandles:['chair']}] });
const json = data => new Response(JSON.stringify(data), {headers:{'Content-Type':'application/json'}});
const logger = { info(){}, warn(){}, error(){} };
function unzip(buf) {
  const files = {}; let p=0;
  while(buf.readUInt32LE(p) === 0x04034b50) { const method=buf.readUInt16LE(p+8), length=buf.readUInt32LE(p+18), nameLen=buf.readUInt16LE(p+26), extra=buf.readUInt16LE(p+28), name=buf.subarray(p+30,p+30+nameLen).toString(); p+=30+nameLen+extra; const content=buf.subarray(p,p+length); files[name]=(method===8?inflateRawSync(content):content).toString(); p+=length; }
  assert.equal(buf.readUInt32LE(p),0x02014b50); return files;
}
async function start(t, env={}, fetcher=fetch) {
  const server=createApp({env:{PUBLIC_URL:origin, STORECREW_SESSION_SECRET:secret,...env},fetcher,logger});
  server.listen(0,'127.0.0.1'); await once(server,'listening'); t.after(()=>new Promise(resolve=>server.close(resolve)));
  return 'http://127.0.0.1:'+server.address().port;
}
async function client(base) {
  const jar=new Map(); let csrf;
  async function call(path, body, extra={}) {
    const headers={cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '), ...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':csrf}),...extra};
    const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
    for(const c of r.headers.getSetCookie()){const [name,...value]=c.split(';')[0].split('='); jar.set(name,value.join('='));}
    return r;
  }
  const session=await(await call('/api/session')).json(); csrf=session.csrf;
  return {call,session,jar};
}
async function poll(c,id) { for(let i=0;i<30;i++){ const job=await(await c.call('/api/jobs/'+id)).json(); if(job.status!=='running')return job; await new Promise(r=>setTimeout(r,10)); } throw Error('Job did not complete'); }

await test('ZIP and preview share every generated file, across all storefront routes',async()=>{
  const d=structuredClone(design); d.sections[1].productHandles=['chair'];
  const compiled=compileTheme(d), exported=unzip(zipFiles(compiled.files));
  assert.deepEqual(exported,compiled.files);
  for(const route of ['/', '/products/chair', '/collections/seating', '/cart', '/?view=about', '/?view=contact', '/search?q=chair','/missing']){
    const before=await renderTheme(compiled.files,catalog,route,[{id:'21',quantity:2}]);
    assert.equal(await renderTheme(exported,catalog,route,[{id:'21',quantity:2}]),before,route);
    assert(!before.includes('{%'),route);
  }
  const home=await renderTheme(exported,catalog); assert(home.includes('Chair &amp; stool')); assert(home.includes('€19,99 EUR'));
  const product=await renderTheme(exported,catalog,'/products/chair'); assert(product.includes('Maker')); assert(product.includes('value="22"')); assert(product.includes('disabled'));
  const cart=await renderTheme(exported,catalog,'/cart',[{id:'21',quantity:2}]); assert(cart.includes('€39,98 EUR'));
  assert((await renderTheme(exported,catalog,'/?view=about')).includes('Minder ruis.'));
  assert((await renderTheme(exported,catalog,'/?view=contact')).includes('contact[email]'));
});
await test('Theme settings and catalog text cannot execute HTML, CSS or Liquid',async()=>{
  const d=structuredClone(design); d.brand='<script>alert(1)</script>'; d.sections[0].title='{{ secret }} <script>alert(2)</script>'; d.tokens.accent='red;}body{display:none';
  const html=await renderTheme(compileTheme(d).files,catalog);
  assert(!html.includes('<script>alert')); assert(html.includes('&lt;script&gt;')); assert(html.includes('{{ secret }}')); assert(!html.includes('red;}body'));
  assert.equal(safeURL('javascript:alert(1)'), ''); assert.equal(safeURL('//evil.example'),''); assert.equal(safeURL('https://u:p@host.test'),'');
  const ids=validateDesign({...design,sections:[...design.sections,{...design.sections[0],id:'hero'}]}).sections.map(s=>s.id); assert.equal(new Set(ids).size,ids.length);
  assert.deepEqual(normalizeCatalog({products:null,collections:'bad'}).products,[]);
});
await test('No anonymous or simulated AI fallback; memory and exact revisions go to provider',async()=>{
  await assert.rejects(makeAI({}).generate({}),e=>e.code==='AI_NOT_CONFIGURED');
  let captured;
  const next=structuredClone(design); next.tokens.accent='#772233';
  const ai=makeAI({GEMINI_API_KEY:'provider-test-secret',AI_DAILY_REQUEST_LIMIT:'1'},async(url,options)=>{captured={url,options,body:JSON.parse(options.body)};return json({candidates:[{content:{parts:[{text:JSON.stringify({message:'Accent bijgewerkt.',memory:'Groen behouden, nieuw accent.',design:next})}]}}]});});
  const result=await ai.generate({design,prompt:'Wijzig alleen het accent',history:[{role:'user',content:'Behoud het groen'}],memory:'Rustige stijl',catalog});
  assert.equal(result.mode,'generative'); assert.deepEqual(result.design,next); assert.equal(captured.options.headers['x-goog-api-key'],'provider-test-secret');
  const input=JSON.parse(captured.body.contents[0].parts[0].text); assert.equal(input.memory,'Rustige stijl'); assert.equal(input.history[0].content,'Behoud het groen'); assert.equal(input.design.brand,'FORME');
  await assert.rejects(ai.generate({design,prompt:'Meer',catalog}),e=>e.code==='DAILY_CAPACITY');
  const failing=makeAI({GEMINI_API_KEY:'x'},async()=>new Response('',{status:429}));
  await assert.rejects(failing.generate({design,prompt:'Ontwerp',catalog}),e=>e.status===429);
});
await test('AI malformed output is repaired once; unknown products never become an accepted design',async()=>{
  let calls=0; const bad=structuredClone(design); bad.sections[1].productHandles=['invented-product'];
  const ai=makeAI({GEMINI_API_KEY:'x'},async()=>{calls++;return json({candidates:[{content:{parts:[{text:JSON.stringify({message:'Done',memory:'Brief',design:bad})}]}}]});});
  await assert.rejects(ai.generate({design,prompt:'Maak',catalog}),e=>e.code==='AI_INVALID_OUTPUT'); assert.equal(calls,2); assert.deepEqual(design,defaultDesign(origin));
});
await test('Encrypted cookies, OAuth signatures, expiry and strict shop domains',()=>{
  const seals=sealer(secret), token=seals.seal({token:'plain-access-token'},1000); assert(!token.includes('plain-access-token')); assert.equal(seals.open(token).token,'plain-access-token'); assert.equal(seals.open(token+'bad'),null); assert.equal(seals.open(seals.seal({x:1},-1)),null);
  assert.equal(equal('é','a'),false); assert.equal(equal(undefined,'x'),false);
  for(const shop of ['evil.com','x.myshopify.com@evil.com','x.myshopify.com/','127.0.0.1']) assert.throws(()=>validateShop(shop));
  const params=new URLSearchParams({shop:'sample.myshopify.com',state:'nonce',code:'code'}); const msg=[...params].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('&'); params.set('hmac',createHmac('sha256','oauthsecret').update(msg).digest('hex')); assert(verifyOAuth(params,'oauthsecret')); params.append('shop','sample.myshopify.com'); assert(!verifyOAuth(params,'oauthsecret'));
});
await test('Approval binds design, catalog and session; changed or unapproved ZIP rejected',async t=>{
  const base=await start(t), a=await client(base), b=await client(base); const body={design,catalog};
  assert.equal((await a.call('/api/preview',null)).status,400);
  assert.equal((await a.call('/api/preview',body,{'X-CSRF-Token':'invalid'})).status,403);
  assert.equal((await a.call('/api/preview',body,{Origin:'https://evil.example'})).status,403);
  assert.equal((await a.call('/api/generate',{...body,prompt:'Nieuwe winkel'})).status,503);
  const view=await(await a.call('/api/preview',body)).json(); assert.equal((await b.call(view.url)).status,404); assert.equal((await a.call(view.url)).status,200);
  await a.call('/api/preview',{...body,route:'/cart'}); assert.equal((await a.call(view.url)).status,200,'Another tab must keep its preview');
  assert.equal((await a.call('/api/export',body)).status,409);
  assert.equal((await a.call('/api/approve',{...body,digest:view.digest,confirm:false})).status,409);
  const approved=await(await a.call('/api/approve',{...body,digest:view.digest,confirm:true})).json();
  assert.equal((await b.call('/api/export',{...body,approval:approved.approval})).status,409);
  assert.equal((await a.call('/api/export',{...body,design:{...design,brand:'Changed'},approval:approved.approval})).status,409);
  assert.equal((await a.call('/api/export',{...body,catalog:{...catalog,currency:'USD'},approval:approved.approval})).status,409);
  const r=await a.call('/api/export',{...body,approval:approved.approval}); assert.equal(r.status,200); assert.equal(r.headers.get('x-theme-digest'),view.digest); assert.deepEqual(unzip(Buffer.from(await r.arrayBuffer())),compileTheme(design).files);
  assert.match((await a.call('/')).headers.get('content-security-policy'),/script-src 'self'/);
  assert(!JSON.stringify(a.session).includes(secret));
});
await test('Asynchronous AI job is private to the initiating session',async t=>{
  const fetcher=async()=>json({candidates:[{content:{parts:[{text:JSON.stringify({message:'Klaar',memory:'Brief',design})}]}}]});
  const base=await start(t,{GEMINI_API_KEY:'test-key'},fetcher), a=await client(base), b=await client(base);
  const job=await(await a.call('/api/generate',{design,catalog,prompt:'Ontwerp'})).json(); assert(job.jobId); assert.equal((await b.call('/api/jobs/'+job.jobId)).status,404); const result=await poll(a,job.jobId); assert.equal(result.status,'complete'); assert.equal(result.result.mode,'generative');
});
await test('Shopify import paginates, preserves real image/variant data, flags partial records',async()=>{
  const calls=[];
  const fetcher=async(url,o)=>{assert.equal(o.headers['X-Shopify-Access-Token'],'token'); const {query,variables}=JSON.parse(o.body);calls.push({query,variables});
    if(query===QUERIES.shop)return json({data:{shop:{name:'Sample',myshopifyDomain:'canonical.myshopify.com',currencyCode:'EUR',currencyFormats:{moneyWithCurrencyFormat:'€{{amount_with_comma_separator}} EUR'}},currentAppInstallation:{accessScopes:[{handle:'read_products'}]}}});
    if(query===QUERIES.products)return json({data:{products:{nodes:variables.after?[]:[{id:'gid://shopify/Product/1',handle:'chair',title:'Chair',vendor:'Maker',description:'Text',onlineStoreUrl:'https://sample.myshopify.com/products/chair',media:{nodes:[{image:{url:catalog.products[0].image}}],pageInfo:{hasNextPage:false}},variants:{nodes:[{id:'gid://shopify/ProductVariant/21',title:'Oak',price:'19.99',availableForSale:true}],pageInfo:{hasNextPage:true}}}],pageInfo:{hasNextPage:!variables.after,endCursor:'next-product'}}}});
    return json({data:{collections:{nodes:[{handle:'seating',title:'Seating',image:{url:catalog.products[0].image},products:{nodes:[{handle:'chair'}],pageInfo:{hasNextPage:false}}}],pageInfo:{hasNextPage:false}}}});
  };
  const r=await importCatalog({shop:'sample.myshopify.com',token:'token'},fetcher); assert.equal(calls.length,4); assert.equal(r.catalog.shop,'sample.myshopify.com'); assert.equal(r.catalog.products[0].price,1999); assert.equal(r.catalog.products[0].vendor,'Maker'); assert.equal(r.catalog.products[0].variants[0].id,'21'); assert.equal(r.catalog.partial,true); assert.equal(r.catalog.collections[0].productHandles[0],'chair');
});
await test('OAuth rejects forgery/replay; theme upload requires separate approval and is UNPUBLISHED only',async t=>{
  let creates=0; const requests=[];
  const fetcher=async(url,o)=>{requests.push({url,body:JSON.parse(o.body)});if(url.endsWith('/access_token'))return json({access_token:'shopify-secret-token',scope:'read_products,read_themes,write_themes'});const {query}=JSON.parse(o.body);if(query===QUERIES.shop)return json({data:{currentAppInstallation:{accessScopes:[{handle:'write_themes'}]}}});if(query===QUERIES.create){creates++;assert.match(query,/role: UNPUBLISHED/);return json({data:{themeCreate:{theme:{id:'gid://shopify/OnlineStoreTheme/123',name:'Draft',role:'UNPUBLISHED',processing:false,processingFailed:false},userErrors:[]}}});}throw Error('Unexpected API request');};
  const base=await start(t,{SHOPIFY_API_KEY:'client-id',SHOPIFY_API_SECRET:'oauth-secret',SHOPIFY_THEME_UPLOAD_ENABLED:'1'},fetcher), c=await client(base);
  const connect=await(await c.call('/api/shopify/connect',{shop:catalog.shop})).json(); const auth=new URL(connect.url);assert.equal(auth.hostname,catalog.shop);assert.equal(auth.searchParams.get('scope'),'read_products,read_themes,write_themes');
  const params=new URLSearchParams({shop:catalog.shop,code:'one-time-code',state:auth.searchParams.get('state'),timestamp:String(Math.floor(Date.now()/1000))}); const msg=[...params].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('&');params.set('hmac',createHmac('sha256','oauth-secret').update(msg).digest('hex'));
  assert.equal((await c.call('/auth/shopify/callback?'+params.toString().replace('hmac=','hmac=x'))).status,403);
  const callback='/auth/shopify/callback?'+params;assert.equal((await c.call(callback)).status,303);assert.equal((await c.call(callback)).status,403);
  const info=await(await c.call('/api/session')).json();assert(info.shopify.connected);assert(!JSON.stringify(info).includes('shopify-secret-token'));assert(!c.jar.get('sc_shop').includes('shopify-secret-token'));
  const body={design,catalog}, digest=compileTheme(design).digest, approval=(await(await c.call('/api/approve',{...body,digest,confirm:true})).json()).approval;
  assert.equal((await c.call('/api/shopify/upload',{...body,approval})).status,403); assert.equal(creates,0);
  assert.equal((await c.call('/api/shopify/upload',{...body,catalog:{...catalog,shop:'another.myshopify.com'},approval,confirmUpload:true})).status,409);
  const first=await(await c.call('/api/shopify/upload',{...body,approval,confirmUpload:true})).json();const job=await poll(c,first.jobId);assert.equal(job.result.theme.role,'UNPUBLISHED');
  const second=await(await c.call('/api/shopify/upload',{...body,approval,confirmUpload:true})).json();assert.equal(second.jobId,first.jobId);assert.equal(creates,1);
  const create=requests.find(r=>r.body.query===QUERIES.create);const source=new URL(create.body.variables.source);const sourceZIP=await fetch(base+source.pathname);assert.equal(sourceZIP.status,200);assert.deepEqual(unzip(Buffer.from(await sourceZIP.arrayBuffer())),compileTheme(design).files);
  assert(!requests.some(r=>/themePublish|themeDelete|themeUpdate|themeFilesUpsert/.test(r.body.query||'')));
});
await test('Production source contains no anonymous provider or Shopify publish/update mutation',async()=>{
  const source=await readFile(new URL('../shopify.mjs',import.meta.url),'utf8');assert(!/themePublish|themeDelete|themeUpdate/.test(source));const ai=await readFile(new URL('../ai.mjs',import.meta.url),'utf8');assert(!/pollinations|puter|built-in/.test(ai));
});
