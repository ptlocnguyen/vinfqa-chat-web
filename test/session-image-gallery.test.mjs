import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const css=await readFile(new URL('../assets/styles.css',import.meta.url),'utf8');
const app=await readFile(new URL('../assets/app.js',import.meta.url),'utf8');

test('session images use a spaced normal-flow gallery rather than sticky overlap',()=>{
  const gallery=css.match(/\.session-image-gallery\s*\{([^}]*)\}/)?.[1]||'';
  const card=css.match(/\.session-image-context\s*\{([^}]*)\}/)?.[1]||'';
  assert.match(gallery,/display:\s*grid/);
  assert.match(gallery,/gap:\s*10px/);
  assert.match(gallery,/width:\s*min\(100%,\s*560px\)/);
  assert.doesNotMatch(card,/position:\s*sticky/);
  assert.match(card,/position:\s*relative/);
});

test('gallery preserves source order and each image opens the existing large viewer',()=>{
  const render=app.slice(app.indexOf('function createSessionImageNode'),app.indexOf('function createMessageNode'));
  assert.match(render,/images\.forEach\(\(item,index\)=>/);
  assert.match(render,/button\.onclick\s*=\s*\(\)\s*=>\s*openImageViewer\(session,index\)/);
  assert.match(render,/Ảnh \$\{index\+1\}/);
});

test('browser wait covers the maximum sequential four-image gateway timeout budget',()=>{
  assert.match(app,/INFERENCE_TIMEOUT_MS\s*=\s*390_000/);
  assert.match(app,/6 phút 30 giây/);
});
