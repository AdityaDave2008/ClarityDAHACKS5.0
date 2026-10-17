import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:5180';
const image = (await readFile(new URL('../../.cache/cat-and-dog.jpg',import.meta.url))).toString('base64');
const browser = await chromium.launch({channel:'chrome',headless:true});
const page = await browser.newPage({viewport:{width:390,height:844}});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{if(message.type()==='error') console.log('BROWSER:',message.text());});
await page.addInitScript(({image})=>{
  navigator.mediaDevices.getUserMedia=async()=>{
    const photo = new Image(); photo.src=`data:image/jpeg;base64,${image}`; await photo.decode();
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
    const draw=()=>{canvas.getContext('2d').drawImage(photo,0,0,640,480);};
    draw(); const interval=setInterval(draw,100);
    const stream=canvas.captureStream(10);
    stream.getVideoTracks()[0].addEventListener('ended',()=>clearInterval(interval));
    return stream;
  };
},{image});
try {
  await page.goto(`${origin}/camera.html`);
  await page.locator('#live-tab').click();
  await page.locator('#start-button').click();
  await page.waitForFunction(()=>Number(document.querySelector('#frame-count').textContent)>=3,{},{timeout:90000});
  console.log('LIVE:',await page.locator('#status-title').textContent(),await page.locator('#frame-count').textContent());
  // Real inference on an attributed test photo: no detector responses are mocked.
  const detections=await page.evaluate(async(image)=>{
    const {LocalDetector}=await import('/local-detector.js');
    const detector=new LocalDetector(); await detector.ready;
    try { const blob=await(await fetch(`data:image/jpeg;base64,${image}`)).blob();return await detector.detect(await createImageBitmap(blob),performance.now()); }
    finally { detector.close(); }
  },image);
  console.log('MODEL:',JSON.stringify(detections));
  if(!detections.detections.length) throw new Error('Real model detected no objects in the sample image.');
  await page.locator('#start-button').click();
  const count=await page.locator('#frame-count').textContent();
  await page.waitForTimeout(1000);
  if(await page.locator('#frame-count').textContent()!==count) throw new Error('Frames continued after Stop.');
  await page.locator('#start-button').click();
  await page.waitForFunction(()=>Number(document.querySelector('#frame-count').textContent)>=2,{},{timeout:60000});
  await page.locator('#start-button').click();
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw new Error('Mobile layout overflows.');
  if(errors.length) throw new Error(errors.join('\n'));
  await page.screenshot({path:new URL('../../.run-logs/iphone-layout.png',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'),fullPage:true});
  await writeFile(new URL('../../.run-logs/camera-validation.json',import.meta.url),JSON.stringify({origin,detected: detections.detections,errors,checks:['real MediaPipe inference','camera UI loop','stop','restart','390px layout']},null,2));
  console.log('PASS: real inference, start/stop/restart, mobile layout, no uncaught page errors');
} finally { await browser.close(); }
