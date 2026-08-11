import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as indexExports from './dist/index.js';
import * as sdkExports from './dist/rayforce.sdk.js';
import { init, Types } from './dist/index.js';

const declarations = readFileSync(new URL('./dist/rayforce.sdk.d.ts', import.meta.url), 'utf8');
const indexDeclarations = readFileSync(new URL('./dist/index.d.ts', import.meta.url), 'utf8');
const readme = readFileSync(new URL('./README.md', import.meta.url), 'utf8');

function declarationValueExports(source) {
  const names = new Set();
  for (const match of source.matchAll(/^export declare (?:class|const|function) ([A-Za-z_$][\w$]*)/gm)) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/^export \{[^\n}]*\bas\s+([A-Za-z_$][\w$]*)[^\n}]*\};/gm)) {
    names.add(match[1]);
  }
  if (/^export default /m.test(source)) names.add('default');
  return names;
}

const declaredSdkExports = declarationValueExports(declarations);
assert.deepEqual(
  Object.keys(sdkExports).sort(),
  [...declaredSdkExports].sort(),
  'rayforce.sdk.js exports do not match rayforce.sdk.d.ts',
);

const declaredIndexExports = declarationValueExports(indexDeclarations);
for (const name of declaredSdkExports) {
  if (name !== 'default') declaredIndexExports.add(name);
}
assert.deepEqual(
  Object.keys(indexExports).sort(),
  [...declaredIndexExports].sort(),
  'index.js exports do not match index.d.ts',
);

function declarationClasses(source) {
  const classes = new Map();
  const classPattern = /export declare class ([A-Za-z_$][\w$]*)(?: extends ([A-Za-z_$][\w$]*))? \{([\s\S]*?)^\}/gm;

  for (const match of source.matchAll(classPattern)) {
    const [, name, extendsName, body] = match;
    const instance = new Set();
    const statics = new Set();
    const memberPattern = /^\s+(static\s+)?(?:readonly\s+)?([A-Za-z_$][\w$]*|\[Symbol\.iterator\])(?:<[^\n>]+>)?\s*(?=\(|:)/gm;

    for (const member of body.matchAll(memberPattern)) {
      const memberName = member[2];
      if (memberName === 'constructor') continue;
      (member[1] ? statics : instance).add(memberName);
    }
    classes.set(name, { extendsName, instance, statics });
  }

  return classes;
}

function runtimeKey(name) {
  return name === '[Symbol.iterator]' ? globalThis.Symbol.iterator : name;
}

const declaredClasses = declarationClasses(declarations);
assert.ok(declaredClasses.size > 0, 'no TypeScript class declarations were found');

function hasDeclaredInstanceMember(className, member) {
  let current = declaredClasses.get(className);
  while (current) {
    if (current.instance.has(member)) return true;
    current = current.extendsName ? declaredClasses.get(current.extendsName) : null;
  }
  return false;
}

for (const [className, members] of declaredClasses) {
  const RuntimeClass = sdkExports[className];
  assert.equal(typeof RuntimeClass, 'function', `${className} is declared but not exported at runtime`);

  for (const member of members.instance) {
    assert.ok(
      runtimeKey(member) in RuntimeClass.prototype,
      `${className}.${member} is declared in TypeScript but missing at runtime`,
    );
  }
  for (const member of members.statics) {
    assert.ok(
      runtimeKey(member) in RuntimeClass,
      `${className}.${member} is declared static in TypeScript but missing at runtime`,
    );
  }

  for (const key of Reflect.ownKeys(RuntimeClass.prototype)) {
    if (key === 'constructor' || (typeof key === 'string' && key.startsWith('_'))) continue;
    const declaredName = key === globalThis.Symbol.iterator ? '[Symbol.iterator]' : key;
    assert.ok(
      hasDeclaredInstanceMember(className, declaredName),
      `${className}.${String(declaredName)} exists at runtime but is missing from TypeScript`,
    );
  }
}

function documentedMembers(receiver) {
  const names = new Set();
  const pattern = new RegExp(`\\b${receiver}\\.([A-Za-z_$][\\w$]*)\\b`, 'g');
  for (const match of readme.matchAll(pattern)) names.add(match[1]);
  return names;
}

const rf = await init({ singleton: false });
const table = rf.table({ id: [1], name: ['Ada'], score: [95.5] });
const vec = rf.vector(Types.F64, [1.5]);
const col = rf.col('score');
const result = rf.eval('(+ 1 2)');
const row = table.row(0);

for (const [receiver, object] of Object.entries({ rf, table, vec, col, result, row })) {
  const members = documentedMembers(receiver);
  assert.ok(members.size > 0, `README contract receiver ${receiver} has no documented members`);
  for (const member of members) {
    assert.ok(member in object, `README documents ${receiver}.${member}, but it is missing at runtime`);
  }
}

console.log(
  `${declaredClasses.size} TypeScript classes, module exports, and README API usages match the runtime`,
);
