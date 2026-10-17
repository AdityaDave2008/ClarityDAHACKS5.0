// Isolated Chromium acceptance with real bundled ONNX. No personal browser profile.
// PLAYWRIGHT_MODULE=/absolute/path/index.mjs CANDIDATE_FIXTURE=/path/cat-lossless.png node scripts/candidate-browser-smoke.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url = process.env.CANDIDATE_APP_URL || 'http://127.0.0.1:5191/';
const fixture = `data:image/png;base64,${readFileSync(process.env.CANDIDATE_FIXTURE).toString('base64')}`;
const browser = await chromium.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const observations=[];
try {
 const context=await browser.newContext({permissions:['camera']});
 const page=await context.newPage();const errors=[],uploads=[],depthRequests=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.method()==='POST')uploads.push(r.url());if(/vendor-depth|huggingface/.test(r.url()))depthRequests.push(r.url());});
 // Seed the actual previous cache namespace, then activate the current service worker.
 await page.goto(new URL('/demo-scene.svg',url).href);
 await page.evaluate(async()=>{const cache=await caches.open('myeyes-pwa-v7-depth');await cache.put('/local-detector.js',new Response('old detector'));});
 assert.ok((await page.evaluate(()=>caches.keys())).includes('myeyes-pwa-v7-depth'));
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js');});
 await page.waitForFunction(async()=>{const keys=await caches.keys();return navigator.serviceWorker.controller&&keys.includes('myeyes-pwa-v8-yolox-51661711')&&!keys.includes('myeyes-pwa-v7-depth');},null,{timeout:90000});
 observations.push({check:'previous-version cache removal on real service-worker activation',pass:true});
 console.log('JCODE_PROGRESS '+JSON.stringify({message:'Cache upgrade passed'}));
 async function infer() {
  return page.evaluate(async fixture=>{
   const {loadCandidateModel,MODEL_SHA256,CANDIDATE_THRESHOLD}=await import('/candidate-model.js');
   const {assessDetections,createAlertPolicy}=await import('/local-detector.js');
   const model=await loadCandidateModel();const image=new Image();image.src=fixture;await image.decode();
   const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;canvas.getContext('2d').drawImage(image,0,0);
   const start=performance.now();const raw=await model.detect(canvas);const detections=assessDetections(raw,canvas.width,canvas.height);
   const policy=createAlertPolicy();const reasons=[policy.update(detections,1000).reason,policy.update(detections,1100).reason,policy.update(detections,1200).reason];
   return {hash:MODEL_SHA256,threshold:CANDIDATE_THRESHOLD,detections,reasons,ms:performance.now()-start};
  },fixture);
 }
 const first=await infer();console.log('JCODE_PROGRESS '+JSON.stringify({message:'Real inference returned',first}));assert.equal(first.threshold,.7874982953071594);const cat=first.detections.find(d=>d.label==='cat');assert.ok(cat,'Known lossless positive must survive tuned threshold');
 assert.ok(Math.abs(cat.confidence-.7931427443873815)<.002);assert.deepEqual(first.reasons,['confirming','triggered','cooldown']);
 for(const n of Object.values(cat.bbox))assert.ok(n>=0&&n<=1);
 observations.push({check:'real ONNX positive and policy/geometry',pass:true,...first});
 const expected=['candidate.onnx','ort.wasm.min.js','ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm'];
 const cached=await page.evaluate(async()=>{const c=await caches.open('myeyes-pwa-v8-yolox-51661711');return (await c.keys()).map(r=>new URL(r.url).pathname);});
 for(const name of expected)assert.ok(cached.includes('/vendor/yolox-51661711/'+name));
 if(await page.locator('#firstRunDialog').evaluate(el=>el.open)) {await page.locator('#setupNext').click();await page.locator('#setupNext').click();await page.locator('#setupFinish').click();}
 await page.locator('#camera-start').click();
 await page.waitForFunction(()=>/Detection running|Detecting on this device/.test(document.querySelector('#detection-status').textContent),null,{timeout:45000});
 await page.locator('#camera-stop').click();
 assert.equal(await page.locator('#camera-video').evaluate(el=>el.srcObject),null);
 await page.locator('#camera-start').click();
 await page.waitForFunction(()=>/Detection running|Detecting on this device/.test(document.querySelector('#detection-status').textContent),null,{timeout:45000});
 await page.locator('#camera-stop').click();
 assert.equal(depthRequests.length,0);assert.equal(uploads.length,0);
 observations.push({check:'real UI fake-camera start/stop/restart, no uploads or unsolicited depth',pass:true});
 await context.setOffline(true);await page.reload({waitUntil:'domcontentloaded'});
 const offline=await infer();assert.deepEqual(offline.detections,first.detections);assert.equal(uploads.length,0);
 observations.push({check:'offline reload and fresh WASM inference',pass:true,ms:offline.ms});
 assert.deepEqual(errors,[]);
 await context.close();
 // Bad model integrity must fail closed and a subsequent start must retry successfully.
 const retry=await browser.newContext({serviceWorkers:'block'});const retryPage=await retry.newPage();
 await retry.route('**/candidate.onnx',route=>route.fulfill({body:'corrupt model',contentType:'application/octet-stream'}));
 await retryPage.goto(url,{waitUntil:'domcontentloaded'});
 const failed=await retryPage.evaluate(async()=>{try {await (await import('/candidate-model.js')).loadCandidateModel();return 'unexpected success';}catch(e){return e.message;}});
 assert.match(failed,/integrity/);await retry.unroute('**/candidate.onnx');
 assert.equal(await retryPage.evaluate(async()=>Boolean(await (await import('/candidate-model.js')).loadCandidateModel())),true);
 observations.push({check:'corrupt model rejects then retry loads genuine runtime/model',pass:true});
 console.log(JSON.stringify({url,observations},null,2));
} finally {await browser.close();}
