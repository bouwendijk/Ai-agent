import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {revise} from './engine.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const requests=new Map();
let remoteRetryAfter=0;
const keys=['brand','niche','audience','language','style','bg','ink','surface','accent','eyebrow','hero','subtitle','cta','collectionHeading','products','benefits','storyHeading','storyText'];
const system='You are StoreCrew, an expert ecommerce creative director, merchandiser, UX designer, Shopify theme designer, CRO and SEO team in one AI. You receive a design spec plus a request. Return ONLY a JSON object with ALL spec keys brand,niche,audience,language,style,bg,ink,surface,accent,eyebrow,hero,subtitle,cta,collectionHeading,products,benefits,storyHeading,storyText,assistantMessage. Honor targeted edits: if they ask to change only button color, preserve everything else. Design colors are valid hex #rrggbb. Make original compelling premium but truthful copy in selected nl/en language; user conversation is in Dutch. 1-8 concept products and 3 benefits. Never invent reviews, inventory, pricing, business performance, supplier claims, shipping guarantees or photo assets. Explain modifications in 1 short Dutch sentence.';
function reply(res,status,obj){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj))}
function sanitize(raw,previous){const p={...previous};for(const k of keys){let v=raw[k];if(['bg','ink','surface','accent'].includes(k)){if(typeof v==='string'&&/^#[0-9a-fA-F]{6}$/.test(v))p[k]=v}else if(k==='products'||k==='benefits'){if(Array.isArray(v)){const arr=v.filter(x=>typeof x==='string'&&x.trim()).slice(0,k==='products'?8:4).map(x=>x.trim().slice(0,90));if(arr.length)p[k]=arr}}else if(typeof v==='string'&&v.trim())p[k]=v.trim().slice(0,230)}p.language=p.language==='en'?'en':'nl';return p}
async function remoteDesign(spec,prompt,history){
 const payload=JSON.stringify({currentSpec:spec,request:prompt,previousTurns:history.slice(-6)});
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),8500);
 try{
   let result;
   if(process.env.POLLINATIONS_API_KEY){
     const response=await fetch('https://gen.pollinations.ai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.POLLINATIONS_API_KEY},body:JSON.stringify({model:'openai/gpt-5.4-nano',messages:[{role:'system',content:system},{role:'user',content:payload}],temperature:.6,max_tokens:1100}),signal:controller.signal});
     if(!response.ok)throw Error('Provider '+response.status);
     result=(await response.json()).choices?.[0]?.message?.content;
   }else{
     // Anonymous public endpoint is best effort and rate-limited; never required for the no-login studio.
     const short=payload.slice(0,2300);
     const query='Return a full JSON storefront spec (all keys of the current spec) and assistantMessage. Preserve fields outside the request. '+system+' INPUT: '+short;
     const endpoint='https://text.pollinations.ai/'+encodeURIComponent(query)+'?json=true&private=true&model=openai';
     const response=await fetch(endpoint,{signal:controller.signal,headers:{Accept:'application/json'}});
     if(!response.ok)throw Error('Anonymous provider '+response.status);
     result=await response.text();
   }
   if(typeof result!=='string'||result.length>22000)throw Error('Invalid model output');
   const match=result.match(/\{[\s\S]*\}/);
   if(!match)throw Error('No structured model output');
   const parsed=JSON.parse(match[0]);
   if(!parsed||typeof parsed!=='object'||!Object.keys(parsed).some(k=>keys.includes(k)))throw Error('Empty design response');
   return {spec:sanitize(parsed,spec),assistantMessage:typeof parsed.assistantMessage==='string'?parsed.assistantMessage.slice(0,260):'Ik heb je webshopontwerp aangepast. Bekijk het voorbeeld.',mode:'generative',changed:true};
 }finally{clearTimeout(timer)}
}
async function design(req,res){
 const ip=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'anonymous').toString().split(',')[0].slice(0,70),now=Date.now();
 let hits=requests.get(ip)||[];hits=hits.filter(t=>now-t<60000);
 if(hits.length>=18)return reply(res,429,{error:'Even wachten: maximaal 18 verzoeken per minuut.'});
 hits.push(now);requests.set(ip,hits);
 let buf='',size=0;
 try{for await(const chunk of req){size+=chunk.length;if(size>18000)return reply(res,413,{error:'Verzoek te lang.'});buf+=chunk}}
 catch{return reply(res,400,{error:'Verzoek niet leesbaar.'})}
 let data;try{data=JSON.parse(buf)}catch{return reply(res,400,{error:'Geen geldig verzoek.'})}
 const prompt=typeof data.prompt==='string'?data.prompt.trim().slice(0,1100):'';
 if(prompt.length<2)return reply(res,400,{error:'Beschrijf eerst welke webshop je wilt.'});
 const spec=(data.spec&&typeof data.spec==='object'&&!Array.isArray(data.spec))?sanitize(data.spec,{}):{};
 const history=Array.isArray(data.history)?data.history.filter(t=>t&&typeof t.text==='string').slice(-6).map(t=>({role:t.role==='user'?'user':'assistant',text:t.text.slice(0,300)})):[];
 // Always compute a usable instant offline fallback, even when AI quota is exceeded.
 const fallback=revise(spec,prompt);
 if(Date.now()>remoteRetryAfter){
   try{
      const ai=await remoteDesign(spec,prompt,history);
      if(JSON.stringify(ai.spec)!==JSON.stringify(spec))return reply(res,200,ai);
   }catch(e){console.warn('Free upstream unavailable, using local design engine:',e.message);remoteRetryAfter=Date.now()+300000}
 }
 return reply(res,200,fallback)
}
http.createServer(async(req,res)=>{
 const p=new URL(req.url,'http://localhost').pathname;
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
 if(p==='/health'){return reply(res,200,{ok:true,product:'StoreCrew AI',noLogin:true,design:'AI when available, built-in studio always available'})}
 if(p==='/api/design'&&req.method==='POST')return design(req,res);
 if(!['/','/index.html'].includes(p)||req.method!=='GET'){res.writeHead(404);return res.end('Not found')}
 try{const page=await readFile(path.join(root,'public/index.html'));res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; frame-src 'self' blob: https:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'"});res.end(page)}
 catch(e){console.error(e);res.writeHead(500);res.end('Website kon niet laden')}
}).listen(process.env.PORT||3000,'0.0.0.0');
