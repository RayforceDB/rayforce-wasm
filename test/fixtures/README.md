# Native core compatibility fixtures

Generated from unmodified released core v3.0.2, commit
`d5a44cdb4ec33772104f466a2ca177a74b528041`, on little-endian x86_64.
Verify that SHA before regenerating; build `make lib CC=clang` there.

Compile `generate-core-frames.c` with that checkout's `include` and `src`
include paths, linking `librayforce.a -lm -lpthread`. Run with
`RAYFORCE_CORES=0`; stdout is `core-v3.0.2-wire.json`. These are actual
native wire-v3 bytes, including typed NULLs and exact large durations,
not relabelled v4 frames.

Compile `generate-native-index.c` the same way and run in an empty writable
directory. It writes `native-index-table/{.d,v}` and a transient write lock.
Base64-encode `.d` and `v` into the `files` object of
`native-v3.0.2-index.json`, excluding the lock. This native-layout HASH
accelerator is deliberately ignored by wasm32 while its column values
remain readable. Tests separately save/reload a wasm32 index with its
own generation.

Tiny synthetic fixtures, no customer data. Not general cross-version or
filesystem-format certification.
