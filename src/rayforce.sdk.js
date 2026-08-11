/**
 * RayforceDB JavaScript SDK
 * 
 * Full-featured zero-copy wrapper for RayforceDB WASM module.
 * Provides TypedArray views over native Rayforce vectors for efficient data access.
 * 
 * @module rayforce
 * @version 0.2.0
 */

// ============================================================================
// SDK Factory
// ============================================================================

/**
 * Creates a new RayforceDB SDK instance.
 * @param {Object} wasmModule - The initialized Emscripten WASM module
 * @returns {RayforceSDK} The SDK instance
 */
export function createRayforceSDK(wasmModule) {
  return new RayforceSDK(wasmModule);
}

// ============================================================================
// Type Constants
// ============================================================================

// v2 type codes: RAY_F32 was inserted at slot 6, shifting F64 from 10→7,
// DATE 7→8, TIME 8→9, TIMESTAMP 9→10, GUID stays 11.  RAY_SYM is now 12
// (the v1 C8 slot) and RAY_STR is a new variable-length string column at 13.
export const Types = Object.freeze({
  LIST: 0,
  B8: 1,
  U8: 2,
  I16: 3,
  I32: 4,
  I64: 5,
  F32: 6,
  F64: 7,
  DATE: 8,
  TIME: 9,
  TIMESTAMP: 10,
  GUID: 11,
  SYM: 12,
  STR: 13,
  TABLE: 98,
  DICT: 99,
  LAMBDA: 100,
  NULL: 126,
  ERR: 127,
  // Deprecated aliases for one release; emit warnings if you read these.
  SYMBOL: 12,
  C8: 12,
});

// Element sizes for each type (in bytes).  STR has no entry — RAY_STR
// vectors use per-cell ray_str_t structs that JS reads via _strVecGet.
const ELEMENT_SIZES = {
  [Types.B8]: 1,
  [Types.U8]: 1,
  [Types.I16]: 2,
  [Types.I32]: 4,
  [Types.I64]: 8,
  [Types.F32]: 4,
  [Types.F64]: 8,
  [Types.DATE]: 4,
  [Types.TIME]: 4,
  [Types.TIMESTAMP]: 8,
  [Types.SYM]: 8,
  [Types.GUID]: 16,
  [Types.LIST]: 4, // pointer size in WASM32
};

// TypedArray constructors for each type.  STR/LIST aren't typed-array-viewable.
const TYPED_ARRAY_MAP = {
  [Types.B8]: Int8Array,
  [Types.U8]: Uint8Array,
  [Types.I16]: Int16Array,
  [Types.I32]: Int32Array,
  [Types.I64]: BigInt64Array,
  [Types.F32]: Float32Array,
  [Types.F64]: Float64Array,
  [Types.DATE]: Int32Array,
  [Types.TIME]: Int32Array,
  [Types.TIMESTAMP]: BigInt64Array,
  [Types.SYM]: BigInt64Array,
};

// ============================================================================
// Main SDK Class
// ============================================================================

class RayforceSDK {
  constructor(wasm) {
    this._wasm = wasm;
    this._cmdCounter = 0;
    this._setupBindings();
  }

