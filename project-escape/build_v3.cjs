/* PROJECT ESCAPE V3 reproducible build: reconstructs the reviewed single-file HTML
   from its exact previous revision plus a compressed UTF-8 diff. No external fetches. */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const root = __dirname;
const base = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
function fnv(s) { let h=2166136261; for(const c of s) h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;return h>>>0; }
if(base.length!==101845 || fnv(base)!==0xc922ad33) throw Error('Project Escape base revision changed; refusing to apply V3 patch');
const encoded = fs.readFileSync(path.join(root,'v3patch.part1'),'utf8').trim()
  +fs.readFileSync(path.join(root,'v3patch.part2'),'utf8').trim();
if(encoded.length!==7964) throw Error('Compressed V3 patch is incomplete');
const patch=JSON.parse(zlib.brotliDecompressSync(Buffer.from(encoded,'base64')).toString('utf8'));
let out='',last=0;
for(const entry of patch){const [start,end,insert]=entry;
 if(!Number.isInteger(start)||!Number.isInteger(end)||start<last||end<start||end>base.length||typeof insert!=='string') throw Error('Invalid V3 patch range');
 out+=base.slice(last,start)+insert;last=end;
}
out+=base.slice(last);
if(out.length!==115751 || fnv(out)!==0x714a074c || !out.includes('KERNEL CONTROL') || !out.includes('10 LAYERS')) throw Error('V3 content verification failed');
const dir=path.join(root,'public');fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'index.html'),out,'utf8');
console.log('V3 VERIFIED — 10 simulated layers, '+out.length+' UTF-16 code units');
