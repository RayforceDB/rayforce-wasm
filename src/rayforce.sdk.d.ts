/**
 * RayforceDB JavaScript SDK Type Definitions
 * @module rayforce
 */

// ============================================================================
// Type Constants
// ============================================================================

export declare const Types: {
  readonly LIST: 0;
  readonly B8: 1;
  readonly U8: 2;
  readonly I16: 3;
  readonly I32: 4;
  readonly I64: 5;
  readonly F32: 6;
  readonly F64: 7;
  readonly DATE: 8;
  readonly TIME: 9;
  readonly TIMESTAMP: 10;
  readonly GUID: 11;
  readonly SYM: 12;
  readonly STR: 13;
  readonly TABLE: 98;
  readonly DICT: 99;
  readonly LAMBDA: 100;
  readonly NULL: 126;
  readonly ERR: 127;
  /** Deprecated alias for SYM (was the v1 SYMBOL slot at 6). */
  readonly SYMBOL: 12;
  /** Deprecated alias for SYM (was the v1 C8 char vector slot at 12). */
  readonly C8: 12;
};

export type TypeCode = typeof Types[keyof typeof Types];

// ============================================================================
// Base Classes
// ============================================================================

/**
 * Base class for all Rayforce objects
 */
export declare class RayObject {
  /** Raw WASM pointer */
  readonly ptr: number;
  
  /** Type code (negative for atoms, positive for vectors) */
  readonly type: number;
  
  /** Absolute type code */
  readonly absType: number;
  
  /** True if this is an atom (scalar) */
  readonly isAtom: boolean;
  
  /** True if this is a vector */
  readonly isVector: boolean;
  
  /** True if this is null */
  readonly isNull: boolean;
  
  /** True if this is an error */
  readonly isError: boolean;
  
  /** Length (1 for atoms) */
  readonly length: number;
  
  /** Reference count */
  readonly refCount: number;
  
  /** Clone this object */
  clone(): RayObject;
  
  /** Format to string */
  toString(): string;
  
  /** Convert to JavaScript value */
  toJS(): any;
  
  /** Free this object's memory */
  drop(): void;
  
  /** Release ownership (don't drop on GC) */
  release(): number;
}

// ============================================================================
// Scalar Types
// ============================================================================

export declare class B8 extends RayObject {
  readonly value: boolean;
  toJS(): boolean;
}

export declare class U8 extends RayObject {
  readonly value: number;
  toJS(): number;
}

export declare class I16 extends RayObject {
  readonly value: number;
  toJS(): number;
}

export declare class I32 extends RayObject {
  readonly value: number;
  toJS(): number;
}

export declare class I64 extends RayObject {
  readonly value: number;
  toJS(): number;
}

export declare class F32 extends RayObject {
  readonly value: number;
  toJS(): number;
}

export declare class F64 extends RayObject {
  readonly value: number;
  toJS(): number;
}

export declare class RayDate extends RayObject {
  /** Days since 2000-01-01 */
  readonly value: number;
  toJS(): Date;
}

export declare class RayTime extends RayObject {
  /** Milliseconds since midnight */
  readonly value: number;
  toJS(): { hours: number; minutes: number; seconds: number; milliseconds: number };
}

export declare class RayTimestamp extends RayObject {
  /** Nanoseconds since 2000-01-01 */
  readonly value: number;
  toJS(): Date;
}

export declare class Sym extends RayObject {
  /** Interned symbol ID */
  readonly id: number;
  /** String value (reverse-looked up from the intern table) */
  readonly value: string;
  toJS(): string;
}

/** Deprecated: prefer `Sym`. Kept for one release for binary-compat. */
export { Sym as Symbol };

export declare class GUID extends RayObject {
  toJS(): string;
}

export declare class RayNull extends RayObject {
  toJS(): null;
}

export declare class RayError extends RayObject {
  /** Inline 7-byte error code (e.g. "type", "domain", "user", "oom"). */
  readonly code: string;
  /** Per-VM error message text — captured eagerly from a stable buffer. */
  readonly message: string;
  toJS(): never;
}