  _setupBindings() {
    const w = this._wasm;

    // Core
    this._evalCmd        = w.cwrap('eval_cmd',         'number', ['string', 'string']);
    this._strOfObj       = w.cwrap('strof_obj',        'string', ['number']);
    this._versionStr     = w.cwrap('version_str',      'string', []);

    // Memory: ray_release / ray_retain are exported directly from the engine.
    this._release        = w.cwrap('ray_release',      null,     ['number']);
    this._retain         = w.cwrap('ray_retain',       null,     ['number']);

    // Type introspection
    this._getObjType     = w.cwrap('get_obj_type',     'number', ['number']);
    this._getObjLen      = w.cwrap('get_obj_len',      'number', ['number']);
    this._isObjAtom      = w.cwrap('is_obj_atom',      'number', ['number']);
    this._isObjVector    = w.cwrap('is_obj_vector',    'number', ['number']);
    this._isObjNull      = w.cwrap('is_obj_null',      'number', ['number']);
    this._isObjError     = w.cwrap('is_obj_error',     'number', ['number']);
    this._getObjRc       = w.cwrap('get_obj_rc',       'number', ['number']);

    // Error info
    this._getErrorCode    = w.cwrap('get_error_code',    'string', ['number']);
    this._getErrorMessage = w.cwrap('get_error_message', 'string', ['number']);
    this._getErrorTrace   = w.cwrap('get_error_trace',   'number', []);

    // Memory access for zero-copy views
    this._getDataPtr      = w.cwrap('get_data_ptr',      'number', ['number']);
    this._getElementSize  = w.cwrap('get_element_size',  'number', ['number']);
    this._getDataByteSize = w.cwrap('get_data_byte_size','number', ['number']);

    // Atom constructors
    this._initB8         = w.cwrap('init_b8',          'number', ['number']);
    this._initU8         = w.cwrap('init_u8',          'number', ['number']);
    this._initI16        = w.cwrap('init_i16',         'number', ['number']);
    this._initI32        = w.cwrap('init_i32',         'number', ['number']);
    this._initI64        = w.cwrap('init_i64',         'number', ['number']);
    this._initF32        = w.cwrap('init_f32',         'number', ['number']);
    this._initF64        = w.cwrap('init_f64',         'number', ['number']);
    this._initDate       = w.cwrap('init_date',        'number', ['number']);
    this._initTime       = w.cwrap('init_time',        'number', ['number']);
    this._initTimestamp  = w.cwrap('init_timestamp',   'number', ['number']);
    this._initSymbolStr  = w.cwrap('init_symbol_str',  'number', ['string', 'number']);
    this._initStringStr  = w.cwrap('init_string_str',  'number', ['string', 'number']);

    // Atom readers
    this._readB8         = w.cwrap('read_b8',          'number', ['number']);
    this._readU8         = w.cwrap('read_u8',          'number', ['number']);
    this._readI16        = w.cwrap('read_i16',         'number', ['number']);
    this._readI32        = w.cwrap('read_i32',         'number', ['number']);
    this._readI64        = w.cwrap('read_i64',         'number', ['number']);
    this._readF32        = w.cwrap('read_f32',         'number', ['number']);
    this._readF64        = w.cwrap('read_f64',         'number', ['number']);
    this._readDate       = w.cwrap('read_date',        'number', ['number']);
    this._readTime       = w.cwrap('read_time',        'number', ['number']);
    this._readTimestamp  = w.cwrap('read_timestamp',   'number', ['number']);
    this._readSymbolId   = w.cwrap('read_symbol_id',   'number', ['number']);
    this._symbolToStr    = w.cwrap('symbol_to_str',    'string', ['number']);
    this._symbolVecGet   = w.cwrap('symbol_vec_get',   'string', ['number', 'number']);

    // String helpers (RAY_STR atoms + RAY_STR vector cells)
    this._strAtomPtr     = w.cwrap('str_atom_ptr',     'string', ['number']);
    this._strAtomLen     = w.cwrap('str_atom_len',     'number', ['number']);
    this._strVecGet      = w.cwrap('str_vec_get',      'string', ['number', 'number']);

    // CSV
    this._readCSV        = w.cwrap('read_csv',         'number', ['string']);

    // Vector / list constructors and ops
    this._initVector     = w.cwrap('init_vector',      'number', ['number', 'number']);
    this._initList       = w.cwrap('init_list',        'number', ['number']);
    this._vecAtIdx       = w.cwrap('vec_at_idx',       'number', ['number', 'number']);
    this._vecSetIdx      = w.cwrap('vec_set_idx',      'number', ['number', 'number', 'number']);
    this._vecPush        = w.cwrap('vec_push',         'number', ['number', 'number']);
    this._vecInsert      = w.cwrap('vec_insert',       'number', ['number', 'number', 'number']);

    // Dict
    this._initDict       = w.cwrap('init_dict',        'number', ['number', 'number']);
    this._dictKeys       = w.cwrap('dict_keys',        'number', ['number']);
    this._dictVals       = w.cwrap('dict_vals',        'number', ['number']);
    this._dictGet        = w.cwrap('dict_get',         'number', ['number', 'number']);

    // Table
    this._initTable      = w.cwrap('init_table',       'number', ['number', 'number']);
    this._tableKeys      = w.cwrap('table_keys',       'number', ['number']);
    this._tableVals      = w.cwrap('table_vals',       'number', ['number']);
    this._tableCol       = w.cwrap('table_col',        'number', ['number', 'string', 'number']);
    this._tableRow       = w.cwrap('table_row',        'number', ['number', 'number']);
    this._tableCount     = w.cwrap('table_count',      'number', ['number']);

    // Query operations
    this._querySelect    = w.cwrap('query_select',     'number', ['number']);
    this._queryUpdate    = w.cwrap('query_update',     'number', ['number']);
    this._tableInsert    = w.cwrap('table_insert',     'number', ['number', 'number']);
    this._tableUpsert    = w.cwrap('table_upsert',     'number', ['number', 'number', 'number']);

    // Misc
    this._internSymbol   = w.cwrap('intern_symbol',    'number', ['string', 'number']);
    this._globalSet      = w.cwrap('global_set',       'number', ['number', 'number']);
    this._getTypeName    = w.cwrap('get_type_name',    'string', ['number']);
  }

  // ==========================================================================
  // Core Methods
  // ==========================================================================

  /**
   * Get RayforceDB version string
   * @returns {string}
   */
  get version() {
    return this._versionStr();
  }

  /**
   * Evaluate a Rayfall expression
   * @param {string} code - The expression to evaluate
   * @param {string} [sourceName] - Optional source name for error tracking
   * @returns {RayObject} The result wrapped in appropriate type
   */
  eval(code, sourceName) {
    const ptr = this._evalCmd(code, sourceName || `eval:${++this._cmdCounter}`);
    return this._wrapPtr(ptr);
  }

  /**
   * Evaluate and return raw result (for internal use)
   * @param {string} code
   * @returns {number} Raw pointer
   */
  _evalRaw(code) {
    return this._evalCmd(code, `eval:${++this._cmdCounter}`);
  }

  /**
   * Format any RayObject to string
   * @param {RayObject|number} obj
   * @returns {string}
   */
  format(obj) {
    const ptr = obj instanceof RayObject ? obj._ptr : obj;
    return this._strOfObj(ptr);
  }

  // ==========================================================================
  // Type Wrapping
  // ==========================================================================

