import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import {revise} from '../engine.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url));
const base={brand:'AETHER STUDIO',niche:'lifestyle essentials',audience:'designliefhebbers',language:'nl',style:'minimal',bg:'#f5f2eb',ink:'#1b2220',surface:'#e7e4dc',accent:'#346149',eyebrow:'COLLECTION',hero:'Meer dan gewoon.',subtitle:'Subtitle',cta:'Ontdek',collectionHeading:'Collectie',products:['One','Two','Three','Four'],benefits:['A','B','C'],storyHeading:'Story',storyText:'Text'};
let x=revise(base,'Maak een fitness webshop met een stoer zwart en neon groen design');
assert.equal(x.changed,true);assert.equal(x.spec.niche,'fitness');assert.equal(x.spec.bg,'#0b0f13');assert.equal(x.spec.products[0],'Push-up board');
let y=revise(x.spec,'Verander alleen de knop naar oranje en verander verder niets');
assert.equal(y.spec.accent,'#f78d35');for(const k of Object.keys(x.spec))if(k!=='accent')assert.deepEqual(y.spec[k],x.spec[k],'Unexpected change '+k);
let z=revise(base,'zet heel de site in het Engels');assert.equal(z.spec.language,'en');assert.equal(z.spec.cta,'Shop the collection');
let p=revise(base,'verander de hoofdtitel: Ontdek jouw eigen stijl');assert.equal(p.spec.hero,'Ontdek jouw eigen stijl');
const html=await readFile(path.join(dir,'../public/index.html'),'utf8');assert(!html.includes('js.puter.com'));assert(!html.includes('puter.ai.chat'));assert(html.includes("fetch('/api/design'"));const inline=html.match(/<script>\s*([\s\S]*?)<\/script>/);assert(inline,'Inline app script missing');new vm.Script(inline[1]);
const child=spawn(process.execPath,[path.join(dir,'../server.mjs')],{env:{...process.env,PORT:'31979',DISABLE_EXTERNAL_AI:'1'},stdio:'pipe'});
let active=false;try{for(let i=0;i<40;i++){try{const r=await fetch('http://127.0.0.1:31979/health');if(r.ok){active=true;break}}catch{}await new Promise(r=>setTimeout(r,150))}assert(active,'Server did not start');const health=await(await fetch('http://127.0.0.1:31979/health')).json();assert(health.ok&&health.noLogin);const result=await fetch('http://127.0.0.1:31979/api/design',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:'Maak een luxe sieraden webshop',spec:base,history:[]})});assert.equal(result.status,200);const obj=await result.json();assert.equal(obj.spec.niche,'sieraden');assert.equal(obj.mode,'built-in');const home=await(await fetch('http://127.0.0.1:31979/')).text();assert(home.includes('Geen account nodig'));console.log('PASS: UI syntax, no Puter, brand design, precise edit, language, hero, live /health and /api/design, homepage');}finally{child.kill('SIGTERM')}
