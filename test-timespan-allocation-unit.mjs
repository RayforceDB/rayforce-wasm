import assert from 'node:assert/strict';
import {createRayforceSDK} from './src/rayforce.sdk.js';
const rf=createRayforceSDK({cwrap:()=>()=>0});
let called=0;
rf._initTimespanParts=()=>{called++; return 0;};
assert.throws(()=>rf.timespan(1n), /Failed to allocate TIMESPAN atom/);assert.equal(called,1);
rf._initTimespanParts=(lo,hi)=>{assert.equal(lo,1);assert.equal(hi,2097152);return 64;};
assert.equal(rf.timespan(9007199254740993n).ptr,64);
console.log('TIMESPAN_JS_ALLOCATION_BOUNDARY_AND_EXACT_PARTS_UNIT_PASS');