  /**
   * Wrap a raw pointer in the appropriate RayObject subclass
   * @param {number} ptr
   * @returns {RayObject}
   */
  _wrapPtr(ptr) {
    if (ptr === 0) return new RayNull(this, 0);
    
    const type = this._getObjType(ptr);
    const isAtom = this._isObjAtom(ptr);
    const absType = type < 0 ? -type : type;
    
    // Check for error
    if (type === Types.ERR) {
      return new RayError(this, ptr);
    }
    
    // Check for null
    if (type === Types.NULL || this._isObjNull(ptr)) {
      return new RayNull(this, ptr);
    }
    
    // Atoms (scalars)
    if (isAtom) {
      switch (absType) {
        case Types.B8:        return new B8(this, ptr);
        case Types.U8:        return new U8(this, ptr);
        case Types.I16:       return new I16(this, ptr);
        case Types.I32:       return new I32(this, ptr);
        case Types.I64:       return new I64(this, ptr);
        case Types.F32:       return new F32(this, ptr);
        case Types.F64:       return new F64(this, ptr);
        case Types.DATE:      return new RayDate(this, ptr);
        case Types.TIME:      return new RayTime(this, ptr);
        case Types.TIMESTAMP: return new RayTimestamp(this, ptr);
        case Types.SYM:       return new Sym(this, ptr);
        case Types.STR:       return new RayString(this, ptr);
        case Types.GUID:      return new GUID(this, ptr);
        default:              return new RayObject(this, ptr);
      }
    }

    // Vectors and containers
    switch (type) {
      case Types.STR:    return new StrVector(this, ptr);
      case Types.LIST:   return new List(this, ptr);
      case Types.DICT:   return new Dict(this, ptr);
      case Types.TABLE:  return new Table(this, ptr);
      case Types.LAMBDA: return new Lambda(this, ptr);
      default:
        if (TYPED_ARRAY_MAP[type]) return new Vector(this, ptr, type);
        return new RayObject(this, ptr);
    }
  }

  // ==========================================================================
  // Constructors
  // ==========================================================================

  /**
   * Create a boolean value
   * @param {boolean} value
   * @returns {B8}
   */
  b8(value) {
    return new B8(this, this._initB8(value ? 1 : 0));
  }

  /**
   * Create an unsigned byte value
   * @param {number} value
   * @returns {U8}
   */
  u8(value) {
    return new U8(this, this._initU8(value & 0xFF));
  }

  /**
   * Create a 16-bit integer
   * @param {number} value
   * @returns {I16}
   */
  i16(value) {
    return new I16(this, this._initI16(value | 0));
  }

  /**
   * Create a 32-bit float
   * @param {number} value
   * @returns {F32}
   */
  f32(value) {
    return new F32(this, this._initF32(value));
  }

  /**
   * Create a 32-bit integer
   * @param {number} value
   * @returns {I32}
   */
  i32(value) {
    return new I32(this, this._initI32(value | 0));
  }

  /**
   * Create a 64-bit integer
   * @param {number|bigint} value
   * @returns {I64}
   */
  i64(value) {
    // Note: JS number can only safely represent up to 2^53
    return new I64(this, this._initI64(Number(value)));
  }

  /**
   * Create a 64-bit float
   * @param {number} value
   * @returns {F64}
   */
  f64(value) {
    return new F64(this, this._initF64(value));
  }

  /**
   * Create a date (days since 2000-01-01)
   * @param {number|Date} value - Days or JS Date object
   * @returns {RayDate}
   */
  date(value) {
    let days;
    if (value instanceof Date) {
      // Convert JS Date to days since 2000-01-01
      const epoch = new Date(2000, 0, 1);
      days = Math.floor((value - epoch) / (1000 * 60 * 60 * 24));
    } else {
      days = value | 0;
    }
    return new RayDate(this, this._initDate(days));
  }

  /**
   * Create a time (milliseconds since midnight)
   * @param {number|Date} value - Milliseconds or JS Date object
   * @returns {RayTime}
   */
  time(value) {
    let ms;
    if (value instanceof Date) {
      ms = value.getHours() * 3600000 + 
           value.getMinutes() * 60000 + 
           value.getSeconds() * 1000 + 
           value.getMilliseconds();
    } else {
      ms = value | 0;
    }
    return new RayTime(this, this._initTime(ms));
  }

  /**
   * Create a timestamp (nanoseconds since 2000-01-01)
   * @param {number|bigint|Date} value - Nanoseconds or JS Date
   * @returns {RayTimestamp}
   */
  timestamp(value) {
    let ns;
    if (value instanceof Date) {
      const epoch = new Date(2000, 0, 1);
      ns = Number(value - epoch) * 1000000; // ms to ns
    } else {
      ns = Number(value);
    }
    return new RayTimestamp(this, this._initTimestamp(ns));
  }

  /**
   * Create a symbol (interned string)
   * @param {string} value
   * @returns {Sym}
   */
  symbol(value) {
    return new Sym(this, this._initSymbolStr(value, value.length));
  }

  /**
   * Create a string
   * @param {string} value
   * @returns {RayString}
   */
  string(value) {
    return new RayString(this, this._initStringStr(value, value.length));
  }

  /**
   * Create a vector of specified type
   * @param {number} type - Type code from Types
   * @param {number|Array} lengthOrData - Length or array of values
   * @returns {Vector}
   */
  vector(type, lengthOrData) {
    if (Array.isArray(lengthOrData)) {
      const arr = lengthOrData;
      // v2 vectors are growable; init_vector takes a capacity hint, then
      // each push appends.  For typed numeric vectors we still allocate
      // up-front and write through the typed-array view for speed.
      const vec = new Vector(this, this._initVector(type, arr.length), type);
      const view = vec.typedArray;
      for (let i = 0; i < arr.length; i++) {
        if (type === Types.I64 || type === Types.TIMESTAMP || type === Types.SYM) {
          view[i] = BigInt(type === Types.SYM ? this._internSymbol(arr[i], arr[i].length) : arr[i]);
        } else {
          view[i] = arr[i];
        }
      }
      return vec;
    }
    return new Vector(this, this._initVector(type, lengthOrData), type);
  }

  /**
   * Create a list (mixed-type container)
   * @param {Array} [items] - Optional array of items
   * @returns {List}
   */
  list(items) {
    const len = items ? items.length : 0;
    const list = new List(this, this._initList(len));
    if (items) {
      for (let i = 0; i < items.length; i++) {
        list.set(i, items[i]);
      }
    }
    return list;
  }

