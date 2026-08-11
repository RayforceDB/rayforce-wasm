import type {
  Expr,
  RayObject,
  RayforceSDK,
  TypeCode,
  Types,
} from './rayforce.sdk.js';

export * from './rayforce.sdk.js';

export declare const version: '0.2.1';

export interface InitOptions {
  /** URL/path to the Emscripten module loader. Defaults to ./rayforce.js. */
  wasmPath?: string;
  /** Reuse the process-wide SDK instance. Defaults to true. */
  singleton?: boolean;
  /** Called with the engine banner after WASM initialization. */
  onReady?: (message: string) => void;
}

export declare function init(options?: InitOptions): Promise<RayforceSDK>;
export declare function getInstance(): RayforceSDK | null;
export declare function isInitialized(): boolean;
export declare function reset(): void;
export declare function evaluate(code: string): RayObject;

export declare const create: {
  readonly i64: (value: number | bigint) => ReturnType<RayforceSDK['i64']>;
  readonly f64: (value: number) => ReturnType<RayforceSDK['f64']>;
  readonly string: (value: string) => ReturnType<RayforceSDK['string']>;
  readonly symbol: (value: string) => ReturnType<RayforceSDK['symbol']>;
  readonly vector: (type: TypeCode, data: number | any[]) => ReturnType<RayforceSDK['vector']>;
  readonly list: (items?: any[]) => ReturnType<RayforceSDK['list']>;
  readonly dict: (value: Record<string, any>) => ReturnType<RayforceSDK['dict']>;
  readonly table: (columns: Record<string, any[]>) => ReturnType<RayforceSDK['table']>;
  readonly date: (value: number | Date) => ReturnType<RayforceSDK['date']>;
  readonly time: (value: number | Date) => ReturnType<RayforceSDK['time']>;
  readonly timestamp: (value: number | bigint | Date) => ReturnType<RayforceSDK['timestamp']>;
};

declare const rayforce: {
  init: typeof init;
  getInstance: typeof getInstance;
  isInitialized: typeof isInitialized;
  reset: typeof reset;
  evaluate: typeof evaluate;
  create: typeof create;
  Types: typeof Types;
  Expr: typeof Expr;
  version: typeof version;
};

export default rayforce;
