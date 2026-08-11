# RayforceDB WASM SDK

Full-featured JavaScript SDK for [RayforceDB](https://rayforcedb.com) with zero-copy ArrayBuffer views over native vectors.

## Features

- 🚀 **Zero-Copy Data Access** - TypedArray views directly over WASM memory
- 📊 **Full Type System** - All Rayforce types: scalars, vectors, lists, dicts, tables
- 🔍 **Query Builder** - Fluent API for building and executing queries
- 💾 **Memory Efficient** - No data copying for vector operations
- 🌐 **CDN Ready** - Browser-native ES modules
- ⚡ **SIMD Optimized** - Native WASM SIMD support

## Quick Start

### ES6 Module

```javascript
import { init, Types } from 'rayforce-wasm';

const rf = await init();

// Evaluate expressions
const result = rf.eval('(+ (+ 1 2) 3)');
console.log(result.toJS()); // 6

// Create vectors with zero-copy access
const vec = rf.vector(Types.I64, [1, 2, 3, 4, 5]);
const view = vec.typedArray; // BigInt64Array - no copy!
view[0] = 100n;
console.log(vec.toJS()); // [100, 2, 3, 4, 5]
```

### CDN / Script Tag

```html
<script type="module">
  import { init } from 'https://cdn.jsdelivr.net/npm/rayforce-wasm@0.2.0/dist/index.js';

  const rf = await init();
  console.log(rf.eval('(sum (til 100))').toJS()); // 4950
</script>
```

## Installation

```bash
npm install rayforce-wasm

# Build from source
make wasm
```

## API Reference

### Initialization

```javascript
// npm / ES modules
import { init, Types } from 'rayforce-wasm';
const rf = await init();

// Low-level SDK wrapper (for an already initialized WASM module)
import { createRayforceSDK } from 'rayforce-wasm/sdk';
const lowLevelRF = createRayforceSDK(wasmModule);
```

### Evaluation

```javascript
// Evaluate Rayfall expression
const result = rf.eval('(+ (+ 1 2) 3)');
console.log(result.toJS()); // 6

// With source tracking (for better error messages)
const result = rf.eval('(sum data)', 'myfile.ray');
```

### Type Constructors

```javascript
// Scalars
rf.b8(true)                    // Boolean
rf.i64(42)                     // 64-bit integer
rf.f64(3.14)                   // 64-bit float
rf.symbol('name')              // Interned symbol
rf.string('hello')             // String
rf.date(new Date())            // Date
rf.time(new Date())            // Time
rf.timestamp(new Date())       // Timestamp

// Vectors (with zero-copy TypedArray access)
rf.vector(Types.I64, [1, 2, 3])
rf.vector(Types.F64, 1000000)  // Pre-allocate

// Containers
rf.list([1, 'two', 3.0])       // Mixed-type list
rf.dict({ a: 1, b: 2 })        // Dictionary
rf.table({                     // Table
  id: [1, 2, 3],
  name: ['Alice', 'Bob', 'Carol'],
  score: [95.5, 87.3, 92.1]
})
```

### Zero-Copy Vector Access

```javascript
// Create vector
const vec = rf.vector(Types.F64, 1000000);

// Get TypedArray view (zero-copy!)
const view = vec.typedArray; // Float64Array

// Fast iteration
for (let i = 0; i < view.length; i++) {
  view[i] = Math.random();
}

// Convert to JS array (copies data)
const jsArray = vec.toJS();
```

### Tables

```javascript
// Create table
const table = rf.table({
  id: [1, 2, 3],
  name: ['Alice', 'Bob', 'Carol'],
  score: [95.5, 87.3, 92.1]
});

// Access columns
const names = table.col('name');        // Vector
const scores = table.col('score');      // Vector

// Access rows
const row = table.row(0);               // Dict
console.log(row.toJS());                // { id: 1, name: 'Alice', score: 95.5 }

// Convert to arrays
console.log(table.toJS());              // { id: [...], name: [...], score: [...] }
console.log(table.toRows());            // [{ id: 1, ... }, { id: 2, ... }, ...]

// Metadata
console.log(table.columnNames());       // ['id', 'name', 'score']
console.log(table.rowCount);            // 3
```

### Query Builder

```javascript
// Select with filter
const result = table
  .select('name', 'score')
  .where(rf.col('score').gt(90))
  .execute();

// Aggregations
const stats = table
  .select('department')
  .withColumn('avg_score', rf.col('score').avg())
  .withColumn('max_score', rf.col('score').max())
  .groupBy('department')
  .execute();

// Using expressions
const expr = rf.col('score').gt(80).and(rf.col('active').eq(true));
const filtered = table.where(expr).execute();
```

### Type Constants

```javascript
import { Types } from 'rayforce-wasm';

Types.LIST       // 0  - Mixed-type list
Types.B8         // 1  - Boolean
Types.U8         // 2  - Unsigned byte
Types.I16        // 3  - 16-bit integer
Types.I32        // 4  - 32-bit integer
Types.I64        // 5  - 64-bit integer
Types.F32        // 6  - 32-bit float
Types.F64        // 7  - 64-bit float
Types.DATE       // 8  - Date (days since 2000-01-01)
Types.TIME       // 9  - Time (ms since midnight)
Types.TIMESTAMP  // 10 - Timestamp (ns since 2000-01-01)
Types.GUID       // 11 - 128-bit UUID
Types.SYM        // 12 - Interned dictionary-encoded string column
Types.STR        // 13 - Variable-length string (atom or column)
Types.TABLE      // 98 - Table
Types.DICT       // 99 - Dictionary
Types.LAMBDA     // 100 - Function
Types.NULL       // 126 - Null
Types.ERR        // 127 - Error
// Deprecated: Types.SYMBOL and Types.C8 alias Types.SYM (both = 12).
```

### Expression Builder

```javascript
// Column reference
const col = rf.col('price');

// Comparisons
col.eq(100)      // =
col.ne(100)      // <>
col.lt(100)      // <
col.le(100)      // <=
col.gt(100)      // >
col.ge(100)      // >=

// Logical
col.gt(50).and(col.lt(100))
col.eq(0).or(col.eq(100))
col.gt(0).not()

// Aggregations
col.sum()
col.avg()
col.min()
col.max()
col.count()
col.first()
col.last()
col.distinct()
```

## Build from Source

### Prerequisites

- [Emscripten SDK 6.0.6](https://emscripten.org/docs/getting_started/downloads.html)
- Make

### Build

```bash
# Clone repository
git clone https://github.com/RayforceDB/rayforce-wasm.git
cd rayforce-wasm

# Install Emscripten (if not already installed)
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk && ./emsdk install 6.0.6 && ./emsdk activate 6.0.6
source emsdk_env.sh
cd ..

# Build from GitHub sources
make app

# Or build from local ../rayforce sources
make dev

# Start dev server
make serve
# Open http://localhost:8080/examples/
```

### Build Outputs

```
dist/
├── rayforce.js       # WASM loader (ES6)
├── rayforce.wasm     # WASM binary
├── rayforce.sdk.js   # SDK module (ES6)
├── rayforce.umd.js   # Legacy-named browser ESM bootstrap
├── index.js          # Entry point
├── index.d.ts        # Entry-point TypeScript definitions
└── rayforce.sdk.d.ts # SDK TypeScript definitions
```

## Performance

The SDK provides zero-copy access to WASM memory through TypedArray views:

```javascript
// Create 1M element vector - ~8ms
const vec = rf.vector(Types.F64, 1000000);

// Get TypedArray view - ~0.01ms (just creates view)
const view = vec.typedArray;

// Fill via TypedArray - ~15ms
for (let i = 0; i < view.length; i++) {
  view[i] = Math.random();
}

// Native sum - ~2ms
const sum = rf.eval(`(sum ${vec.toString()})`);
```

## Browser Support

- Chrome 89+ (WASM SIMD)
- Firefox 89+ (WASM SIMD)
- Safari 15+ (WASM SIMD)
- Edge 89+ (WASM SIMD)

## License

MIT License - see [LICENSE](LICENSE)

## Links

- [RayforceDB](https://rayforcedb.com)
- [Documentation](https://rayforcedb.com/docs/)
- [GitHub](https://github.com/RayforceDB/rayforce)
