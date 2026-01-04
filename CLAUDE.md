# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

rayforce-wasm provides WebAssembly bindings and a full JavaScript SDK for RayforceDB, a high-performance columnar database. The SDK offers zero-copy TypedArray views over native Rayforce vectors for maximum performance.

## Build Commands

```bash
# Prerequisites: Install Emscripten SDK
# https://emscripten.org/docs/getting_started/downloads.html
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk && ./emsdk install latest && ./emsdk activate latest
source emsdk_env.sh

# Full build from GitHub
make app

# Development build from local ../rayforce sources
make dev

# Build optimized WASM with SDK (ES6 module)
make wasm

# Build standalone version with preloaded examples
make wasm-standalone

# Build debug version with assertions
make wasm-debug

# Start HTTP server for testing
make serve

# Clean build artifacts
make clean

# Clean all including pulled sources
make clean-all
```

## Architecture

### Build System

- **Makefile** - Main build orchestration
  - `pull` - Clones RayforceDB from GitHub to `build/rayforce-c/`
  - `sync` - Copies from local `../rayforce/` for development
  - `wasm` - Compiles to ES6 WASM module + copies SDK files
  - `wasm-standalone` - Includes preloaded example files
  - `wasm-debug` - Debug build with assertions and safe heap

### Directory Structure

```
rayforce-wasm/
├── Makefile              # Build system
├── CLAUDE.md             # This file
├── README.md             # Documentation
├── src/
│   ├── main.c            # WASM entry point with all exports
│   ├── rayforce.sdk.js   # ES6 SDK module
│   ├── rayforce.umd.js   # UMD bundle for CDN
│   └── index.js          # Main entry point
├── build/
│   ├── rayforce-c/       # Cloned RayforceDB repo
│   ├── obj/              # Compiled object files
│   └── librayforce.a     # Static library
├── dist/
│   ├── rayforce.js       # ES6 WASM module loader
│   ├── rayforce.wasm     # WebAssembly binary
│   ├── rayforce.sdk.js   # SDK module
│   ├── rayforce.umd.js   # UMD bundle
│   └── index.js          # Entry point
└── examples/             # Usage examples
```

## SDK Usage

### ES6 Module

```javascript
import { createRayforceSDK, Types } from './dist/rayforce.sdk.js';

// Initialize WASM first
const createRayforce = (await import('./dist/rayforce.js')).default;
const wasm = await createRayforce();

// Create SDK instance
const rf = createRayforceSDK(wasm);

// Evaluate expressions
const result = rf.eval('(+ 1 2 3)');
console.log(result.toJS()); // 6

// Zero-copy vector operations
const vec = rf.vector(Types.I64, [1, 2, 3, 4, 5]);
const view = vec.typedArray; // BigInt64Array - zero copy!
view[0] = 100n; // Mutate in place

// Create tables
const table = rf.table({
  id: [1, 2, 3],
  name: ['Alice', 'Bob', 'Carol'],
  score: [95.5, 87.3, 92.1]
});

console.log(table.toRows());
// [{ id: 1, name: 'Alice', score: 95.5 }, ...]
```

### CDN/Script Tag

```html
<script src="https://cdn.../rayforce.umd.js"></script>
<script>
  Rayforce.init({ wasmPath: './rayforce.js' }).then(rf => {
    const result = rf.eval('(sum (til 100))');
    console.log(result.toJS()); // 4950
  });
</script>
```

## Type System

### Type Codes (matching Python bindings)

| Type | Code | TypedArray | Description |
|------|------|------------|-------------|
| LIST | 0 | - | Mixed-type container |
| B8 | 1 | Int8Array | Boolean |
| U8 | 2 | Uint8Array | Unsigned byte |
| I16 | 3 | Int16Array | 16-bit integer |
| I32 | 4 | Int32Array | 32-bit integer |
| I64 | 5 | BigInt64Array | 64-bit integer |
| SYMBOL | 6 | BigInt64Array | Interned string |
| DATE | 7 | Int32Array | Days since 2000-01-01 |
| TIME | 8 | Int32Array | Milliseconds since midnight |
| TIMESTAMP | 9 | BigInt64Array | Nanoseconds since 2000-01-01 |
| F64 | 10 | Float64Array | 64-bit float |
| GUID | 11 | - | 128-bit UUID |
| C8 | 12 | Uint8Array | Character/String |
| TABLE | 98 | - | Table |
| DICT | 99 | - | Dictionary |

### Atoms vs Vectors

- **Atoms (scalars)**: Have negative type codes (e.g., -5 for I64 scalar)
- **Vectors**: Have positive type codes (e.g., 5 for I64 vector)

## Exported WASM Functions

### Core
- `eval_cmd(code, sourceName)` - Evaluate with source tracking
- `eval_str(code)` - Simple evaluation
- `strof_obj(ptr)` - Format object to string
- `drop_obj(ptr)` - Free object memory
- `clone_obj(ptr)` - Clone object

### Type Introspection
- `get_obj_type(ptr)` - Get type code
- `get_obj_len(ptr)` - Get length
- `is_obj_atom(ptr)` - Check if scalar
- `is_obj_vector(ptr)` - Check if vector
- `is_obj_null(ptr)` - Check if null
- `is_obj_error(ptr)` - Check if error

### Memory Access (Zero-Copy)
- `get_data_ptr(ptr)` - Get pointer to data array
- `get_element_size(type)` - Get byte size of element
- `get_data_byte_size(ptr)` - Get total data size

### Constructors
- `init_b8`, `init_u8`, `init_c8`, `init_i16`, `init_i32`, `init_i64`, `init_f64`
- `init_date`, `init_time`, `init_timestamp`
- `init_symbol_str`, `init_string_str`
- `init_vector`, `init_list`, `init_dict`, `init_table`

### Readers
- `read_b8`, `read_u8`, `read_c8`, `read_i16`, `read_i32`, `read_i64`, `read_f64`
- `read_date`, `read_time`, `read_timestamp`
- `read_symbol_id`, `symbol_to_str`

### Vector Operations
- `vec_at_idx`, `vec_set_idx`, `vec_push`, `vec_insert`, `vec_resize`
- `fill_i64_vec`, `fill_i32_vec`, `fill_f64_vec`

### Container Operations
- `dict_keys`, `dict_vals`, `dict_get`
- `table_keys`, `table_vals`, `table_col`, `table_row`, `table_count`

### Query Operations
- `query_select`, `query_update`
- `table_insert`, `table_upsert`

## Build Flags

### Release Build
- `-O3` - Full optimization
- `-msimd128` - WASM SIMD support
- `-fassociative-math` - Math optimizations
- `-ftree-vectorize` - Auto-vectorization
- `-DSYS_MALLOC` - Use system malloc (required for WASM)

### Debug Build
- `-g` - Debug symbols
- `-O0` - No optimization
- `-DDEBUG` - Debug mode
- `ASSERTIONS=2` - Runtime assertions
- `SAFE_HEAP=1` - Heap safety checks
- `STACK_OVERFLOW_CHECK=2` - Stack checks

## Development Workflow

1. Make changes in `../rayforce/` (main RayforceDB repo)
2. Run `make dev` to sync and build
3. Test with `make serve` and open browser to examples/
4. For production: `make app` builds from fresh GitHub clone

## Platform Notes

- Requires Emscripten SDK (emsdk) in PATH
- `emcc` and `emar` must be available
- Built WASM requires CORS headers for cross-origin usage
- Use `make serve` for local testing (handles CORS)
