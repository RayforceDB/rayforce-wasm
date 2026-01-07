# RayforceDB WASM Build System
# Compiles RayforceDB to WebAssembly using Emscripten
#
# This is the definitive Makefile for WASM builds.
# All WASM-specific build configuration is managed here.

# ============================================================================
# Project Structure
# ============================================================================

RAYFORCE_GITHUB = https://github.com/RayforceDB/rayforce.git
EXEC_DIR = $(shell pwd)
BUILD_DIR = $(EXEC_DIR)/build
DIST_DIR = $(EXEC_DIR)/dist
SRC_DIR = $(EXEC_DIR)/src
OBJ_DIR = $(BUILD_DIR)/obj

# Rayforce source location: use RAYFORCE_SRC_DIR env var or default to ../rayforce
RAYFORCE_SRC_DIR ?= ../rayforce
RAYFORCE_SRC = $(RAYFORCE_SRC_DIR)/core

# ============================================================================
# Emscripten Toolchain
# ============================================================================

CC = emcc
AR = emar
STD = c17

# Git hash for version info
GIT_HASH := $(shell git rev-parse HEAD 2>/dev/null || echo "unknown")

# ============================================================================
# WASM Compilation Flags
# ============================================================================

# Release optimization flags (matching original rayforce wasm target)
# -fPIC              : Position independent code
# -Wall              : All warnings
# -std=c17           : C17 standard
# -O3                : Maximum optimization
# -msimd128          : Enable SIMD instructions (WASM SIMD)
# -fassociative-math : Allow reassociation of FP operations
# -ftree-vectorize   : Enable auto-vectorization
# -fno-math-errno    : Don't set errno for math functions
# -funsafe-math-optimizations : Aggressive FP optimizations
# -ffinite-math-only : Assume no NaN/Inf
# -funroll-loops     : Unroll loops for performance
# -DSYS_MALLOC       : Use system malloc (required for WASM)

WASM_CFLAGS = -fPIC -Wall -std=$(STD) -O3 -msimd128 \
	-fassociative-math -ftree-vectorize -fno-math-errno \
	-funsafe-math-optimizations -ffinite-math-only -funroll-loops \
	-DSYS_MALLOC -DGIT_HASH=\"$(GIT_HASH)\"

# Debug flags for development
# -g                 : Debug symbols
# -O0                : No optimization (for debugging)
# -DDEBUG            : Enable debug assertions
# -DSYS_MALLOC       : Use system malloc

DEBUG_CFLAGS = -fPIC -Wall -std=$(STD) -g -O0 -DDEBUG -DSYS_MALLOC \
	-DGIT_HASH=\"$(GIT_HASH)\"

# ============================================================================
# Emscripten Linker Flags
# ============================================================================

# ALLOW_MEMORY_GROWTH : Allow dynamic memory allocation
# MODULARIZE          : Export as ES6 module factory
# EXPORT_ES6          : Use ES6 module syntax
# EXPORT_NAME         : Name of the factory function

WASM_LDFLAGS = \
	-s ALLOW_MEMORY_GROWTH=1 \
	-s MODULARIZE=1 \
	-s EXPORT_ES6=1 \
	-s EXPORT_NAME="createRayforce" \
	-s ENVIRONMENT='web,node'

# Debug linker flags
# ASSERTIONS          : Runtime assertions
# SAFE_HEAP           : Heap bounds checking
# STACK_OVERFLOW_CHECK: Stack overflow detection

DEBUG_LDFLAGS = \
	-s ALLOW_MEMORY_GROWTH=1 \
	-s MODULARIZE=1 \
	-s EXPORT_ES6=1 \
	-s EXPORT_NAME="createRayforce" \
	-s ASSERTIONS=2 \
	-s SAFE_HEAP=1 \
	-s STACK_OVERFLOW_CHECK=2

# ============================================================================
# Exported Functions & Runtime Methods
# ============================================================================