  /**
   * Create a dict (key-value mapping)
   * @param {Object} obj - JS object to convert
   * @returns {Dict}
   */
  dict(obj) {
    const keys = Object.keys(obj);
    const keyVec = this.vector(Types.SYM, keys.length);
    const keyView = keyVec.typedArray;
    for (let i = 0; i < keys.length; i++) {
      keyView[i] = BigInt(this._internSymbol(keys[i], keys[i].length));
    }

    const valList = this.list(Object.values(obj).map(v => this._toRayObject(v)));
    return new Dict(this, this._initDict(keyVec._ptr, valList._ptr));
  }

  /**
   * Create a table from column definitions
   * @param {Object} columns - Object with column names as keys and arrays as values
   * @returns {Table}
   */
  table(columns) {
    const colNames = Object.keys(columns);
    const keyVec = this.vector(Types.SYM, colNames.length);
    const keyView = keyVec.typedArray;
    for (let i = 0; i < colNames.length; i++) {
      keyView[i] = BigInt(this._internSymbol(colNames[i], colNames[i].length));
    }

    const valList = this.list();
    for (const name of colNames) {
      valList.push(this._arrayToVector(columns[name]));
    }

    return new Table(this, this._initTable(keyVec._ptr, valList._ptr));
  }

  /**
   * Convert JS array to appropriate vector type
   * @param {Array} arr
   * @returns {Vector}
   */
  _arrayToVector(arr) {
    if (arr.length === 0) {
      return this.vector(Types.I64, 0);
    }
    
    const first = arr[0];
    let type;
    
    if (typeof first === 'boolean') {
      type = Types.B8;
    } else if (typeof first === 'number') {
      type = Number.isInteger(first) ? Types.I64 : Types.F64;
    } else if (typeof first === 'bigint') {
      type = Types.I64;
    } else if (typeof first === 'string') {
      type = Types.SYM;
    } else if (first instanceof Date) {
      type = Types.TIMESTAMP;
    } else {
      // Default to list for mixed types
      return this.list(arr.map(v => this._toRayObject(v)));
    }

    const vec = this.vector(type, arr.length);
    const view = vec.typedArray;

    for (let i = 0; i < arr.length; i++) {
      if (type === Types.SYM) {
        view[i] = BigInt(this._internSymbol(arr[i], arr[i].length));
      } else if (type === Types.I64 || type === Types.TIMESTAMP) {
        if (arr[i] instanceof Date) {
          const epoch = new Date(2000, 0, 1);
          view[i] = BigInt((arr[i] - epoch) * 1000000);
        } else {
          view[i] = BigInt(arr[i]);
        }
      } else if (type === Types.B8) {
        view[i] = arr[i] ? 1 : 0;
      } else {
        view[i] = arr[i];
      }
    }

    return vec;
  }

  /**
   * Convert JS value to RayObject
   * @param {any} value
   * @returns {RayObject}
   */
  _toRayObject(value) {
    if (value instanceof RayObject) return value;
    if (value === null || value === undefined) return new RayNull(this, 0);
    if (typeof value === 'boolean') return this.b8(value);
    if (typeof value === 'number') {
      return Number.isInteger(value) ? this.i64(value) : this.f64(value);
    }
    if (typeof value === 'bigint') return this.i64(value);
    if (typeof value === 'string') return this.symbol(value);
    if (value instanceof Date) return this.timestamp(value);
    if (Array.isArray(value)) return this._arrayToVector(value);
    if (typeof value === 'object') return this.dict(value);
    return new RayNull(this, 0);
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Set a global variable
   * @param {string} name
   * @param {RayObject|any} value
   */
  set(name, value) {
    const sym = this.symbol(name);
    const val = value instanceof RayObject ? value : this._toRayObject(value);
    this._globalSet(sym._ptr, val._ptr);
  }

  /**
   * Load a CSV from a buffer.  v2 dropped the buffer-based reader, so we
   * write the buffer to Emscripten MEMFS at /tmp/<name>, call the
   * file-based ray_read_csv, and unlink afterwards.  Type inference is
   * delegated to the engine (sample-based) — numeric columns come back
   * as numeric vectors, not strings (an improvement over v1 behavior).
   * @param {Uint8Array|ArrayBuffer} buffer
   * @param {string} [name] - Filename hint for error messages.
   * @returns {Table|RayError}
   */
  readCSV(buffer, name = `mem-${Date.now()}.csv`) {
    const path = `/tmp/${name}`;
    const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    this._wasm.FS.writeFile(path, data);
    let ptr;
    try {
      ptr = this._readCSV(path);
    } finally {
      try { this._wasm.FS.unlink(path); } catch (_) {}
    }
    return this._wrapPtr(ptr);
  }

  /**
   * Get a global variable
   * @param {string} name
   * @returns {RayObject}
   */
  get(name) {
    return this.eval(name);
  }

  /**
   * Get type name string
   * @param {number} typeCode
   * @returns {string}
   */
  typeName(typeCode) {
    return this._getTypeName(typeCode);
  }
}

// ============================================================================
// Base RayObject Class
// ============================================================================

class RayObject {
  constructor(sdk, ptr) {
    this._sdk = sdk;
    this._ptr = ptr;
    this._owned = true;
  }

  /**
   * Get raw pointer value
   * @returns {number}
   */
  get ptr() {
    return this._ptr;
  }

  /**
   * Get type code
   * @returns {number}
   */
  get type() {
    return this._sdk._getObjType(this._ptr);
  }

  /**
   * Get absolute type code (without sign)
   * @returns {number}
   */
  get absType() {
    const t = this.type;
    return t < 0 ? -t : t;
  }

  /**
   * Check if this is an atom (scalar)
   * @returns {boolean}
   */
  get isAtom() {
    return this._sdk._isObjAtom(this._ptr) !== 0;
  }

  /**
   * Check if this is a vector
   * @returns {boolean}
   */
  get isVector() {
    return this._sdk._isObjVector(this._ptr) !== 0;
  }

