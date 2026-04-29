/**
 * RayforceDB UMD Bootstrap
 *
 * Thin shim that delegates to the ES6 SDK (rayforce.sdk.js) to avoid the
 * duplication-drift hazard of maintaining two parallel implementations.
 * The v1 UMD bundle inlined a copy of the SDK — kept here as a single
 * loader so v2 changes only need to land in rayforce.sdk.js.
 *
 * Usage:
 *   <script type="module">
 *     import { init } from './rayforce.umd.js';
 *     const rf = await init({ wasmPath: './rayforce.js' });
 *     console.log((await rf.eval('(+ 1 2)')).toJS());  // 3
 *   </script>
 *
 * Or via the runtime global (legacy, browser only):
 *   <script src="./rayforce.umd.js" type="module"></script>
 *   <script>Rayforce.init({...}).then(...)</script>
 *
 * Note: this file is now an ES module — UMD's `define`/`module.exports`
 * compatibility paths are gone.  Consumers in those environments should
 * import rayforce.sdk.js directly via their bundler.
 */

import { createRayforceSDK, Types } from './rayforce.sdk.js';
export { Types };
export * from './rayforce.sdk.js';

/**
 * Initialize the WASM module + SDK in one shot.
 * @param {Object} [options]
 * @param {string} [options.wasmPath='./rayforce.js'] - Path to the
 *     emscripten-emitted JS loader (its `.wasm` peer is fetched relative
 *     to it).
 * @returns {Promise<RayforceSDK>}
 */
export async function init(options = {}) {
  const wasmPath = options.wasmPath || './rayforce.js';
  const factory = (await import(wasmPath)).default;
  const wasm = await factory();
  return createRayforceSDK(wasm);
}

/* Browser-global compatibility: when loaded as a non-module <script src>,
 * `import` syntax is rejected by the parser before this attaches anything,
 * so the global path now requires `<script type="module">`. */
if (typeof globalThis !== 'undefined') {
  globalThis.Rayforce = Object.assign(globalThis.Rayforce || {}, {
    init,
    Types,
    createRayforceSDK,
  });
}