// ============================================================================
// Container Types
// ============================================================================

/**
 * Vector with zero-copy TypedArray access
 */
export declare class Vector<T extends TypedArray = TypedArray> extends RayObject {
  /** Element type code */
  readonly elementType: number;
  
  /**
   * Zero-copy TypedArray view over the vector data.
   * WARNING: This view is only valid while the Vector exists.
   */
  readonly typedArray: T;
  
  /** Get element at index */
  at(idx: number): T extends BigInt64Array ? bigint : number;
  
  /** Set element at index */
  set(idx: number, value: T extends BigInt64Array ? bigint : number): void;
  
  /** Convert to JS array (copies data) */
  toJS(): Array<T extends BigInt64Array ? number | bigint : number>;
  
  [Symbol.iterator](): Iterator<T extends BigInt64Array ? bigint : number>;
}

/**
 * String atom (RAY_STR).  v2 unifies strings as atoms with SSO inline
 * storage for ≤7 bytes and an extension block for longer strings.
 */
export declare class RayString extends RayObject {
  readonly value: string;
  toJS(): string;
}

/**
 * String column (RAY_STR vector).  Per-cell reads via str_vec_get; not
 * typed-array-viewable.
 */
export declare class StrVector extends RayObject {
  at(idx: number): string;
  toJS(): string[];
  [Symbol.iterator](): Iterator<string>;
}

/**
 * List (mixed-type container)
 */
export declare class List extends RayObject {
  /** Get element at index */
  at(idx: number): RayObject;
  
  /** Set element at index */
  set(idx: number, value: RayObject | any): void;
  
  /** Push element to end */
  push(value: RayObject | any): void;
  
  /** Convert to JS array */
  toJS(): any[];
  
  [Symbol.iterator](): Iterator<RayObject>;
}

/**
 * Dict (key-value mapping)
 */
export declare class Dict extends RayObject {
  /** Get keys as symbol vector */
  keys(): Vector<BigInt64Array>;
  
  /** Get values as list */
  values(): List;
  
  /** Get value by key */
  get(key: string | Symbol): RayObject;
  
  /** Check if key exists */
  has(key: string): boolean;
  
  /** Convert to JS object */
  toJS(): Record<string, any>;
  
  [Symbol.iterator](): Iterator<[string, RayObject]>;
}

/**
 * Table
 */
export declare class Table extends RayObject {
  /** Get column names vector */
  columns(): Vector<BigInt64Array>;
  
  /** Get column names as string array */
  columnNames(): string[];
  
  /** Get all values as list of vectors */
  values(): List;
  
  /** Get column by name */
  col(name: string): Vector;
  
  /** Get row by index */
  row(idx: number): Dict;
  
  /** Row count */
  readonly rowCount: number;
  
  /** Create select query */
  select(...cols: string[]): SelectQuery;
  
  /** Create where clause */
  where(condition: Expr): SelectQuery;
  
  /** Insert data */
  insert(data: Record<string, any> | any[]): Table;
  
  /** Convert to column object */
  toJS(): Record<string, any[]>;
  
  /** Convert to array of row objects */
  toRows(): Record<string, any>[];
}

/**
 * Lambda (function)
 */
export declare class Lambda extends RayObject {
  /** Call the lambda with arguments */
  call(...args: any[]): RayObject;
}

// ============================================================================
// Expression Builder
// ============================================================================

/**
 * Expression builder for query conditions
 */
export declare class Expr {
  /** Create a column reference */
  static col(sdk: RayforceSDK, name: string): Expr;
  
  // Comparisons
  eq(value: any): Expr;
  ne(value: any): Expr;
  lt(value: any): Expr;
  le(value: any): Expr;
  gt(value: any): Expr;
  ge(value: any): Expr;
  
  // Logical
  and(other: Expr): Expr;
  or(other: Expr): Expr;
  not(): Expr;
  
  // Aggregations
  sum(): Expr;
  avg(): Expr;
  min(): Expr;
  max(): Expr;
  count(): Expr;
  first(): Expr;
  last(): Expr;
  distinct(): Expr;
  