# Functions exported to JavaScript
# Core functions for full SDK support
EXPORTED_FUNCTIONS = [ \
	'_main', \
	'_malloc', \
	'_free', \
	'_version_str', \
	'_null', \
	'_drop_obj', \
	'_clone_obj', \
	'_eval_str', \
	'_eval_cmd', \
	'_get_cmd_counter', \
	'_reset_cmd_counter', \
	'_obj_fmt', \
	'_strof_obj', \
	'_TYPE_CODE_LIST', \
	'_TYPE_CODE_B8', \
	'_TYPE_CODE_U8', \
	'_TYPE_CODE_I16', \
	'_TYPE_CODE_I32', \
	'_TYPE_CODE_I64', \
	'_TYPE_CODE_SYMBOL', \
	'_TYPE_CODE_DATE', \
	'_TYPE_CODE_TIME', \
	'_TYPE_CODE_TIMESTAMP', \
	'_TYPE_CODE_F64', \
	'_TYPE_CODE_GUID', \
	'_TYPE_CODE_C8', \
	'_TYPE_CODE_TABLE', \
	'_TYPE_CODE_DICT', \
	'_TYPE_CODE_LAMBDA', \
	'_TYPE_CODE_NULL', \
	'_TYPE_CODE_ERR', \
	'_get_obj_type', \
	'_get_obj_len', \
	'_is_obj_atom', \
	'_is_obj_vector', \
	'_is_obj_null', \
	'_is_obj_error', \
	'_get_error_info', \
	'_get_error_message', \
	'_get_obj_rc', \
	'_get_data_ptr', \
	'_get_element_size', \
	'_get_data_byte_size', \
	'_init_b8', \
	'_init_u8', \
	'_init_c8', \
	'_init_i16', \
	'_init_i32', \
	'_init_i64', \
	'_init_f64', \
	'_init_date', \
	'_init_time', \
	'_init_timestamp', \
	'_init_symbol_str', \
	'_init_string_str', \
	'_read_b8', \
	'_read_u8', \
	'_read_c8', \
	'_read_i16', \
	'_read_i32', \
	'_read_i64', \
	'_read_f64', \
	'_read_date', \
	'_read_time', \
	'_read_timestamp', \
	'_read_symbol_id', \
	'_symbol_to_str', \
	'_read_csv', \
	'_init_vector', \
	'_init_list', \
	'_vec_at_idx', \
	'_vec_set_idx', \
	'_vec_push', \
	'_vec_insert', \
	'_vec_resize', \
	'_fill_i64_vec', \
	'_fill_i32_vec', \
	'_fill_f64_vec', \
	'_init_dict', \
	'_dict_keys', \
	'_dict_vals', \
	'_dict_get', \
	'_init_table', \
	'_table_keys', \
	'_table_vals', \
	'_table_col', \
	'_table_row', \
	'_table_count', \
	'_query_select', \
	'_query_update', \
	'_table_insert', \
	'_table_upsert', \
	'_intern_symbol', \
	'_global_set', \
	'_quote_obj', \
	'_serialize', \
	'_deserialize', \
	'_get_type_name', \
	'_at_idx', \
	'_at_obj', \
	'_push_obj', \
	'_ins_obj', \
	'_set_idx' \
]

# Emscripten runtime methods available to JavaScript
EXPORTED_RUNTIME_METHODS = [ \
	'ccall', \
	'cwrap', \
	'FS', \
	'getValue', \
	'setValue', \
	'UTF8ToString', \
	'stringToUTF8', \
	'lengthBytesUTF8', \
	'stackAlloc', \
	'stackSave', \
	'stackRestore', \
	'HEAP8', \
	'HEAP16', \
	'HEAP32', \
	'HEAPU8', \
	'HEAPU16', \
	'HEAPU32', \
	'HEAPF32', \
	'HEAPF64', \
	'_malloc', \
	'_free' \
]

# ============================================================================
# Source Files
# ============================================================================

# Target name
TARGET = rayforce

