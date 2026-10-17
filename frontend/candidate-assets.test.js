import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
test('browser manifest pins exact candidate and runtime asset hashes',()=>{
 const path=new URL('./vendor/yolox-51661711/ASSETS.json',import.meta.url);const manifest=JSON.parse(readFileSync(path));
 assert.equal(manifest.onnxRuntimeVersion,'1.20.1');
 for(const [name,item] of Object.entries(manifest.files)) {const bytes=readFileSync(new URL(name,path));assert.equal(bytes.length,item.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256);}
 assert.equal(manifest.files['candidate.onnx'].sha256,'516617114420ce3c2bac545869ee91bac8ff7a63e148a73afdb12f126433fab4');
});
test('main camera discloses experimental identity and limitations',()=>{
 const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');assert.ok(html.includes('Experimental YOLOX candidate'));assert.ok(html.includes('Empty results do not mean a clear path'));
});
