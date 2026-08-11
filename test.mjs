import assert from 'node:assert/strict';
import { init, version, Types } from './dist/index.js';

assert.equal(version, '0.2.0');

const rf = await init({ singleton: false });
assert.equal(rf.version, '2.5.13');
assert.equal(rf.eval('(+ (+ 1 2) 3)').toJS(), 6);
assert.deepEqual(rf.eval('(til 5)').toJS(), [0, 1, 2, 3, 4]);

assert.equal(rf.i64(42).toJS(), 42);
assert.equal(rf.f64(3.5).toJS(), 3.5);
assert.equal(rf.string('hello').toJS(), 'hello');
assert.equal(rf.symbol('name').toJS(), 'name');
assert.deepEqual(rf.vector(Types.I32, [1, 2, 3]).toJS(), [1, 2, 3]);

const table = rf.table({ id: [1, 2], name: ['Ada', 'Lin'] });
assert.deepEqual(table.toRows(), [
  { id: 1, name: 'Ada' },
  { id: 2, name: 'Lin' },
]);

const csv = new TextEncoder().encode('id,name\n1,Ada\n2,Lin\n');
assert.deepEqual(rf.readCSV(csv, 'smoke.csv').toRows(), [
  { id: 1, name: 'Ada' },
  { id: 2, name: 'Lin' },
]);

const error = rf.eval('(+ 1)');
assert.equal(error.isError, true);
assert.equal(error.code, 'arity');

console.log(`rayforce-wasm ${version} / engine ${rf.version}: smoke tests passed`);
