import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
const moduleURL=new URL('../src/preview.js',import.meta.url);
test('preview routes only allowlisted model assets and static files, never frame uploads',async()=>{
 assert.ok(existsSync(moduleURL),'Missing preview worker');const {default:worker}=await import(moduleURL);
 const requests=[];const env={ASSETS:{fetch:async r=>{requests.push(r.url);return new Response('static');}}};
 assert.equal(await (await worker.fetch(new Request('https://example.test/'),env)).text(),'static');
 const unknown=await worker.fetch(new Request('https://example.test/depth-assets/arbitrary'),env);assert.equal(unknown.status,404);
 const post=await worker.fetch(new Request('https://example.test/api/v1/sessions',{method:'POST'}),env);assert.equal(post.status,405);
 const traversal=await worker.fetch(new Request('https://example.test/depth-assets/x/%2e%2e/private'),env);assert.equal(traversal.status,404);
 assert.equal(requests.length,1);
});
