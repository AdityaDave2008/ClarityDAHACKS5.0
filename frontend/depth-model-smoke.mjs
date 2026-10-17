// Manual real-browser smoke: node frontend/depth-model-smoke.mjs /absolute/photo.png
// Open printed localhost URL, click Run. Model assets stream through the shared allowlisted handler.
// The helper never uploads frames and does not download or commit the photo for you.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { handleDepthAsset } from '../worker/src/depth-assets.js';
const photo = process.argv[2];
if (!photo) throw Error('Usage: node frontend/depth-model-smoke.mjs /absolute/photo.png');
const root = new URL('./', import.meta.url);
const html = `<!doctype html><meta charset="utf-8"><title>Depth model local smoke</title>
<button id="run">Run optional depth model (~50 MB)</button><pre id="result">Ready</pre><canvas id="frame"></canvas>
<script type="module">
import {createDepthModel} from '/depth-model.js';
const out=document.querySelector('#result');
document.querySelector('#run').onclick=async()=>{
  const model=createDepthModel();const start=performance.now();
  try {
    const image=new Image();image.src='/photo';await image.decode();
    const canvas=document.querySelector('canvas');canvas.width=320;canvas.height=Math.round(320*image.height/image.width);
    canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
    const loaded=await model.load({onStatus:s=>out.textContent=JSON.stringify(s)});
    const loadMs=performance.now()-start;const t=performance.now();let ticks=0,maxTickGap=0,lastTick=t;
    const timer=setInterval(()=>{ticks++;maxTickGap=Math.max(maxTickGap,performance.now()-lastTick);lastTick=performance.now()},20);
    let map;try{map=await model.estimate(canvas)}finally{clearInterval(timer)}
    let min=Infinity,max=-Infinity,finite=0;for(const x of map.data){min=Math.min(min,x);max=Math.max(max,x);finite+=Number.isFinite(x)}
    const points={};for(const [label,x,y] of [['top',.5,.1],['center',.5,.5],['bottom',.5,.9],['frontDivider',.43,.5],['backRecess',.34,.72]])points[label]=map.data[Math.floor(y*map.height)*map.width+Math.floor(x*map.width)];
    window.depthSmoke={device:loaded.device,loadMs,inferenceMs:performance.now()-t,ticks,maxTickGap,width:map.width,height:map.height,finite,min,max,points,crossOriginIsolated,userAgent:navigator.userAgent};
    out.textContent=JSON.stringify(window.depthSmoke,null,2);
  }catch(e){window.depthSmoke={error:String(e),stack:e.stack};out.textContent=JSON.stringify(window.depthSmoke,null,2)}
  finally{await model.dispose()}
};</script>`;
const allowed = new Set(['/depth-model.js', '/vendor-depth/depth-worker.js', '/vendor-depth/transformers.min.js', '/vendor-depth/ort-wasm-simd-threaded.jsep.mjs', '/vendor-depth/ort-wasm-simd-threaded.jsep.wasm']);
const server=http.createServer(async(req,res)=>{
  try {
    const path=new URL(req.url,'http://localhost').pathname;
    if(path==='/depth-assets'||path.startsWith('/depth-assets/')) {
      const asset=await handleDepthAsset(new Request(new URL(req.url,'http://127.0.0.1:8799'),{method:req.method}));
      res.writeHead(asset.status,Object.fromEntries(asset.headers));
      if(asset.body) {
        const body=Readable.fromWeb(asset.body);
        body.on('error',error=>res.destroy(error));
        body.pipe(res);
      } else res.end();
      return;
    }
    if(path==='/'){res.setHeader('content-type','text/html');res.end(html);return;}
    if(path!=='/photo'&&!allowed.has(path)){res.writeHead(404);res.end();return;}
    res.setHeader('content-type',path.endsWith('.wasm')?'application/wasm':path==='/photo'?'image/png':'text/javascript');
    res.end(await readFile(path==='/photo'?photo:fileURLToPath(new URL('.'+path,root))));
  }catch(e){res.writeHead(500);res.end(String(e));}
});
server.listen(8799,'127.0.0.1',()=>console.log('Open http://127.0.0.1:8799 (no COOP/COEP headers)'));