# Rayforce core sources
# Exclude: main.c (native entry point - we use our own main.c)
# Exclude: epoll.c, iocp.c, kqueue.c (platform-specific poll implementations)
# Exclude: wasm.c (included by poll.c for WASM platform)
EXCLUDE_CORE = main.c epoll.c iocp.c kqueue.c wasm.c
ALL_CORE_SRCS = $(wildcard $(RAYFORCE_SRC)/*.c)
CORE_SRCS = $(filter-out $(addprefix $(RAYFORCE_SRC)/, $(EXCLUDE_CORE)), $(ALL_CORE_SRCS))
CORE_OBJS = $(patsubst $(RAYFORCE_SRC)/%.c, $(OBJ_DIR)/%.o, $(CORE_SRCS))

# WASM project entry point (this project's main.c)
WASM_MAIN = $(SRC_DIR)/main.c
WASM_MAIN_OBJ = $(OBJ_DIR)/main.o

# All objects for linking
ALL_OBJS = $(CORE_OBJS) $(WASM_MAIN_OBJ)

# ============================================================================
# Default Target
# ============================================================================

default: wasm

# ============================================================================
# Source Management
# ============================================================================

# Pull rayforce sources from GitHub
# Clone rayforce repo (for CI or fresh setup)
pull:
	@echo "⬇️  Cloning rayforce from GitHub..."
	@rm -rf $(SRC_DIR)/rayforce-repo
	@git clone --depth 1 $(RAYFORCE_GITHUB) $(SRC_DIR)/rayforce-repo
	@echo "✅ Rayforce cloned to $(SRC_DIR)/rayforce-repo"
	@echo "   Build with: RAYFORCE_SRC_DIR=$(SRC_DIR)/rayforce-repo make wasm"

# ============================================================================
# Build Rules
# ============================================================================

# Check if emcc is available
check-emcc:
	@which emcc > /dev/null || (echo "❌ Emscripten not found. Please install emsdk and run 'source emsdk_env.sh'" && exit 1)

# Create build directories
$(OBJ_DIR):
	@mkdir -p $(OBJ_DIR)

$(DIST_DIR):
	@mkdir -p $(DIST_DIR)

# Compile rayforce core object files
$(OBJ_DIR)/%.o: $(RAYFORCE_SRC)/%.c | $(OBJ_DIR)
	$(CC) -include $(RAYFORCE_SRC)/def.h -c $< $(CFLAGS) -o $@

# Compile WASM main entry point
$(WASM_MAIN_OBJ): $(WASM_MAIN) | $(OBJ_DIR)
	$(CC) -include $(RAYFORCE_SRC)/def.h -iquote $(RAYFORCE_SRC) -c $< $(CFLAGS) -o $@

# Build static library
$(BUILD_DIR)/lib$(TARGET).a: $(CORE_OBJS)
	$(AR) rc $@ $(CORE_OBJS)

# ============================================================================
# WASM Build Targets
# ============================================================================

# Build optimized WASM release with SDK
wasm: CFLAGS = $(WASM_CFLAGS)
wasm: check-emcc $(DIST_DIR) $(BUILD_DIR)/lib$(TARGET).a $(WASM_MAIN_OBJ)
	$(CC) -I$(SRC_DIR) $(CFLAGS) -o $(DIST_DIR)/$(TARGET).js \
		$(ALL_OBJS) \
		-s "EXPORTED_FUNCTIONS=$(EXPORTED_FUNCTIONS)" \
		-s "EXPORTED_RUNTIME_METHODS=$(EXPORTED_RUNTIME_METHODS)" \
		$(WASM_LDFLAGS) \
		-L$(BUILD_DIR) -l$(TARGET)
	@cp $(SRC_DIR)/rayforce.sdk.js $(DIST_DIR)/rayforce.sdk.js
	@cp $(SRC_DIR)/rayforce.umd.js $(DIST_DIR)/rayforce.umd.js
	@cp $(SRC_DIR)/index.js $(DIST_DIR)/index.js
	@cp $(SRC_DIR)/rayforce.sdk.d.ts $(DIST_DIR)/rayforce.sdk.d.ts
	@echo "✅ WASM build complete: $(DIST_DIR)/$(TARGET).js"
	@echo "✅ SDK files copied: rayforce.sdk.js, rayforce.umd.js, index.js, rayforce.sdk.d.ts"

# Build debug version with assertions and safety checks
wasm-debug: CFLAGS = $(DEBUG_CFLAGS)
wasm-debug: check-emcc $(DIST_DIR) $(BUILD_DIR)/lib$(TARGET).a $(WASM_MAIN_OBJ)
	$(CC) -I$(SRC_DIR) $(CFLAGS) -o $(DIST_DIR)/$(TARGET)-debug.js \
		$(ALL_OBJS) \
		-s "EXPORTED_FUNCTIONS=$(EXPORTED_FUNCTIONS)" \
		-s "EXPORTED_RUNTIME_METHODS=$(EXPORTED_RUNTIME_METHODS)" \
		$(DEBUG_LDFLAGS) \
		-L$(BUILD_DIR) -l$(TARGET)
	@echo "✅ Debug WASM build complete: $(DIST_DIR)/$(TARGET)-debug.js"

# Build with preloaded examples (standalone version)
wasm-standalone: CFLAGS = $(WASM_CFLAGS)
wasm-standalone: check-emcc $(DIST_DIR) $(BUILD_DIR)/lib$(TARGET).a $(WASM_MAIN_OBJ)
	@mkdir -p $(BUILD_DIR)/examples
	@cp -r $(RAYFORCE_SRC_DIR)/examples/* $(BUILD_DIR)/examples/ 2>/dev/null || true
	$(CC) -I$(SRC_DIR) $(CFLAGS) -o $(DIST_DIR)/$(TARGET)-standalone.js \
		$(ALL_OBJS) \
		-s "EXPORTED_FUNCTIONS=$(EXPORTED_FUNCTIONS)" \
		-s "EXPORTED_RUNTIME_METHODS=$(EXPORTED_RUNTIME_METHODS)" \
		-s ALLOW_MEMORY_GROWTH=1 \
		--preload-file $(BUILD_DIR)/examples@/examples \
		-L$(BUILD_DIR) -l$(TARGET)
	@echo "✅ Standalone WASM build complete: $(DIST_DIR)/$(TARGET)-standalone.js"

# ============================================================================
# High-level Build Commands
# ============================================================================

# Full build from GitHub
app: pull
	RAYFORCE_SRC_DIR=$(SRC_DIR)/rayforce-repo $(MAKE) wasm
	@echo "🎉 Full build from GitHub complete!"

# Build from local rayforce (default: ../rayforce)
dev: wasm
	@echo "🎉 Development build complete!"

# ============================================================================
# Utility Targets
# ============================================================================

# Start a simple HTTP server for testing
serve:
	@echo "🌐 Starting HTTP server at http://localhost:8080"
	@cd $(EXEC_DIR) && python3 -m http.server 8080

# Run tests
test:
	@echo "🧪 Running WASM tests..."
	@if [ -f "tests/run_tests.js" ]; then \
		node tests/run_tests.js; \
	else \
		echo "No tests configured yet"; \
	fi

# ============================================================================
# Clean Targets
# ============================================================================

clean:
	@echo "🧹 Cleaning build artifacts..."
	@rm -rf $(OBJ_DIR)
	@rm -rf $(DIST_DIR)
	@rm -rf $(BUILD_DIR)/lib$(TARGET).a
	@echo "✅ Clean complete"

clean-all: clean
	@echo "🧹 Cleaning all generated files..."
	@rm -rf $(BUILD_DIR)
	@rm -rf $(RAYFORCE_SRC)
	@echo "✅ Full clean complete"

# ============================================================================
# Help & Debug
# ============================================================================

help:
	@echo "RayforceDB WASM Build System"
	@echo ""
	@echo "Source Management:"
	@echo "  make pull          - Clone rayforce from GitHub to src/rayforce-repo"
	@echo ""
	@echo "Build Targets:"
	@echo "  make wasm          - Build optimized WASM module (ES6)"
	@echo "  make wasm-debug    - Build debug version with assertions"
	@echo "  make wasm-standalone - Build with preloaded examples"
	@echo ""
	@echo "High-level Commands:"
	@echo "  make app           - Full build from GitHub (pull + wasm)"
	@echo "  make dev           - Development build from local sources"
	@echo ""
	@echo "Utility:"
	@echo "  make serve         - Start HTTP server for testing"
	@echo "  make test          - Run tests"
	@echo "  make clean         - Remove build artifacts"
	@echo "  make clean-all     - Remove all generated files including sources"
	@echo "  make help          - Show this help"
	@echo "  make show-sources  - Debug: show source files"
	@echo "  make show-flags    - Debug: show compiler flags"

# Debug: show what files will be compiled
show-sources:
	@echo "Core source files:"
	@echo $(CORE_SRCS) | tr ' ' '\n'
	@echo ""
	@echo "WASM main:"
	@echo $(WASM_MAIN)
	@echo ""
	@echo "All object files:"
	@echo $(ALL_OBJS) | tr ' ' '\n'

# Debug: show compiler flags
show-flags:
	@echo "WASM_CFLAGS:"
	@echo "  $(WASM_CFLAGS)"
	@echo ""
	@echo "DEBUG_CFLAGS:"
	@echo "  $(DEBUG_CFLAGS)"
	@echo ""
	@echo "WASM_LDFLAGS:"
	@echo "  $(WASM_LDFLAGS)"
	@echo ""
	@echo "GIT_HASH: $(GIT_HASH)"

.PHONY: default pull check-emcc wasm wasm-debug wasm-standalone \
	app dev serve test clean clean-all help show-sources show-flags
