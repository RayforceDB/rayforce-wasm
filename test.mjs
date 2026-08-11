import assert from 'node:assert/strict';
import { init, version, Types } from './dist/index.js';

assert.equal(version, '0.2.1');

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

// Keep the fluent query-builder examples in README executable. This guards
// the public rf.col() helper, generated Rayfall syntax, and comparison names.
assert.equal(typeof rf.col, 'function');
const queryTable = rf.table({
  name: ['Alice', 'Bob', 'Carol'],
  department: ['eng', 'ops', 'eng'],
  score: [95.5, 87.3, 92.1],
  active: [true, false, true],
});

assert.deepEqual(
  queryTable
    .select('name', 'score')
    .where(rf.col('score').gt(90))
    .execute()
    .toRows(),
  [
    { name: 'Alice', score: 95.5 },
    { name: 'Carol', score: 92.1 },
  ],
);

assert.deepEqual(
  queryTable
    .select('department')
    .withColumn('avg_score', rf.col('score').avg())
    .withColumn('max_score', rf.col('score').max())
    .groupBy('department')
    .execute()
    .toRows(),
  [
    { department: 'eng', avg_score: 93.8, max_score: 95.5 },
    { department: 'ops', avg_score: 87.3, max_score: 87.3 },
  ],
);

assert.deepEqual(
  queryTable
    .where(rf.col('score').gt(80).and(rf.col('active').eq(true)))
    .execute()
    .toRows()
    .map(({ name }) => name),
  ['Alice', 'Carol'],
);

assert.deepEqual(
  queryTable.where(rf.col('department').ne('eng')).execute().toRows().map(({ name }) => name),
  ['Bob'],
);

const comparisonCases = [
  ['eq', 87.3, ['Bob']],
  ['ne', 87.3, ['Alice', 'Carol']],
  ['lt', 90, ['Bob']],
  ['le', 87.3, ['Bob']],
  ['gt', 90, ['Alice', 'Carol']],
  ['ge', 95.5, ['Alice']],
];
for (const [method, value, expectedNames] of comparisonCases) {
  const names = queryTable
    .select('name')
    .where(rf.col('score')[method](value))
    .execute()
    .toRows()
    .map(({ name }) => name);
  assert.deepEqual(names, expectedNames, `Expr.${method}() emitted an invalid query`);
}

const aggregationCases = ['sum', 'avg', 'min', 'max', 'count', 'first', 'last', 'distinct'];
for (const method of aggregationCases) {
  const aggregation = queryTable
    .select()
    .withColumn('value', rf.col('score')[method]())
    .execute();
  assert.equal(aggregation.isError, false, `Expr.${method}() emitted an invalid query`);
}

assert.deepEqual(
  queryTable
    .select('name')
    .where(rf.col('score').lt(90).or(rf.col('active').not()))
    .execute()
    .toRows()
    .map(({ name }) => name),
  ['Bob', 'Carol'],
);
assert.throws(() => rf.col('score) injected'), /column name/);

const error = rf.eval('(+ 1)');
assert.equal(error.isError, true);
assert.equal(error.code, 'arity');

console.log(`rayforce-wasm ${version} / engine ${rf.version}: smoke tests passed`);
