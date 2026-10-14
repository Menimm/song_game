import { createApp } from '../src/app.js';
import { config } from '../config.js';

const app = await createApp({ config });
const port = await app.listen();
console.log(`Host   : http://localhost:${port}/host   (open in Chrome)`);
console.log(`TV     : http://localhost:${port}/tv`);
console.log(`Phones : ${app.joinUrl()}`);
console.log(`Manage PIN (for other devices): ${config.pin}`);
