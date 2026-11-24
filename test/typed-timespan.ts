import { init, Types, RayTimespan } from '../src/index.js';
async function check() {
  const rf = await init();
  const span: RayTimespan = rf.timespan(9007199254740993n);
  const raw: bigint = span.value;
  const result: bigint | null = span.toJS();
  const vector = rf.vector(Types.TIMESPAN, [raw, result, null]);
  const view: BigInt64Array = vector.typedArray;
  const cells: Array<number | bigint | null> = vector.toJS();
  vector.set(0, null);
  for (const cell of vector) {
    const value: number | bigint | null = cell;
    void value;
  }
  span.drop(); vector.drop();
  return { view, cells };
}
void check;
