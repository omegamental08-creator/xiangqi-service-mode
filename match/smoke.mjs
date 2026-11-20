import { launchChrome } from './cdp.mjs';
const b = await launchChrome({ port: 9333 });
const page = await b.newPage('data:text/html,<h1 id=t>hi</h1>');
const v = await b.evaluate(page.sessionId, 'document.getElementById("t").textContent + "|" + (1+1)');
console.log('EVAL:', v);
const ua = await b.evaluate(page.sessionId, 'navigator.userAgent');
console.log('UA:', ua);
await b.close();
console.log('OK');
