// Starts the native fixture worker on 127.0.0.1:8789 with a local in-memory workerd D1 binding.
import { Miniflare } from 'miniflare';
const mf = new Miniflare({
  modules: true,
  scriptPath: new URL('./fixture-native-worker.mjs', import.meta.url).pathname,
  d1Databases: { DB: 'sola-native-fixture' },
  d1Persist: false,
  host: '127.0.0.1',
  port: 8789,
  compatibilityDate: '2024-12-01',
});
await mf.ready;
console.log('native fixture worker on http://127.0.0.1:8789');
process.on('SIGTERM', () => mf.dispose().then(() => process.exit(0)));
process.on('SIGINT', () => mf.dispose().then(() => process.exit(0)));
