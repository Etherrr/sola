import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';

const root = resolve('out');
const port = Number(process.env.PORT || 3000);
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon', '.woff2':'font/woff2' };
const headers = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy':'no-referrer',
  'X-Frame-Options':'DENY', 'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
  'X-Robots-Tag':'noindex, nofollow',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
};
createServer(async (req,res)=>{
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  let decoded;
  try { decoded=decodeURIComponent(pathname); } catch {res.writeHead(400);res.end();return;}
  if(decoded.includes('\\') || decoded.split('/').includes('..')){res.writeHead(400);res.end();return;}
  if(!decoded.endsWith('/') && !extname(decoded)){
    res.writeHead(308, {Location:decoded+'/'});
    res.end();return;
  }
  const candidate = decoded.endsWith('/') ? decoded+'index.html' : decoded;
  let filepath=resolve(root,'.'+candidate);
  if(!(filepath===root || filepath.startsWith(root+sep))){res.writeHead(403);res.end();return;}
  let code=200;
  try {if(!(await stat(filepath)).isFile()) throw Error('missing');}catch{filepath=resolve(root,'404.html');code=404;}
  try{
    const body=await readFile(filepath);
    // HTML documents are never stored (mirrors public/_headers): keeps the back-forward cache
    // from repainting identity or saved data after a logout in supporting engines.
    const cache = extname(filepath)==='.html' ? {'Cache-Control':'no-store'} : {};
    res.writeHead(code,{...headers,...cache,'Content-Type':mime[extname(filepath)] || 'application/octet-stream'});
    res.end(req.method==='HEAD'?undefined:body);
  }catch{res.writeHead(500);res.end('Static export not found. Run npm run build.');}
}).listen(port,'127.0.0.1',()=>console.log('Static preview on http://127.0.0.1:'+port));
