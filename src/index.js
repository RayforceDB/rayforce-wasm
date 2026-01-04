/**
 * RayforceDB JavaScript SDK - Main Entry Point
 * 
 * This is the main entry point for the RayforceDB SDK.
 * It initializes the WASM module and provides the full SDK API.
 * 
 * Usage (ESM):
 *   import { init } from 'rayforce';
 *   const rf = await init();
 *   const result = rf.eval('(+ 1 2)');
 * 
 * Usage (CDN script tag):
 *   <script src="https://cdn.../rayforce.umd.js"></script>
 *   <script>
 *     Rayforce.init().then(rf => {
 *       console.log(rf.eval('(+ 1 2)').toJS());
 *     });
 *   </script>
 * 
 * @module rayforce
 * @version 0.1.0
 */

import { createRayforceSDK, Types, Expr } from './rayforce.sdk.js';

// SDK version
export const version = '0.1.0';

// Re-export types and utilities
export { Types, Expr };
export * from './rayforce.sdk.js';

// Global SDK instance (for singleton pattern)
let _sdkInstance = null;
let _initPromise = null;

/**
 * Initialize the RayforceDB SDK.
 * 
 * @param {Object} [options] - Configuration options
 * @param {string} [options.wasmPath] - Custom path to rayforce.js WASM loader
 * @param {boolean} [options.singleton=true] - Use singleton pattern (reuse instance)
 * @param {Function} [options.onReady] - Callback when WASM is fully initialized
 * @returns {Promise<RayforceSDK>} The initialized SDK instance
 * 
 * @example
 * // Basic usage
 * const rf = await init();
 * 
 * // Custom WASM path
 * const rf = await init({ wasmPath: './dist/rayforce.js' });
 * 
 * // Force new instance
 * const rf = await init({ singleton: false });
 */
export async function init(options = {}) {
  const {
    wasmPath = './rayforce.js',
    singleton = true,
    onReady = null,
  } = options;

  // Return existing instance if singleton
  if (singleton && _sdkInstance !== null) {
    return _sdkInstance;
  }

  // Wait for existing init if in progress
  if (singleton && _initPromise !== null) {
    return _initPromise;
  }

  const initFn = async () => {
    try {
      // Dynamic import of WASM module
      const wasmModule = await import(wasmPath);
      const createRayforce = wasmModule.default;
      
      // Initialize WASM
      const wasm = await createRayforce({
        // Optional: configure WASM module
        rayforce_ready: (msg) => {
          if (onReady) onReady(msg);
        }
      });

      // Create SDK wrapper
      const sdk = createRayforceSDK(wasm);
      
      if (singleton) {
        _sdkInstance = sdk;
      }
      
      return sdk;
    } catch (error) {
      if (singleton) {
        _initPromise = null;
      }
      throw new Error(`Failed to initialize RayforceDB: ${error.message}`);
    }
  };

  if (singleton) {
    _initPromise = initFn();
    return _initPromise;
  }
  
  return initFn();
}

/**
 * Get the singleton SDK instance (must call init() first)
 * @returns {RayforceSDK|null}
 */
export function getInstance() {
  return _sdkInstance;
}

/**
 * Check if SDK is initialized
 * @returns {boolean}
 */
export function isInitialized() {
  return _sdkInstance !== null;
}

/**
 * Reset the singleton instance (for testing)
 */
export function reset() {
  _sdkInstance = null;
  _initPromise = null;
}

// ============================================================================
// Convenience Functions (work on singleton instance)
// ============================================================================

/**
 * Evaluate a Rayfall expression using singleton instance
 * @param {string} code
 * @returns {RayObject}
 */
export function evaluate(code) {
  if (!_sdkInstance) {
    throw new Error('RayforceDB not initialized. Call init() first.');
  }
  return _sdkInstance.eval(code);
}

/**
 * Create common types using singleton instance
 */
export const create = {
  get i64() {
    if (!_sdkInstance) throw new Error('RayforceDB not initialized');
    return (v) => _sdkInstance.i64(v);
  },
  get f64() {
    if (!_sdkInstance) throw new Error('RayforceDB not initialized');
    return (v) => _sdkInstance.f64(v);
  },
  get string() {
    if (!_sdkInstance) throw new Error('RayforceDB not initialized');
    return (v) => _sdkInstance.string(v);
  },
  get symbol() {
    if (!_sdkInstance) throw new Error('RayforceDB not initialized');
    return (v) => _sdkInstance.symbol(v);
  },
  get vector() {
    if (!_sdkInstance) throw new Error('RayforceDB not initialized');
    return (type, data) => _sdkInstance.vector(type, data);
  },
  get list() {
    if (!_sdkInstance) throw new Error('RayforceDB not initialized');
    return (items) => _sdkInstance.list(items);
  },
  get dict() {
    if (!_sdkInstance) throw new Error('RayforceDB not initialized');
    return (obj) => _sdkInstance.dict(obj);
  },
  get table() {
    if (!_sdkInstance) throw new Error('RayforceDB not initialized');
    return (cols) => _sdkInstance.table(cols);
  },
  get date() {
    if (!_sdkInstance) throw new Error('RayforceDB not initialized');
    return (v) => _sdkInstance.date(v);
  },
  get time() {
    if (!_sdkInstance) throw new Error('RayforceDB not initialized');
    return (v) => _sdkInstance.time(v);
  },
  get timestamp() {
    if (!_sdkInstance) throw new Error('RayforceDB not initialized');
    return (v) => _sdkInstance.timestamp(v);
  },
};

// ============================================================================
// Default Export
// ============================================================================

export default {
  init,
  getInstance,
  isInitialized,
  reset,
  evaluate,
  create,
  Types,
  Expr,
  version,
};
