# rayforce-wasm

WebAssembly bindings for [RayforceDB](https://github.com/RayforceDB/rayforce) — a high-performance vector database.

Run RayforceDB directly in your browser or Node.js environment.

## Features

- 🚀 **Full RayforceDB runtime** compiled to WebAssembly
- 🌐 **Browser & Node.js** compatible ES6 module
- ⚡ **SIMD optimized** for maximum performance
- 📦 **Zero dependencies** — single WASM binary
- 🔧 **Easy integration** with modern JavaScript frameworks

## Quick Start

### Prerequisites

Install the [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html):

```bash
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source emsdk_env.sh
```

### Build

```bash
# Clone this repository
git clone https://github.com/RayforceDB/rayforce-wasm.git
cd rayforce-wasm

# Full build from GitHub sources
make app

# Or use the build script
./scripts/prepare_build.sh full
```

### Development Build

If you have RayforceDB sources locally at `../rayforce`:

```bash
make dev
```

## Usage

### Browser (ES6 Module)

```html
<script type="module">
import createRayforce from './dist/rayforce.js';

async function main() {
    const rayforce = await createRayforce();
    
    // Evaluate an expression
    const result = rayforce.ccall('eval_str', 'number', ['string'], ['1+2+3']);
    
    // Format the result
    const formatted = rayforce.ccall('obj_fmt', 'string', ['number'], [result]);
    console.log(formatted); // 6
    
    // Clean up
    rayforce.ccall('drop_obj', null, ['number'], [result]);
}

main();
</script>
```

### Node.js

```javascript
import createRayforce from './dist/rayforce.js';

const rayforce = await createRayforce();

// Create a table
const tableExpr = `
    ([] 
        sym: \`AAPL\`GOOG\`MSFT; 
        price: 150.0 2800.0 300.0; 
        qty: 100 50 200
    )
`;

const table = rayforce.ccall('eval_str', 'number', ['string'], [tableExpr]);
const output = rayforce.ccall('obj_fmt', 'string', ['number'], [table]);
console.log(output);

rayforce.ccall('drop_obj', null, ['number'], [table]);
```

### Using cwrap for Convenience

```javascript
const rayforce = await createRayforce();

// Wrap functions for easier use
const evalStr = rayforce.cwrap('eval_str', 'number', ['string']);
const objFmt = rayforce.cwrap('obj_fmt', 'string', ['number']);
const dropObj = rayforce.cwrap('drop_obj', null, ['number']);

const result = evalStr('til 10');
console.log(objFmt(result)); // 0 1 2 3 4 5 6 7 8 9
dropObj(result);
```

## Build Targets

| Command | Description |
|---------|-------------|
| `make app` | Full build from GitHub (pull + compile) |
| `make dev` | Development build from local `../rayforce` |
| `make wasm` | Build optimized ES6 WASM module |
| `make wasm-standalone` | Build with preloaded example files |
| `make wasm-debug` | Debug build with assertions |
| `make serve` | Start local HTTP server for testing |
| `make clean` | Remove build artifacts |
| `make clean-all` | Remove all generated files |
| `make help` | Show all available commands |

## Output Files

After building, you'll find these files in `dist/`:

| File | Description |
|------|-------------|
| `rayforce.js` | ES6 module loader |
| `rayforce.wasm` | WebAssembly binary |
| `rayforce-debug.js` | Debug version (if built) |
| `rayforce-debug.wasm` | Debug WASM binary |

## Exported Functions

| Function | Description |
|----------|-------------|
| `_version()` | Get RayforceDB version string |
| `_null()` | Create a null object |
| `_eval_str(expr)` | Evaluate a RayforceDB expression |
| `_obj_fmt(obj)` | Format object to string |
| `_strof_obj(obj)` | Convert object to string representation |
| `_clone_obj(obj)` | Clone an object |
| `_drop_obj(obj)` | Free object memory |

## Project Structure

```
rayforce-wasm/
├── Makefile              # Build system
├── CLAUDE.md             # AI assistant guidance
├── README.md             # This file
├── scripts/
│   └── prepare_build.sh  # Build preparation script
├── src/
│   └── rayforce/         # C sources (copied during build)
├── build/
│   ├── rayforce-c/       # Cloned RayforceDB repo
│   ├── obj/              # Compiled objects
│   └── librayforce.a     # Static library
├── dist/                 # Build output
│   ├── rayforce.js
│   └── rayforce.wasm
└── examples/             # Usage examples
```

## Performance Notes

- Built with `-O3` and `-msimd128` for SIMD acceleration
- Uses `ALLOW_MEMORY_GROWTH` for dynamic memory allocation
- Debug builds include assertions and heap safety checks

## Requirements

- [Emscripten SDK](https://emscripten.org/) (emcc, emar)
- GNU Make
- Git (for pulling sources)

## License

Apache-2.0 License — see [LICENSE](LICENSE)

## Links

- [RayforceDB](https://github.com/RayforceDB/rayforce) — Main database repository
- [rayforce-py](https://github.com/RayforceDB/rayforce-py) — Python bindings
- [Emscripten](https://emscripten.org/) — WASM compiler toolchain
