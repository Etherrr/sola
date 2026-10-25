import { chromium } from '@playwright/test';
const b = await chromium.launch();
const page = await b.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE-ERR:', m.text().slice(0, 90)); });
await page.goto('http://127.0.0.1:3000/track/');
await page.waitForTimeout(1500);
console.log('load done');
await b.close();
