# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

rayforce-wasm provides WebAssembly bindings for RayforceDB, a high-performance database. It compiles the native RayforceDB C runtime to WebAssembly using Emscripten, enabling RayforceDB to run in web browsers and Node.js environments.

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

# Build optimized WASM (ES6 module)
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
  - `wasm` - Compiles to ES6 WASM module
  - `wasm-standalone` - Includes preloaded example files
  - `wasm-debug` - Debug build with assertions and safe heap

### Directory Structure

```
rayforce-wasm/
├── Makefile              # Build system
├── CLAUDE.md             # This file
├── README.md             # Documentation
├── src/
│   └── rayforce/         # Copied C sources from RayforceDB
├── build/
│   ├── rayforce-c/       # Cloned RayforceDB repo
│   ├── obj/              # Compiled object files
│   └── librayforce.a     # Static library
├── dist/
│   ├── rayforce.js       # ES6 WASM module loader
│   ├── rayforce.wasm     # WebAssembly binary
│   └── rayforce-debug.js # Debug version
└── examples/             # Usage examples
```

### Exported Functions

The WASM module exports these C functions for JavaScript:

- `_main` - Entry point
- `_version` - Get version string
- `_null` - Create null object
- `_drop_obj` - Free object memory
- `_clone_obj` - Clone an object
- `_eval_str` - Evaluate a RayforceDB expression
- `_obj_fmt` - Format object to string
- `_strof_obj` - Convert object to string representation

### JavaScript Interface

The module is built with:
- `MODULARIZE=1` - Factory function pattern
- `EXPORT_ES6=1` - ES6 module syntax
- `EXPORT_NAME="createRayforce"` - Factory function name
- `ALLOW_MEMORY_GROWTH=1` - Dynamic memory allocation

Usage:
```javascript
import createRayforce from './rayforce.js';

const rayforce = await createRayforce();

// Use ccall/cwrap for function calls
const result = rayforce.ccall('eval_str', 'number', ['string'], ['1+2+3']);
const formatted = rayforce.ccall('obj_fmt', 'string', ['number'], [result]);
console.log(formatted); // 6

// Clean up
rayforce.ccall('drop_obj', null, ['number'], [result]);
```

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
3. Test with `make serve` and open browser
4. For production: `make app` builds from fresh GitHub clone

## Platform Notes

- Requires Emscripten SDK (emsdk) in PATH
- `emcc` and `emar` must be available
- Built WASM requires CORS headers for cross-origin usage
- Use `make serve` for local testing (handles CORS)

