// Starts the fixture worker on 127.0.0.1:8788 with a local file-backed workerd D1 binding.
import { Miniflare } from 'miniflare';
const mf = new Miniflare({
  modules: true,
  scriptPath: new URL('./fixture-worker.mjs', import.meta.url).pathname,
  d1Databases: { DB: 'sola-fixture' },
  d1Persist: false, // in-memory: every run starts clean
  host: '127.0.0.1',
  port: 8788,
  compatibilityDate: '2024-12-01',
});
await mf.ready;
console.log('fixture worker on http://127.0.0.1:8788');
process.on('SIGTERM', () => mf.dispose().then(() => process.exit(0)));
process.on('SIGINT', () => mf.dispose().then(() => process.exit(0)));