  /**
   * Check if this is null
   * @returns {boolean}
   */
  get isNull() {
    return this._sdk._isObjNull(this._ptr) !== 0;
  }

  /**
   * Check if this is an error
   * @returns {boolean}
   */
  get isError() {
    return this._sdk._isObjError(this._ptr) !== 0;
  }

  /**
   * Get length (1 for atoms)
   * @returns {number}
   */
  get length() {
    return this._sdk._getObjLen(this._ptr);
  }

  /**
   * Get reference count
   * @returns {number}
   */
  get refCount() {
    return this._sdk._getObjRc(this._ptr);
  }

  /**
   * Clone this object.  In v2 ray_t* values are reference-counted COW
   * blocks, so "clone" just bumps the refcount and shares the same
   * pointer — actual byte-level duplication happens lazily on write.
   * @returns {RayObject}
   */
  clone() {
    this._sdk._retain(this._ptr);
    return this._sdk._wrapPtr(this._ptr);
  }

  /**
   * Format to string
   * @returns {string}
   */
  toString() {
    return this._sdk.format(this._ptr);
  }

  /**
   * Convert to JavaScript value
   * @returns {any}
   */
  toJS() {
    return this.toString();
  }

  /**
   * Free this object's memory (decrements refcount; arena-flagged blocks
   * like RAY_NULL_OBJ are silently no-op'd inside ray_release).
   */
  drop() {
    if (this._owned && this._ptr !== 0) {
      this._sdk._release(this._ptr);
      this._ptr = 0;
      this._owned = false;
    }
  }

  /**
   * Release ownership (don't drop on GC)
   * @returns {number} The raw pointer
   */
  release() {
    this._owned = false;
    return this._ptr;
  }
}

// ============================================================================
// Scalar Types
// ============================================================================

class B8 extends RayObject {
  static typeCode = -Types.B8;
  
  get value() {
    return this._sdk._readB8(this._ptr) !== 0;
  }
  
  toJS() {
    return this.value;
  }
}

class U8 extends RayObject {
  static typeCode = -Types.U8;
  
  get value() {
    return this._sdk._readU8(this._ptr);
  }
  
  toJS() {
    return this.value;
  }
}

class I16 extends RayObject {
  static typeCode = -Types.I16;
  
  get value() {
    return this._sdk._readI16(this._ptr);
  }
  
  toJS() {
    return this.value;
  }
}

class I32 extends RayObject {
  static typeCode = -Types.I32;
  
  get value() {
    return this._sdk._readI32(this._ptr);
  }
  
  toJS() {
    return this.value;
  }
}

class I64 extends RayObject {
  static typeCode = -Types.I64;
  
  get value() {
    return this._sdk._readI64(this._ptr);
  }
  
  toJS() {
    return this.value;
  }
}

class F32 extends RayObject {
  static typeCode = -Types.F32;

  get value() {
    return this._sdk._readF32(this._ptr);
  }

  toJS() {
    return this.value;
  }
}

class F64 extends RayObject {
  static typeCode = -Types.F64;

  get value() {
    return this._sdk._readF64(this._ptr);
  }

  toJS() {
    return this.value;
  }
}

class RayDate extends RayObject {
  static typeCode = -Types.DATE;
  
  /**
   * Get days since 2000-01-01
   */
  get value() {
    return this._sdk._readDate(this._ptr);
  }
  
  /**
   * Convert to JS Date
   */
  toJS() {
    const epoch = new Date(2000, 0, 1);
    return new Date(epoch.getTime() + this.value * 24 * 60 * 60 * 1000);
  }
}

class RayTime extends RayObject {
  static typeCode = -Types.TIME;
  
  /**
   * Get milliseconds since midnight
   */
  get value() {
    return this._sdk._readTime(this._ptr);
  }
  
  toJS() {
    const ms = this.value;
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const millis = ms % 1000;
    return { hours, minutes, seconds, milliseconds: millis };
  }
}

class RayTimestamp extends RayObject {
  static typeCode = -Types.TIMESTAMP;
  
  /**
   * Get nanoseconds since 2000-01-01
   */
  get value() {
    return this._sdk._readTimestamp(this._ptr);
  }
  
  toJS() {
    const epoch = new Date(2000, 0, 1);
    return new Date(epoch.getTime() + this.value / 1000000);
  }
}

class Sym extends RayObject {
  static typeCode = -Types.SYM;

  /** Interned symbol ID (int64). */
  get id() {
    return this._sdk._readSymbolId(this._ptr);
  }

  /** Symbol string value (reverse-looked up from the intern table). */
  get value() {
    return this._sdk._symbolToStr(this.id);
  }

  toJS() {
    return this.value;
  }
}

// Backward-compat alias — the old Symbol export shadowed the global.
const SymbolClass = Sym;

class GUID extends RayObject {
  static typeCode = -Types.GUID;
  
  toJS() {
    // Format GUID bytes as string
    return this.toString();
  }
}

// ============================================================================
// Null and Error Types
// ============================================================================

class RayNull extends RayObject {
  static typeCode = Types.NULL;
  
  get isNull() {
    return true;
  }
  
  toJS() {
    return null;
  }
}

class RayError extends RayObject {
  static typeCode = Types.ERR;

  get isError() {
    return true;
  }

  /** Inline 7-byte error code (e.g. "type", "domain", "user", "oom"). */
  get code() {
    return this._sdk._getErrorCode(this._ptr);
  }

  /**
   * Per-VM error message text.  Snapshotted into a stable buffer on the
   * C side, so this getter is safe to read at any time after the error
   * was raised — but the snapshot is overwritten by the next ray_error()
   * call, so capture it eagerly if you need to compare across evals.
   */
  get message() {
    return this._sdk._getErrorMessage(this._ptr);
  }

  toString() {
    const c = this.code;
    const m = this.message;
    return m ? `${c}: ${m}` : c;
  }

