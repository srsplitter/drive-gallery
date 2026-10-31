/* Run: node --experimental-vm-modules test_vace_clip.cjs
 * Decoder-independent guards. Real MediaBunny/browser extraction is exercised by
 * site/vace-clip-fixture.html, which uses a synthetic 60-second MP4 and HTTP Range.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const sourcePath = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '../../vace-clip.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const MiB = 2 ** 20;

async function setup(driveParser) {
  const context = vm.createContext({
    Uint8Array, ArrayBuffer, Number, Math, Error, DOMException, Blob,
    VideoDecoder: function () {}, VideoEncoder: function () {},
  });
  let disposed = 0;
  class CustomSource { constructor(options) { this.options = options; } }
  class Input {
    constructor(options) { this.source = options.source; }
    async getPrimaryVideoTrack() {
      await driveParser(this.source.options.read);
      return { getDurationFromMetadata: async () => null };
    }
    dispose() { disposed++; }
  }
  const exports = { Input, CustomSource, MP4: {}, QTFF: {}, MATROSKA: {}, WEBM: {} };
  const module = new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
  }, { context });
  await module.link(() => {}); await module.evaluate();
  new vm.Script(source, { importModuleDynamically: () => module }).runInContext(context);
  return { api: context.VaceClip, disposed: () => disposed };
}

(async () => {
  const args = {file:{size:3 * 2 ** 30},start:30.25,duration:3,read:async () => { throw Error('Unexpected read'); }};
  let calls = [];
  const small = new Uint8Array(8 * MiB);
  const budget = await setup(async read => {
    for (let i = 0; i < 33; i++) await read(i * 8 * MiB, (i + 1) * 8 * MiB);
  });
  await assert.rejects(budget.api.extract({...args,read:async(s,e)=>{calls.push([s,e]);return small;}}), e => e.code === 'READ_BUDGET_EXCEEDED');
  assert.equal(calls.length, 32, 'Reject before issuing the 257th MiB');
  assert.equal(calls.reduce((sum,[s,e])=>sum+e-s,0), 256 * MiB);
  assert.equal(budget.disposed(), 1);

  calls = [];
  const chunks = await setup(read => read(0, 25 * MiB));
  await assert.rejects(chunks.api.extract({...args,read:async(s,e)=>{calls.push([s,e]);return new Uint8Array(e-s);}}),e=>e.code==='UNSEEKABLE_SOURCE');
  assert.deepEqual(calls.map(([s,e])=>e-s), [8 * MiB,8 * MiB,8 * MiB,MiB]);

  const concurrent = await setup(read => Promise.all([read(0,129 * MiB),read(129 * MiB,257 * MiB)]));
  let concurrentCalls = 0;
  await assert.rejects(concurrent.api.extract({...args,read:async(s,e)=>{concurrentCalls++;return new Uint8Array(e-s);}}),e=>e.code==='READ_BUDGET_EXCEEDED');
  assert.ok(concurrentCalls <= 1, 'Reserve the complete parser request before concurrent reads proceed');

  const mismatch = await setup(read => read(0,100));
  await assert.rejects(mismatch.api.extract({...args,read:async()=>new Uint8Array(101)}),e=>e.code==='INVALID_RANGE_RESPONSE');
  const invalidRange = await setup(read => read(-1,100));
  await assert.rejects(invalidRange.api.extract(args),e=>e.code==='INVALID_RANGE');

  const validation = await setup(() => {throw Error('Should not load parser');});
  await assert.rejects(validation.api.extract({...args,start:-1}),e=>e.code==='INVALID_INTERVAL');
  await assert.rejects(validation.api.extract({...args,duration:6}),e=>e.code==='INVALID_INTERVAL');
  await assert.rejects(validation.api.extract({...args,file:{size:Number.MAX_SAFE_INTEGER+1}}),e=>e.code==='INVALID_SOURCE');
  const abort = new AbortController(); abort.abort();
  await assert.rejects(validation.api.extract({...args,signal:abort.signal}),e=>e.name==='AbortError');
  console.log('PASS: 10 range-budget, chunk, source-validation and cancellation checks');
})().catch(error => { console.error(error); process.exitCode = 1; });