  toString(): string;
}

/**
 * SELECT query builder
 */
export declare class SelectQuery {
  /** Specify columns to select */
  select(...cols: string[]): SelectQuery;
  
  /** Add computed column */
  withColumn(name: string, expr: Expr): SelectQuery;
  
  /** Add WHERE condition */
  where(condition: Expr): SelectQuery;
  
  /** Add GROUP BY columns */
  groupBy(...cols: string[]): SelectQuery;
  
  /** Column reference helper */
  col(name: string): Expr;
  
  /** Execute the query */
  execute(): Table;
}

// ============================================================================
// SDK Class
// ============================================================================

type TypedArray =
  | Int8Array
  | Uint8Array
  | Int16Array
  | Int32Array
  | BigInt64Array
  | Float32Array
  | Float64Array;

/**
 * Main RayforceDB SDK class
 */
export declare class RayforceSDK {
  constructor(wasmModule: any);
  
  /** RayforceDB version string */
  readonly version: string;
  
  // ==========================================================================
  // Core Methods
  // ==========================================================================
  
  /**
   * Evaluate a Rayfall expression
   * @param code - The expression to evaluate
   * @param sourceName - Optional source name for error tracking
   */
  eval(code: string, sourceName?: string): RayObject;
  
  /**
   * Format any RayObject to string
   */
  format(obj: RayObject | number): string;
  
  // ==========================================================================
  // Constructors
  // ==========================================================================
  
  /** Create a boolean value */
  b8(value: boolean): B8;
  
  /** Create an unsigned byte value */
  u8(value: number): U8;

  /** Create a 16-bit integer */
  i16(value: number): I16;

  /** Create a 32-bit integer */
  i32(value: number): I32;

  /** Create a 64-bit integer */
  i64(value: number | bigint): I64;

  /** Create a 32-bit float */
  f32(value: number): F32;

  /** Create a 64-bit float */
  f64(value: number): F64;
  
  /** Create a date */
  date(value: number | Date): RayDate;
  
  /** Create a time */
  time(value: number | Date): RayTime;
  
  /** Create a timestamp */
  timestamp(value: number | bigint | Date): RayTimestamp;
  
  /** Create a symbol (interned string) */
  symbol(value: string): Sym;
  
  /** Create a string */
  string(value: string): RayString;
  
  /**
   * Create a vector of specified type
   * @param type - Type code from Types
   * @param lengthOrData - Length or array of values
   */
  vector<T extends TypeCode>(type: T, lengthOrData: number | any[]): Vector;
  
  /**
   * Create a list (mixed-type container)
   * @param items - Optional array of items
   */
  list(items?: any[]): List;
  
  /**
   * Create a dict (key-value mapping)
   * @param obj - JS object to convert
   */
  dict(obj: Record<string, any>): Dict;
  
  /**
   * Create a table from column definitions
   * @param columns - Object with column names as keys and arrays as values
   */
  table(columns: Record<string, any[]>): Table;

  /**
   * Load a CSV from a buffer.  Writes to Emscripten MEMFS, calls the
   * file-based ray_read_csv, then unlinks.
   */
  readCSV(buffer: Uint8Array | ArrayBuffer, name?: string): Table | RayError;

  // ==========================================================================
  // Utility Methods
  // ==========================================================================
  
  /**
   * Set a global variable
   */
  set(name: string, value: RayObject | any): void;
  
  /**
   * Get a global variable
   */
  get(name: string): RayObject;
  
  /**
   * Get type name string
   */
  typeName(typeCode: number): string;
  
  /**
   * Create column expression
   */
  col(name: string): Expr;
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Creates a new RayforceDB SDK instance
 * @param wasmModule - The initialized Emscripten WASM module
 */
export declare function createRayforceSDK(wasmModule: any): RayforceSDK;

// ============================================================================
// Default Export
// ============================================================================

declare const _default: {
  createRayforceSDK: typeof createRayforceSDK;
  Types: typeof Types;
  Expr: typeof Expr;
};

export default _default;
