import { stat, readFile, readdir } from 'node:fs/promises';
const routes=['/','/start/','/start/wallets/','/start/security/','/start/networks/','/start/defi/','/connect/','/portfolio/','/portfolio/assets/','/portfolio/positions/','/portfolio/risk/','/explore/','/track/','/markets/','/learn/network-journey/','/learn/security-lab/','/learn/','/learn/addresses/','/learn/risks/','/settings/','/education/'];
// Every exported page must be in the list above, so a new route cannot ship unchecked.
async function pages(dir, base) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('_') || e.name === '404') continue;
    if (e.isDirectory()) out.push(...(await pages(dir + '/' + e.name, base + e.name + '/')));
    else if (e.name === 'index.html') out.push(base);
  }
  return out;
}
const found = (await pages('out', '/')).sort();
const missing = found.filter((r) => !routes.includes(r));
const gone = routes.filter((r) => !found.includes(r));
if (missing.length || gone.length) throw Error('Route list out of date. Unchecked: ' + missing + ' Missing from export: ' + gone);
for(const route of routes){
  const path='out'+route+'index.html';
  const file=await readFile(path,'utf8');
  if(!file.includes('<h1')) throw Error('No h1: '+path);
}
for(const path of ['out/404.html','out/_headers']) await stat(path);
console.log('Static export verified: '+routes.length+' routes, 404 and headers');
