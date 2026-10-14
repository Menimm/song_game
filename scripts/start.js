import QRCode from 'qrcode';
import { createApp, lanUrl } from '../src/app.js';
import { startTunnel } from '../src/tunnel.js';
import { config } from '../config.js';

const app = await createApp({ config });
const port = await app.listen();
const lan = lanUrl(port);

let tunnel = null;
if (!process.argv.includes('--no-tunnel')) {
  try { tunnel = await startTunnel(port); }
  catch (e) { console.warn(`\n! No public tunnel (${e.message}).\n! Falling back to the home network only: every phone must be on the same Wi-Fi as this computer.\n`); }
}
app.setPublicUrl(tunnel ? tunnel.url : lan);

const phones = app.joinUrl();
console.log(await QRCode.toString(phones, { type: 'terminal', small: true }));
console.log(`Room code     : ${app.game.code}`);
console.log(`Phones        : ${phones}${tunnel ? '   (public tunnel)' : '   (home network only)'}`);
console.log(`Host (Chrome) : http://localhost:${port}/host`);
console.log(`TV            : http://localhost:${port}/tv`);
console.log(`Song manager  : http://localhost:${port}/manage   (PIN from other devices: ${config.pin})`);
console.log(`Music folder  : ${config.musicDir}`);

const stop = async () => { tunnel?.stop(); await app.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
