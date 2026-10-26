import { stat, readFile, readdir } from 'node:fs/promises';
const prodRoutes=['/','/start/','/start/wallets/','/start/security/','/start/networks/','/start/defi/','/connect/','/account/','/account/legacy-bridge/','/account/overview/','/account/assets/','/account/defi/','/account/risk/','/portfolio/','/portfolio/assets/','/portfolio/positions/','/portfolio/risk/','/explore/','/track/','/markets/','/learn/network-journey/','/learn/security-lab/','/learn/','/learn/addresses/','/learn/risks/','/learn/start-here/','/learn/wallets/','/learn/security/','/learn/defi-strategies/','/learn/lending-and-risk/','/learn/networks/','/settings/','/education/','/sign-in/','/create-account/','/onboarding/','/demo/','/demo/assets/','/demo/positions/','/demo/risk/'];
// Dev surfaces exist ONLY when built with SOLA_INCLUDE_DEV_PAGES=1 (local dev and
// the Pages PREVIEW environment); a production export must not contain any of them.
const devRoutes=['/dev/assets-v2/','/dev/claim/','/dev/create-account/','/dev/defi-v2/','/dev/overview-v2/','/dev/risk-v2/','/dev/sign-in/','/dev/wallet-test/','/dev/welcome/'];
const includeDev = process.env.SOLA_INCLUDE_DEV_PAGES === '1';
const routes = includeDev ? [...prodRoutes, ...devRoutes] : prodRoutes;
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
if (!includeDev && found.some((r) => r.startsWith('/dev/')))
  throw Error('Production export contains a /dev/ route - dev surfaces must not ship.');
if (includeDev && !found.some((r) => r.startsWith('/dev/')))
  throw Error('SOLA_INCLUDE_DEV_PAGES=1 build exported no /dev/ routes - gating is broken.');
for(const route of routes){
  const path='out'+route+'index.html';
  const file=await readFile(path,'utf8');
  if(!file.includes('<h1')) throw Error('No h1: '+path);
}
for(const path of ['out/404.html','out/_headers','out/_redirects']) await stat(path);
// Every compatibility redirect the Education consolidation (plan §8) promises must be present.
const redir = await readFile('out/_redirects', 'utf8');
for (const rule of ['/start/ /learn/start-here/ 308','/start/wallets/ /learn/wallets/ 308','/start/security/ /learn/security/ 308','/start/defi/ /learn/defi-strategies/ 308','/start/networks/ /learn/networks/ 308','/learn/risks/ /learn/lending-and-risk/ 308'])
  if (!redir.includes(rule)) throw Error('Missing _redirects rule: ' + rule);
console.log('Static export verified ('+(includeDev?'dev':'production')+' mode): '+routes.length+' routes, 404 and headers');

// Production portfolio routes must never contain invented fixture holdings.
for (const route of ['/account/overview/','/account/assets/','/account/defi/','/account/risk/','/demo/','/demo/assets/','/demo/positions/','/demo/risk/','/portfolio/','/portfolio/assets/','/portfolio/positions/','/portfolio/risk/']) {
  const html = await readFile('out'+route+'index.html','utf8');
  if (/Priced net sample value|Priced sample assets|Sample borrowed debt|Invented Ethereum and Solana holdings|\$12,000|\$11,000/.test(html))
    throw Error('Invented portfolio content exported: '+route);
}
