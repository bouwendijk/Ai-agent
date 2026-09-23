/* PROJECT ESCAPE NIGHTMARE V4: reconstruct verified static app from deterministic
   V3 build output and an exact compressed patch. All execution is local-only. */
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const root=__dirname;
function fnv(s){let h=2166136261;for(const c of s)h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;return h>>>0;}
const pathname=path.join(root,'public','index.html');
const base=fs.readFileSync(pathname,'utf8');
if(base.length!==115751||fnv(base)!==0x714a074c)throw Error('Unexpected V3 baseline');
const encoded=fs.readFileSync(path.join(root,'v4patch.b64'),'utf8').trim();
if(encoded.length!==3388)throw Error('Incomplete V4 patch');
const patch=JSON.parse(zlib.brotliDecompressSync(Buffer.from(encoded,'base64')).toString('utf8'));
let out='',last=0;
for(const [start,end,insert] of patch){
 if(!Number.isInteger(start)||!Number.isInteger(end)||start<last||end<start||end>base.length||typeof insert!=='string')throw Error('Invalid patch');
 out+=base.slice(last,start)+insert;last=end;
}
out+=base.slice(last);
if(out.length!==118798||fnv(out)!==0x231a6410)throw Error('V4 verification failed');
if(!out.includes('codeRounds:5')||!out.includes('codeRounds:8')||!out.includes('SLUIS'))throw Error('Critical V4 challenge features missing');
fs.writeFileSync(pathname,out,'utf8');
console.log('V4 VERIFIED — 10 stages, 5-8 independent code rounds, '+out.length+' characters');