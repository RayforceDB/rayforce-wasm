/**
 * RayforceDB UMD Bundle
 * 
 * This file provides a UMD (Universal Module Definition) wrapper
 * for browser usage via script tag.
 * 
 * Usage:
 *   <script src="rayforce.umd.js"></script>
 *   <script>
 *     Rayforce.init().then(rf => {
 *       console.log(rf.eval('(+ 1 2 3)').toJS()); // 6
 *     });
 *   </script>
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    // AMD
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    // CommonJS
    module.exports = factory();
  } else {
    // Browser global
    root.Rayforce = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ============================================================================
  // Type Constants
  // ============================================================================

  const Types = Object.freeze({
    LIST: 0,
    B8: 1,
    U8: 2,
    I16: 3,
    I32: 4,
    I64: 5,
    SYMBOL: 6,
    DATE: 7,
    TIME: 8,
    TIMESTAMP: 9,
    F64: 10,
    GUID: 11,
    C8: 12,
    TABLE: 98,
    DICT: 99,
    LAMBDA: 100,
    NULL: 126,
    ERR: 127,
  });

  // Element sizes for each type (in bytes)
  const ELEMENT_SIZES = {
    [Types.B8]: 1,
    [Types.U8]: 1,
    [Types.C8]: 1,
    [Types.I16]: 2,
    [Types.I32]: 4,
    [Types.I64]: 8,
    [Types.F64]: 8,
    [Types.DATE]: 4,
    [Types.TIME]: 4,
    [Types.TIMESTAMP]: 8,
    [Types.SYMBOL]: 8,
    [Types.GUID]: 16,
    [Types.LIST]: 4,
  };

  // TypedArray constructors for each type
  const TYPED_ARRAY_MAP = {
    [Types.B8]: Int8Array,
    [Types.U8]: Uint8Array,
    [Types.C8]: Uint8Array,
    [Types.I16]: Int16Array,
    [Types.I32]: Int32Array,
    [Types.I64]: BigInt64Array,
    [Types.F64]: Float64Array,
    [Types.DATE]: Int32Array,
    [Types.TIME]: Int32Array,
    [Types.TIMESTAMP]: BigInt64Array,
    [Types.SYMBOL]: BigInt64Array,
  };

  // ============================================================================
  // RayObject Base Class
  // ============================================================================

  class RayObject {
    constructor(sdk, ptr) {
      this._sdk = sdk;
      this._ptr = ptr;
      this._owned = true;
    }

    get ptr() { return this._ptr; }
    get type() { return this._sdk._getObjType(this._ptr); }
    get absType() { const t = this.type; return t < 0 ? -t : t; }
    get isAtom() { return this._sdk._isObjAtom(this._ptr) !== 0; }
    get isVector() { return this._sdk._isObjVector(this._ptr) !== 0; }
    get isNull() { return this._sdk._isObjNull(this._ptr) !== 0; }
    get isError() { return this._sdk._isObjError(this._ptr) !== 0; }
    get length() { return this._sdk._getObjLen(this._ptr); }
    get refCount() { return this._sdk._getObjRc(this._ptr); }

    clone() { return this._sdk._wrapPtr(this._sdk._cloneObj(this._ptr)); }
    toString() { return this._sdk.format(this._ptr); }
    toJS() { return this.toString(); }

    drop() {
      if (this._owned && this._ptr !== 0) {
        this._sdk._dropObj(this._ptr);
        this._ptr = 0;
        this._owned = false;
      }
    }

    release() {
      this._owned = false;
      return this._ptr;
    }
  }

  // ============================================================================
  // Scalar Types
  // ============================================================================

  class B8 extends RayObject {
    get value() { return this._sdk._readB8(this._ptr) !== 0; }
    toJS() { return this.value; }
  }

  class U8 extends RayObject {
    get value() { return this._sdk._readU8(this._ptr); }
    toJS() { return this.value; }
  }

  class C8 extends RayObject {
    get value() { return String.fromCharCode(this._sdk._readC8(this._ptr)); }
    toJS() { return this.value; }
  }

  class I16 extends RayObject {
    get value() { return this._sdk._readI16(this._ptr); }
    toJS() { return this.value; }
  }

  class I32 extends RayObject {
    get value() { return this._sdk._readI32(this._ptr); }
    toJS() { return this.value; }
  }

  class I64 extends RayObject {
    get value() { return this._sdk._readI64(this._ptr); }
    toJS() { return this.value; }
  }

  class F64 extends RayObject {
    get value() { return this._sdk._readF64(this._ptr); }
    toJS() { return this.value; }
  }

  class RayDate extends RayObject {
    get value() { return this._sdk._readDate(this._ptr); }
    toJS() {
      const epoch = new Date(2000, 0, 1);
      return new Date(epoch.getTime() + this.value * 24 * 60 * 60 * 1000);
    }
  }

  class RayTime extends RayObject {
    get value() { return this._sdk._readTime(this._ptr); }
    toJS() {
      const ms = this.value;
      return {
        hours: Math.floor(ms / 3600000),
        minutes: Math.floor((ms % 3600000) / 60000),
        seconds: Math.floor((ms % 60000) / 1000),
        milliseconds: ms % 1000
      };
    }
  }

  class RayTimestamp extends RayObject {
    get value() { return this._sdk._readTimestamp(this._ptr); }
    toJS() {
      const epoch = new Date(2000, 0, 1);
      return new Date(epoch.getTime() + this.value / 1000000);
    }
  }

  class RaySymbol extends RayObject {
    get id() { return this._sdk._readSymbolId(this._ptr); }
    get value() { return this._sdk._symbolToStr(this.id); }
    toJS() { return this.value; }
  }

  class GUID extends RayObject {
    toJS() { return this.toString(); }
  }

  class RayNull extends RayObject {
    get isNull() { return true; }
    toJS() { return null; }
  }

  class RayError extends RayObject {
    get isError() { return true; }
    get message() { return this.toString(); }
    toJS() { throw new Error(this.message); }
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

    get elementType() { return this._elementType; }

    get typedArray() {
      if (this._typedArray === null) {
        const ArrayType = TYPED_ARRAY_MAP[this._elementType];
        if (!ArrayType) throw new Error(`No TypedArray for type ${this._elementType}`);

        const dataPtr = this._sdk._getDataPtr(this._ptr);
        const byteSize = this._sdk._getDataByteSize(this._ptr);
        const elementSize = ELEMENT_SIZES[this._elementType];
        const length = byteSize / elementSize;

        this._typedArray = new ArrayType(this._sdk._wasm.HEAPU8.buffer, dataPtr, length);
      }
      return this._typedArray;
    }

    at(idx) {
      if (idx < 0) idx = this.length + idx;
      if (idx < 0 || idx >= this.length) throw new RangeError(`Index ${idx} out of bounds`);
      return this.typedArray[idx];
    }

    set(idx, value) {
      if (idx < 0) idx = this.length + idx;
      if (idx < 0 || idx >= this.length) throw new RangeError(`Index ${idx} out of bounds`);
      this.typedArray[idx] = value;
    }

    toJS() {
      const arr = Array.from(this.typedArray);
      if (this._elementType === Types.I64 || this._elementType === Types.TIMESTAMP || this._elementType === Types.SYMBOL) {
        return arr.map(v => {
          if (this._elementType === Types.SYMBOL) return this._sdk._symbolToStr(Number(v));
          const n = Number(v);
          return Number.isSafeInteger(n) ? n : v;
        });
      }
      return arr;
    }

    *[Symbol.iterator]() {
      const view = this.typedArray;
      for (let i = 0; i < view.length; i++) yield view[i];
    }
  }

  // ============================================================================
  // String (Character Vector)
  // ============================================================================

  class RayString extends Vector {
    constructor(sdk, ptr) { super(sdk, ptr, Types.C8); }
    get value() { return new TextDecoder('utf-8').decode(this.typedArray); }
    toJS() { return this.value; }
    toString() { return this.value; }
  }

  // ============================================================================
  // List (Mixed-Type Container)
  // ============================================================================

  class List extends RayObject {
    at(idx) {
      if (idx < 0) idx = this.length + idx;
      if (idx < 0 || idx >= this.length) throw new RangeError(`Index ${idx} out of bounds`);
      return this._sdk._wrapPtr(this._sdk._atIdx(this._ptr, idx));
    }

    set(idx, value) {
      if (idx < 0) idx = this.length + idx;
      const obj = value instanceof RayObject ? value : this._sdk._toRayObject(value);
      this._sdk._wasm.ccall('ins_obj', 'number', ['number', 'number', 'number'], [this._ptr, idx, obj._ptr]);
    }

    push(value) {
      const obj = value instanceof RayObject ? value : this._sdk._toRayObject(value);
      const stackSave = this._sdk._wasm.stackSave();
      const ptrPtr = this._sdk._wasm.stackAlloc(4);
      this._sdk._wasm.setValue(ptrPtr, this._ptr, 'i32');
      this._sdk._pushObj(ptrPtr, obj._ptr);
      this._ptr = this._sdk._wasm.getValue(ptrPtr, 'i32');
      this._sdk._wasm.stackRestore(stackSave);
    }

    toJS() {
      const result = [];
      for (let i = 0; i < this.length; i++) result.push(this.at(i).toJS());
      return result;
    }

    *[Symbol.iterator]() {
      for (let i = 0; i < this.length; i++) yield this.at(i);
    }
  }

  // ============================================================================
  // Dict (Key-Value Mapping)
  // ============================================================================

  class Dict extends RayObject {
    keys() { return this._sdk._wrapPtr(this._sdk._dictKeys(this._ptr)); }
    values() { return this._sdk._wrapPtr(this._sdk._dictVals(this._ptr)); }

    get(key) {
      const keyObj = typeof key === 'string' ? this._sdk.symbol(key) : key;
      return this._sdk._wrapPtr(this._sdk._dictGet(this._ptr, keyObj._ptr));
    }

    has(key) { return !this.get(key).isNull; }

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

    *[Symbol.iterator]() {
      const keys = this.keys();
      const vals = this.values();
      for (let i = 0; i < keys.length; i++) {
        yield [this._sdk._symbolToStr(Number(keys.at(i))), vals.at(i)];
      }
    }
  }

  // ============================================================================
  // Table
  // ============================================================================

  class Table extends RayObject {
    columns() { return this._sdk._wrapPtr(this._sdk._tableKeys(this._ptr)); }

    columnNames() {
      const cols = this.columns();
      const names = [];
      for (let i = 0; i < cols.length; i++) {
        names.push(this._sdk._symbolToStr(Number(cols.at(i))));
      }
      return names;
    }

    values() { return this._sdk._wrapPtr(this._sdk._tableVals(this._ptr)); }
    col(name) { return this._sdk._wrapPtr(this._sdk._tableCol(this._ptr, name, name.length)); }
    row(idx) { return this._sdk._wrapPtr(this._sdk._tableRow(this._ptr, idx)); }
    get rowCount() { return this._sdk._tableCount(this._ptr); }

    select(...cols) { return new SelectQuery(this._sdk, this).select(...cols); }
    where(condition) { return new SelectQuery(this._sdk, this).where(condition); }

    insert(data) {
      let insertData;
      if (Array.isArray(data)) {
        insertData = this._sdk.list(data.map(v => this._sdk._toRayObject(v)));
      } else {
        insertData = this._sdk.dict(data);
      }
      return this._sdk._wrapPtr(this._sdk._tableInsert(this._ptr, insertData._ptr));
    }

    toJS() {
      const result = {};
      const names = this.columnNames();
      const vals = this.values();
      for (let i = 0; i < names.length; i++) {
        result[names[i]] = vals.at(i).toJS();
      }
      return result;
    }

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
    call(...args) {
      const argList = args.map(a => {
        if (a instanceof RayObject) return a.toString();
        if (typeof a === 'string') return `\`${a}`;
        return String(a);
      }).join(' ');
      return this._sdk.eval(`(${this.toString()} ${argList})`);
    }
  }

  // ============================================================================
  // Expression Builder
  // ============================================================================

  class Expr {
    constructor(sdk, parts) {
      this._sdk = sdk;
      this._parts = parts;
    }

    static col(sdk, name) { return new Expr(sdk, [`\`${name}`]); }

    eq(value) { return this._binOp('=', value); }
    ne(value) { return this._binOp('<>', value); }
    lt(value) { return this._binOp('<', value); }
    le(value) { return this._binOp('<=', value); }
    gt(value) { return this._binOp('>', value); }
    ge(value) { return this._binOp('>=', value); }

    and(other) { return this._logicOp('and', other); }
    or(other) { return this._logicOp('or', other); }
    not() { return new Expr(this._sdk, ['(not', ...this._parts, ')']); }

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
      return String(value);
    }

    toString() { return this._parts.join(' '); }
  }

  // ============================================================================
  // SelectQuery Builder
  // ============================================================================

  class SelectQuery {
    constructor(sdk, table) {
      this._sdk = sdk;
      this._table = table;
      this._selectCols = null;
      this._whereCond = null;
      this._byCols = null;
      this._computedCols = {};
    }

    select(...cols) {
      const q = this._clone();
      q._selectCols = cols;
      return q;
    }

    withColumn(name, expr) {
      const q = this._clone();
      q._computedCols[name] = expr;
      return q;
    }

    where(condition) {
      const q = this._clone();
      q._whereCond = q._whereCond ? q._whereCond.and(condition) : condition;
      return q;
    }

    groupBy(...cols) {
      const q = this._clone();
      q._byCols = cols;
      return q;
    }

    col(name) { return Expr.col(this._sdk, name); }

    execute() {
      const query = { from: this._table._ptr };
      if (this._selectCols) {
        for (const col of this._selectCols) {
          if (typeof col === 'string') query[col] = col;
        }
      }
      for (const [name, expr] of Object.entries(this._computedCols)) {
        query[name] = expr.toString();
      }
      if (this._whereCond) query.where = this._whereCond.toString();
      if (this._byCols) {
        query.by = {};
        for (const col of this._byCols) query.by[col] = col;
      }
      const queryDict = this._sdk.dict(query);
      return this._sdk._wrapPtr(this._sdk._querySelect(queryDict._ptr));
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

      this._evalCmd = w.cwrap('eval_cmd', 'number', ['string', 'string']);
      this._evalStr = w.cwrap('eval_str', 'number', ['string']);
      this._strOfObj = w.cwrap('strof_obj', 'string', ['number']);
      this._dropObj = w.cwrap('drop_obj', null, ['number']);
      this._cloneObj = w.cwrap('clone_obj', 'number', ['number']);
      this._versionStr = w.cwrap('version_str', 'string', []);

      this._getObjType = w.cwrap('get_obj_type', 'number', ['number']);
      this._getObjLen = w.cwrap('get_obj_len', 'number', ['number']);
      this._isObjAtom = w.cwrap('is_obj_atom', 'number', ['number']);
      this._isObjVector = w.cwrap('is_obj_vector', 'number', ['number']);
      this._isObjNull = w.cwrap('is_obj_null', 'number', ['number']);
      this._isObjError = w.cwrap('is_obj_error', 'number', ['number']);
      this._getObjRc = w.cwrap('get_obj_rc', 'number', ['number']);

      this._getDataPtr = w.cwrap('get_data_ptr', 'number', ['number']);
      this._getElementSize = w.cwrap('get_element_size', 'number', ['number']);
      this._getDataByteSize = w.cwrap('get_data_byte_size', 'number', ['number']);

      this._initB8 = w.cwrap('init_b8', 'number', ['number']);
      this._initU8 = w.cwrap('init_u8', 'number', ['number']);
      this._initC8 = w.cwrap('init_c8', 'number', ['number']);
      this._initI16 = w.cwrap('init_i16', 'number', ['number']);
      this._initI32 = w.cwrap('init_i32', 'number', ['number']);
      this._initI64 = w.cwrap('init_i64', 'number', ['number']);
      this._initF64 = w.cwrap('init_f64', 'number', ['number']);
      this._initDate = w.cwrap('init_date', 'number', ['number']);
      this._initTime = w.cwrap('init_time', 'number', ['number']);
      this._initTimestamp = w.cwrap('init_timestamp', 'number', ['number']);
      this._initSymbolStr = w.cwrap('init_symbol_str', 'number', ['string', 'number']);
      this._initStringStr = w.cwrap('init_string_str', 'number', ['string', 'number']);

      this._readB8 = w.cwrap('read_b8', 'number', ['number']);
      this._readU8 = w.cwrap('read_u8', 'number', ['number']);
      this._readC8 = w.cwrap('read_c8', 'number', ['number']);
      this._readI16 = w.cwrap('read_i16', 'number', ['number']);
      this._readI32 = w.cwrap('read_i32', 'number', ['number']);
      this._readI64 = w.cwrap('read_i64', 'number', ['number']);
      this._readF64 = w.cwrap('read_f64', 'number', ['number']);
      this._readDate = w.cwrap('read_date', 'number', ['number']);
      this._readTime = w.cwrap('read_time', 'number', ['number']);
      this._readTimestamp = w.cwrap('read_timestamp', 'number', ['number']);
      this._readSymbolId = w.cwrap('read_symbol_id', 'number', ['number']);
      this._symbolToStr = w.cwrap('symbol_to_str', 'string', ['number']);
      // Change signature to number (ptr) to handle manual heap allocation
      this._readCSV = w.cwrap('read_csv', 'number', ['number', 'number']);

      this._initVector = w.cwrap('init_vector', 'number', ['number', 'number']);
      this._initList = w.cwrap('init_list', 'number', ['number']);
      this._vecAtIdx = w.cwrap('vec_at_idx', 'number', ['number', 'number']);
      this._atIdx = w.cwrap('at_idx', 'number', ['number', 'number']);
      this._atObj = w.cwrap('at_obj', 'number', ['number', 'number']);
      this._pushObj = w.cwrap('push_obj', 'number', ['number', 'number']);
      this._insObj = w.cwrap('ins_obj', 'number', ['number', 'number', 'number']);

      this._initDict = w.cwrap('init_dict', 'number', ['number', 'number']);
      this._dictKeys = w.cwrap('dict_keys', 'number', ['number']);
      this._dictVals = w.cwrap('dict_vals', 'number', ['number']);
      this._dictGet = w.cwrap('dict_get', 'number', ['number', 'number']);

      this._initTable = w.cwrap('init_table', 'number', ['number', 'number']);
      this._tableKeys = w.cwrap('table_keys', 'number', ['number']);
      this._tableVals = w.cwrap('table_vals', 'number', ['number']);
      this._tableCol = w.cwrap('table_col', 'number', ['number', 'string', 'number']);
      this._tableRow = w.cwrap('table_row', 'number', ['number', 'number']);
      this._tableCount = w.cwrap('table_count', 'number', ['number']);

      this._querySelect = w.cwrap('query_select', 'number', ['number']);
      this._queryUpdate = w.cwrap('query_update', 'number', ['number']);
      this._tableInsert = w.cwrap('table_insert', 'number', ['number', 'number']);
      this._tableUpsert = w.cwrap('table_upsert', 'number', ['number', 'number', 'number']);

      this._internSymbol = w.cwrap('intern_symbol', 'number', ['string', 'number']);
      this._globalSet = w.cwrap('global_set', null, ['number', 'number']);
      this._quoteObj = w.cwrap('quote_obj', 'number', ['number']);
      this._getTypeName = w.cwrap('get_type_name', 'string', ['number']);
    }

    get version() { return this._versionStr(); }

    eval(code, sourceName) {
      const ptr = this._evalCmd(code, sourceName || `eval:${++this._cmdCounter}`);
      return this._wrapPtr(ptr);
    }

    format(obj) {
      const ptr = obj instanceof RayObject ? obj._ptr : obj;
      return this._strOfObj(ptr);
    }

    _wrapPtr(ptr) {
      if (ptr === 0) return new RayNull(this, 0);

      const type = this._getObjType(ptr);
      const isAtom = this._isObjAtom(ptr);
      const absType = type < 0 ? -type : type;

      if (type === Types.ERR) return new RayError(this, ptr);
      if (type === Types.NULL || this._isObjNull(ptr)) return new RayNull(this, ptr);

      if (isAtom) {
        switch (absType) {
          case Types.B8: return new B8(this, ptr);
          case Types.U8: return new U8(this, ptr);
          case Types.C8: return new C8(this, ptr);
          case Types.I16: return new I16(this, ptr);
          case Types.I32: return new I32(this, ptr);
          case Types.I64: return new I64(this, ptr);
          case Types.F64: return new F64(this, ptr);
          case Types.DATE: return new RayDate(this, ptr);
          case Types.TIME: return new RayTime(this, ptr);
          case Types.TIMESTAMP: return new RayTimestamp(this, ptr);
          case Types.SYMBOL: return new RaySymbol(this, ptr);
          case Types.GUID: return new GUID(this, ptr);
          default: return new RayObject(this, ptr);
        }
      }

      switch (type) {
        case Types.C8: return new RayString(this, ptr);
        case Types.LIST: return new List(this, ptr);
        case Types.DICT: return new Dict(this, ptr);
        case Types.TABLE: return new Table(this, ptr);
        case Types.LAMBDA: return new Lambda(this, ptr);
        default:
          if (TYPED_ARRAY_MAP[type]) return new Vector(this, ptr, type);
          return new RayObject(this, ptr);
      }
    }

    // Constructors
    b8(value) { return new B8(this, this._initB8(value ? 1 : 0)); }
    u8(value) { return new U8(this, this._initU8(value & 0xFF)); }
    c8(value) { return new C8(this, this._initC8(value.charCodeAt(0))); }
    i16(value) { return new I16(this, this._initI16(value | 0)); }
    i32(value) { return new I32(this, this._initI32(value | 0)); }
    i64(value) { return new I64(this, this._initI64(Number(value))); }
    f64(value) { return new F64(this, this._initF64(value)); }

    date(value) {
      let days;
      if (value instanceof Date) {
        const epoch = new Date(2000, 0, 1);
        days = Math.floor((value - epoch) / (1000 * 60 * 60 * 24));
      } else {
        days = value | 0;
      }
      return new RayDate(this, this._initDate(days));
    }

    time(value) {
      let ms;
      if (value instanceof Date) {
        ms = value.getHours() * 3600000 + value.getMinutes() * 60000 +
          value.getSeconds() * 1000 + value.getMilliseconds();
      } else {
        ms = value | 0;
      }
      return new RayTime(this, this._initTime(ms));
    }

    timestamp(value) {
      let ns;
      if (value instanceof Date) {
        const epoch = new Date(2000, 0, 1);
        ns = Number(value - epoch) * 1000000;
      } else {
        ns = Number(value);
      }
      return new RayTimestamp(this, this._initTimestamp(ns));
    }

    symbol(value) { return new RaySymbol(this, this._initSymbolStr(value, value.length)); }
    string(value) { return new RayString(this, this._initStringStr(value, value.length)); }

    vector(type, lengthOrData) {
      if (Array.isArray(lengthOrData)) {
        const arr = lengthOrData;
        const vec = new Vector(this, this._initVector(type, arr.length), type);
        const view = vec.typedArray;
        for (let i = 0; i < arr.length; i++) {
          if (type === Types.I64 || type === Types.TIMESTAMP || type === Types.SYMBOL) {
            view[i] = BigInt(arr[i]);
          } else {
            view[i] = arr[i];
          }
        }
        return vec;
      }
      return new Vector(this, this._initVector(type, lengthOrData), type);
    }

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

    dict(obj) {
      const keys = Object.keys(obj);
      const keyVec = this.vector(Types.SYMBOL, keys.length);
      const keyView = keyVec.typedArray;
      for (let i = 0; i < keys.length; i++) {
        keyView[i] = BigInt(this._internSymbol(keys[i], keys[i].length));
      }
      const valList = this.list(Object.values(obj).map(v => this._toRayObject(v)));
      return new Dict(this, this._initDict(keyVec._ptr, valList._ptr));
    }

    table(columns) {
      const colNames = Object.keys(columns);
      const keyVec = this.vector(Types.SYMBOL, colNames.length);
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

    _arrayToVector(arr) {
      if (arr.length === 0) return this.vector(Types.I64, 0);

      const first = arr[0];
      let type;

      if (typeof first === 'boolean') type = Types.B8;
      else if (typeof first === 'number') type = Number.isInteger(first) ? Types.I64 : Types.F64;
      else if (typeof first === 'bigint') type = Types.I64;
      else if (typeof first === 'string') type = Types.SYMBOL;
      else if (first instanceof Date) type = Types.TIMESTAMP;
      else return this.list(arr.map(v => this._toRayObject(v)));

      const vec = this.vector(type, arr.length);
      const view = vec.typedArray;

      for (let i = 0; i < arr.length; i++) {
        if (type === Types.SYMBOL) {
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

    _toRayObject(value) {
      if (value instanceof RayObject) return value;
      if (value === null || value === undefined) return new RayNull(this, 0);
      if (typeof value === 'boolean') return this.b8(value);
      if (typeof value === 'number') return Number.isInteger(value) ? this.i64(value) : this.f64(value);
      if (typeof value === 'bigint') return this.i64(value);
      if (typeof value === 'string') return this.symbol(value);
      if (value instanceof Date) return this.timestamp(value);
      if (Array.isArray(value)) return this._arrayToVector(value);
      if (typeof value === 'object') return this.dict(value);
      return new RayNull(this, 0);
    }

    set(name, value) {
      const sym = this.symbol(name);
      const val = value instanceof RayObject ? value : this._toRayObject(value);
      this._globalSet(sym._ptr, val._ptr);
    }

    get(name) { return this.eval(name); }
    typeName(typeCode) { return this._getTypeName(typeCode); }

    col(name) { return Expr.col(this, name); }

    read_csv(content) {
      if (typeof content !== 'string') throw new Error('Content must be a string');

      // Manually allocate memory on WASM heap to avoid stack overflow with large CSVs
      const lengthBytes = this._wasm.lengthBytesUTF8(content) + 1;
      const stringOnHeap = this._wasm._malloc(lengthBytes);

      try {
        this._wasm.stringToUTF8(content, stringOnHeap, lengthBytes);
        // Pass pointer and length (excluding null terminator)
        return new Table(this, this._readCSV(stringOnHeap, lengthBytes - 1));
      } finally {
        this._wasm._free(stringOnHeap);
      }
    }
  }

  // ============================================================================
  // Initialization Function
  // ============================================================================

  let _sdkInstance = null;
  let _initPromise = null;

  async function init(options = {}) {
    const { wasmPath = './rayforce.js', singleton = true, onReady = null } = options;

    if (singleton && _sdkInstance !== null) return _sdkInstance;
    if (singleton && _initPromise !== null) return _initPromise;

    const initFn = async () => {
      try {
        // For browser usage, we need to load the WASM module
        let createRayforce;

        if (typeof window !== 'undefined') {
          // Browser environment - expect global createRayforce or load via script
          if (typeof window.createRayforce === 'function') {
            createRayforce = window.createRayforce;
          } else {
            // Try dynamic import
            const module = await import(wasmPath);
            createRayforce = module.default;
          }
        } else {
          // Node.js environment
          const module = await import(wasmPath);
          createRayforce = module.default;
        }

        const wasm = await createRayforce({
          rayforce_ready: (msg) => { if (onReady) onReady(msg); }
        });

        const sdk = new RayforceSDK(wasm);
        if (singleton) _sdkInstance = sdk;
        return sdk;
      } catch (error) {
        if (singleton) _initPromise = null;
        throw new Error(`Failed to initialize RayforceDB: ${error.message}`);
      }
    };

    if (singleton) {
      _initPromise = initFn();
      return _initPromise;
    }
    return initFn();
  }

  function getInstance() { return _sdkInstance; }
  function isInitialized() { return _sdkInstance !== null; }
  function reset() { _sdkInstance = null; _initPromise = null; }

  // ============================================================================
  // Public API
  // ============================================================================

  return {
    init,
    getInstance,
    isInitialized,
    reset,
    Types,
    Expr,
    RayforceSDK,
    RayObject,
    Vector,
    List,
    Dict,
    Table,
    RayString,
    version: '0.1.0',
  };

}));