  toJS() {
    throw new Error(this.toString());
  }
}

// ============================================================================
// Vector with Zero-Copy TypedArray View
// ============================================================================

class Vector extends RayObject {
  constructor(sdk, ptr, elementType) {
    super(sdk, ptr);
    this._elementType = elementType !== undefined ? elementType : sdk._getObjType(ptr);
    this._typedArray = null;
  }

  get elementType() {
    return this._elementType;
  }

  /**
   * Get zero-copy TypedArray view over the vector data.
   * WARNING: This view is only valid while the Vector exists.
   * @returns {TypedArray}
   */
  get typedArray() {
    if (this._typedArray === null) {
      const ArrayType = TYPED_ARRAY_MAP[this._elementType];
      if (!ArrayType) {
        throw new Error(`No TypedArray for type ${this._elementType}`);
      }
      
      const dataPtr = this._sdk._getDataPtr(this._ptr);
      const byteSize = this._sdk._getDataByteSize(this._ptr);
      const elementSize = ELEMENT_SIZES[this._elementType];
      const length = byteSize / elementSize;
      
      // Create view over WASM memory
      this._typedArray = new ArrayType(
        this._sdk._wasm.HEAPU8.buffer,
        dataPtr,
        length
      );
    }
    return this._typedArray;
  }

  /**
   * Get element at index
   * @param {number} idx
   * @param {boolean} [raw=false] - If true, return raw value without conversion
   * @returns {any}
   */
  at(idx, raw = false) {
    if (idx < 0) idx = this.length + idx;
    if (idx < 0 || idx >= this.length) {
      throw new RangeError(`Index ${idx} out of bounds [0, ${this.length})`);
    }
    const val = this.typedArray[idx];
    
    // Convert symbol IDs to strings
    if (!raw && this._elementType === Types.SYM) {
      return this._sdk._symbolVecGet(this._ptr, idx);
    }
    
    // Convert BigInt to Number if safe
    if (!raw && typeof val === 'bigint') {
      const n = Number(val);
      if (Number.isSafeInteger(n)) return n;
    }
    
    return val;
  }

  /**
   * Set element at index
   * @param {number} idx
   * @param {any} value
   */
  set(idx, value) {
    if (idx < 0) idx = this.length + idx;
    if (idx < 0 || idx >= this.length) {
      throw new RangeError(`Index ${idx} out of bounds [0, ${this.length})`);
    }
    this.typedArray[idx] = value;
  }

  /**
   * Convert to JS array (copies data)
   * @returns {Array}
   */
  toJS() {
    const arr = Array.from(this.typedArray);
    
    // Convert BigInt to Number for I64 types if safe
    if (this._elementType === Types.I64 ||
        this._elementType === Types.TIMESTAMP ||
        this._elementType === Types.SYM) {
      return arr.map((v, idx) => {
        if (this._elementType === Types.SYM) {
          return this._sdk._symbolVecGet(this._ptr, idx);
        }
        const n = Number(v);
        return Number.isSafeInteger(n) ? n : v;
      });
    }
    
    return arr;
  }

  /**
   * Iterator support
   */
  *[globalThis.Symbol.iterator]() {
    const view = this.typedArray;
    for (let i = 0; i < view.length; i++) {
      yield view[i];
    }
  }
}

// ============================================================================
// String atom (RAY_STR)
//
// v2 strings are atoms with SSO inline storage for ≤7 bytes and an
// extension-block ray_t* for longer strings.  str_atom_ptr / str_atom_len
// hide the layout difference; from JS we just see a const char* + length.
// ============================================================================

class RayString extends RayObject {
  static typeCode = -Types.STR;

  get value() {
    return this._sdk._strAtomPtr(this._ptr);
  }

  toJS() {
    return this.value;
  }

  toString() {
    return this.value;
  }
}

// ============================================================================
// String vector (RAY_STR vector)
//
// Per-cell ray_str_t structs aren't typed-array-viewable — read each cell
// via _strVecGet, which copies the bytes into a thread-local C buffer that
// Emscripten then turns into a JS string.
// ============================================================================

class StrVector extends RayObject {
  at(idx) {
    if (idx < 0) idx = this.length + idx;
    if (idx < 0 || idx >= this.length) {
      throw new RangeError(`Index ${idx} out of bounds [0, ${this.length})`);
    }
    return this._sdk._strVecGet(this._ptr, idx);
  }

  toJS() {
    const out = new Array(this.length);
    for (let i = 0; i < this.length; i++) out[i] = this.at(i);
    return out;
  }

  *[globalThis.Symbol.iterator]() {
    for (let i = 0; i < this.length; i++) yield this.at(i);
  }
}

// ============================================================================
// List (Mixed-Type Container)
// ============================================================================

class List extends RayObject {
  /**
   * Get element at index
   * @param {number} idx
   * @returns {RayObject}
   */
  at(idx) {
    if (idx < 0) idx = this.length + idx;
    if (idx < 0 || idx >= this.length) {
      throw new RangeError(`Index ${idx} out of bounds [0, ${this.length})`);
    }
    return this._sdk._wrapPtr(this._sdk._vecAtIdx(this._ptr, idx));
  }

  /**
   * Set element at index.  Note: v2 list ops are COW — a fresh ptr is
   * returned and we rebind so the JS handle keeps pointing at the live
   * version.  The returned ray_t* may share storage with the previous one.
   * @param {number} idx
   * @param {RayObject|any} value
   */
  set(idx, value) {
    if (idx < 0) idx = this.length + idx;
    const obj = value instanceof RayObject ? value : this._sdk._toRayObject(value);
    this._ptr = this._sdk._vecSetIdx(this._ptr, idx, obj._ptr);
  }

