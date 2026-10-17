import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLocal, TrackAlertPolicy } from './perception.js';
const zone = [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
test('normalization retains low scores for tracking but rejects unsupported categories', () => {
  const result = normalizeLocal({width:100,height:100,detections:[
    {categories:[{categoryName:'chair',score:.2}],boundingBox:{originX:10,originY:10,width:20,height:30}},
    {categories:[{categoryName:'toaster',score:.9}],boundingBox:{originX:10,originY:10,width:20,height:30}},
  ]},zone);
  assert.equal(result.length,1);
  assert.equal(result[0].confidence,.2);
  assert.equal(result[0].inZone,true);
  assert.deepEqual(result[0].bbox,{x:.1,y:.1,width:.19999999999999998,height:.30000000000000004});
});
test('alerts require observed, confirmed, confident tracks and respect cooldown and reset', () => {
  const policy = new TrackAlertPolicy();
  const track = {label:'chair',trackId:1,confirmed:false,inZone:true,confidence:.9,bbox:{x:.4,y:.5,width:.2,height:.3}};
  assert.equal(policy.update([track],0,['speech']).triggered,false);
  track.confirmed=true;
  assert.equal(policy.update([{...track,confidence:.2}],100,['speech']).triggered,false);
  const alert=policy.update([track],200,['speech']);
  assert.equal(alert.message,'chair ahead. Check your surroundings.');
  assert.deepEqual(alert.modalities,['speech']);
  assert.equal(policy.update([track],500,[]).reason,'cooldown');
  assert.equal(policy.update([],600,[]).triggered,false);
  policy.reset();
  assert.equal(policy.update([track],700,[]).triggered,true);
});
