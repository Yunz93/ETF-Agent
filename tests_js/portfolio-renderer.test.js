import test from 'node:test';
import assert from 'node:assert/strict';
import {renderers} from '../js/views/render.js';
import '../js/views/portfolio.js';

test('portfolio refresh renderer preserves async startup contract', async()=>{
  const previous=globalThis.document;
  globalThis.document={querySelector:()=>null};
  try {
    const rendering=renderers.renderEtfPool({refresh:false});
    assert.equal(typeof rendering?.catch,'function');
    await rendering;
  } finally {globalThis.document=previous;}
});