  /**
   * Push element to end.  COW semantics: rebind self to the (possibly
   * new) parent pointer returned by ray_list_append.
   */
  push(value) {
    const obj = value instanceof RayObject ? value : this._sdk._toRayObject(value);
    this._ptr = this._sdk._vecPush(this._ptr, obj._ptr);
  }

  /**
   * Convert to JS array
   * @returns {Array}
   */
  toJS() {
    const result = [];
    for (let i = 0; i < this.length; i++) {
      result.push(this.at(i).toJS());
    }
    return result;
  }

  *[globalThis.Symbol.iterator]() {
    for (let i = 0; i < this.length; i++) {
      yield this.at(i);
    }
  }
}

// ============================================================================
// Dict (Key-Value Mapping)
// ============================================================================

class Dict extends RayObject {
  /**
   * Get keys as symbol vector
   * @returns {Vector}
   */
  keys() {
    return this._sdk._wrapPtr(this._sdk._dictKeys(this._ptr));
  }

  /**
   * Get values as list
   * @returns {List}
   */
  values() {
    return this._sdk._wrapPtr(this._sdk._dictVals(this._ptr));
  }

  /**
   * Get value by key
   * @param {string|Sym} key
   * @returns {RayObject}
   */
  get(key) {
    const keyObj = typeof key === 'string' ? this._sdk.symbol(key) : key;
    const ptr = this._sdk._dictGet(this._ptr, keyObj._ptr);
    return this._sdk._wrapPtr(ptr);
  }

  /**
   * Check if key exists
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    return !this.get(key).isNull;
  }

  /**
   * Convert to JS object
   * @returns {Object}
   */
  toJS() {
    const result = {};
    const keys = this.keys();
    const vals = this.values();
    
    for (let i = 0; i < keys.length; i++) {
      const keyStr = this._sdk._symbolToStr(Number(keys.at(i)));
      result[keyStr] = vals.at(i).toJS();
    }
    
    return result;
  }

  *[globalThis.Symbol.iterator]() {
    const keys = this.keys();
    const vals = this.values();
    for (let i = 0; i < keys.length; i++) {
      const keyStr = this._sdk._symbolToStr(Number(keys.at(i)));
      yield [keyStr, vals.at(i)];
    }
  }
}

// ============================================================================
// Table
// ============================================================================

class Table extends RayObject {
  /**
   * Get column names
   * @returns {Vector}
   */
  columns() {
    return this._sdk._wrapPtr(this._sdk._tableKeys(this._ptr));
  }

  /**
   * Get column names as string array
   * @returns {string[]}
   */
  columnNames() {
    const cols = this.columns();
    const names = [];
    for (let i = 0; i < cols.length; i++) {
      // at() already converts symbol IDs to strings
      names.push(cols.at(i));
    }
    return names;
  }

  /**
   * Get all values as list of vectors
   * @returns {List}
   */
  values() {
    return this._sdk._wrapPtr(this._sdk._tableVals(this._ptr));
  }

  /**
   * Get column by name
   * @param {string} name
   * @returns {Vector}
   */
  col(name) {
    return this._sdk._wrapPtr(this._sdk._tableCol(this._ptr, name, name.length));
  }

  /**
   * Get row by index
   * @param {number} idx
   * @returns {Dict}
   */
  row(idx) {
    return this._sdk._wrapPtr(this._sdk._tableRow(this._ptr, idx));
  }

  /**
   * Get row count
   * @returns {number}
   */
  get rowCount() {
    return this._sdk._tableCount(this._ptr);
  }

  /**
   * Create a select query builder
   * @param {...string} cols - Column names to select
   * @returns {SelectQuery}
   */
  select(...cols) {
    return new SelectQuery(this._sdk, this).select(...cols);
  }

  /**
   * Create a where clause
   * @param {Expression} condition
   * @returns {SelectQuery}
   */
  where(condition) {
    return new SelectQuery(this._sdk, this).where(condition);
  }

  /**
   * Insert data into table
   * @param {Object|Array} data
   * @returns {Table}
   */
  insert(data) {
    let insertData;
    if (Array.isArray(data)) {
      insertData = this._sdk.list(data.map(v => this._sdk._toRayObject(v)));
    } else {
      insertData = this._sdk.dict(data);
    }
    const newPtr = this._sdk._tableInsert(this._ptr, insertData._ptr);
    return this._sdk._wrapPtr(newPtr);
  }

  /**
   * Convert to JS object with column arrays
   * @returns {Object}
   */
  toJS() {
    const result = {};
    const names = this.columnNames();
    const vals = this.values();
    
    for (let i = 0; i < names.length; i++) {
      result[names[i]] = vals.at(i).toJS();
    }
    
    return result;
  }

  /**
   * Convert to array of row objects
   * @returns {Object[]}
   */
  toRows() {
    const names = this.columnNames();
    const count = this.rowCount;
    const rows = [];
    
    for (let i = 0; i < count; i++) {
      const row = {};
      for (const name of names) {
        row[name] = this.col(name).at(i);
        if (typeof row[name] === 'bigint') {
          const n = Number(row[name]);
          row[name] = Number.isSafeInteger(n) ? n : row[name];
        }
      }
      rows.push(row);
    }
    
    return rows;
  }
}

// ============================================================================
// Lambda (Function)
// ============================================================================

class Lambda extends RayObject {
  /**
   * Call the lambda with arguments
   * @param {...any} args
   * @returns {RayObject}
   */
  call(...args) {
    // Build call expression
    const argList = args.map(a => {
      if (a instanceof RayObject) return a.toString();
      if (typeof a === 'string') return `\`${a}`;
      return String(a);
    }).join(' ');
    
    const expr = `(${this.toString()} ${argList})`;
    return this._sdk.eval(expr);
  }
}

// ============================================================================
// Query Builder
// ============================================================================

/**
 * Expression builder for query conditions
 */
class Expr {
  constructor(sdk, parts) {
    this._sdk = sdk;
    this._parts = parts;
  }

