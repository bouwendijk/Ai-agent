import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
http.createServer(async(req,res)=>{
  const p=new URL(req.url,'http://localhost').pathname;
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  if(p==='/health'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({ok:true,product:'StoreCrew AI',ai:'Puter user allowance'}));}
  if(!['/','/index.html'].includes(p)){res.writeHead(404);return res.end('Not found');}
  try{const page=await readFile(path.join(root,'public/index.html'));res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline' https://js.puter.com https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; frame-src 'self' blob: https:; connect-src 'self' https:; object-src 'none'; base-uri 'self'"});res.end(page)}
  catch(e){console.error(e);res.writeHead(500);res.end('App failed to load')}
}).listen(process.env.PORT||3000,'0.0.0.0');