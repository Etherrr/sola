/* global console */
import { stat, readFile } from 'node:fs/promises';
const routes=['/','/start/','/start/wallets/','/start/security/','/start/networks/','/start/defi/','/connect/','/portfolio/','/portfolio/assets/','/portfolio/positions/','/portfolio/risk/','/explore/','/track/','/learn/network-journey/','/learn/','/learn/addresses/','/learn/risks/','/settings/'];
for(const route of routes){
  const path='out'+route+'index.html';
  const file=await readFile(path,'utf8');
  if(!file.includes('<h1')) throw Error('No h1: '+path);
}
for(const path of ['out/404.html','out/_headers']) await stat(path);
console.log('Static export verified: '+routes.length+' routes, 404 and headers');