  /**
   * Create a column reference
   * @param {string} name
   * @returns {Expr}
   */
  static col(sdk, name) {
    return new Expr(sdk, [`\`${name}`]);
  }

  // Comparison operators
  eq(value) { return this._binOp('=', value); }
  ne(value) { return this._binOp('<>', value); }
  lt(value) { return this._binOp('<', value); }
  le(value) { return this._binOp('<=', value); }
  gt(value) { return this._binOp('>', value); }
  ge(value) { return this._binOp('>=', value); }
  
  // Logical operators
  and(other) { return this._logicOp('and', other); }
  or(other) { return this._logicOp('or', other); }
  not() { return new Expr(this._sdk, ['(not', ...this._parts, ')']); }
  
  // Aggregations
  sum() { return new Expr(this._sdk, ['(sum', ...this._parts, ')']); }
  avg() { return new Expr(this._sdk, ['(avg', ...this._parts, ')']); }
  min() { return new Expr(this._sdk, ['(min', ...this._parts, ')']); }
  max() { return new Expr(this._sdk, ['(max', ...this._parts, ')']); }
  count() { return new Expr(this._sdk, ['(count', ...this._parts, ')']); }
  first() { return new Expr(this._sdk, ['(first', ...this._parts, ')']); }
  last() { return new Expr(this._sdk, ['(last', ...this._parts, ')']); }
  distinct() { return new Expr(this._sdk, ['(distinct', ...this._parts, ')']); }
  
  _binOp(op, value) {
    const valStr = this._valueToStr(value);
    return new Expr(this._sdk, [`(${op}`, ...this._parts, valStr, ')']);
  }
  
  _logicOp(op, other) {
    return new Expr(this._sdk, [`(${op}`, ...this._parts, ...other._parts, ')']);
  }
  
  _valueToStr(value) {
    if (value instanceof Expr) return value.toString();
    if (typeof value === 'string') return `"${value}"`;
    if (value instanceof Date) {
      // Format as Rayforce timestamp
      return value.toISOString();
    }
    return String(value);
  }
  
  toString() {
    return this._parts.join(' ');
  }
}

/**
 * SELECT query builder
 */
class SelectQuery {
  constructor(sdk, table) {
    this._sdk = sdk;
    this._table = table;
    this._selectCols = null;
    this._whereCond = null;
    this._byCols = null;
    this._computedCols = {};
  }

  /**
   * Specify columns to select
   * @param {...string|Expr} cols
   * @returns {SelectQuery}
   */
  select(...cols) {
    const q = this._clone();
    q._selectCols = cols;
    return q;
  }

  /**
   * Add computed column
   * @param {string} name
   * @param {Expr} expr
   * @returns {SelectQuery}
   */
  withColumn(name, expr) {
    const q = this._clone();
    q._computedCols[name] = expr;
    return q;
  }

  /**
   * Add WHERE condition
   * @param {Expr} condition
   * @returns {SelectQuery}
   */
  where(condition) {
    const q = this._clone();
    q._whereCond = q._whereCond ? q._whereCond.and(condition) : condition;
    return q;
  }

  /**
   * Add GROUP BY columns
   * @param {...string} cols
   * @returns {SelectQuery}
   */
  groupBy(...cols) {
    const q = this._clone();
    q._byCols = cols;
    return q;
  }

  /**
   * Column reference helper
   * @param {string} name
   * @returns {Expr}
   */
  col(name) {
    return Expr.col(this._sdk, name);
  }

  /**
   * Execute the query.
   *
   * v2's ray_select_fn evaluates the dict body as an AST node — its `from:`
   * slot expects an unevaluated symbol/expression, not a raw ray_t* stuffed
   * in as an i64 atom.  We bind the live table to a temporary global,
   * render the query as a Rayfall string, eval, then leave the binding for
   * the caller to clean up (eval's name resolution catches it).
   * @returns {Table|RayError}
   */
  execute() {
    const sdk = this._sdk;
    const tableSym = `__rfq_${++sdk._cmdCounter}`;
    sdk.set(tableSym, this._table);

    const parts = [`from: ${tableSym}`];

    if (this._selectCols && this._selectCols.length) {
      for (const c of this._selectCols) {
        if (typeof c === 'string')   parts.push(`${c}: ${c}`);
        else if (c instanceof Expr)  parts.push(`${c.toString()}`);
      }
    }
    for (const [name, expr] of Object.entries(this._computedCols)) {
      parts.push(`${name}: ${expr.toString()}`);
    }
    if (this._whereCond) parts.push(`where: ${this._whereCond.toString()}`);
    if (this._byCols && this._byCols.length) {
      const by = this._byCols.map(c => `${c}: ${c}`).join(' ');
      parts.push(`by: {${by}}`);
    }

    const expr = `(select {${parts.join(' ')}})`;
    return sdk.eval(expr, 'select-query');
  }

  _clone() {
    const q = new SelectQuery(this._sdk, this._table);
    q._selectCols = this._selectCols;
    q._whereCond = this._whereCond;
    q._byCols = this._byCols;
    q._computedCols = { ...this._computedCols };
    return q;
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  RayforceSDK,
  RayObject,
  RayNull,
  RayError,
  B8, U8, I16, I32, I64, F32, F64,
  RayDate, RayTime, RayTimestamp,
  Sym, GUID,
  Vector, RayString, StrVector, List, Dict, Table, Lambda,
  Expr, SelectQuery,
};

// Backward-compat alias — v0.x consumers imported `Symbol` from this module.
export { Sym as Symbol };

// Default export for UMD/CDN usage
export default {
  createRayforceSDK,
  Types,
  Expr,
};
