#!/bin/bash
# RayforceDB WASM Build Preparation Script
# This script prepares the build environment and compiles WASM
set -e

EXEC_DIR=$(pwd)
RAYFORCE_GITHUB="${RAYFORCE_GITHUB:-https://github.com/RayforceDB/rayforce.git}"
BUILD_DIR="${EXEC_DIR}/build"
DIST_DIR="${EXEC_DIR}/dist"
SRC_DIR="${EXEC_DIR}/src/rayforce"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

echo_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

echo_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check for Emscripten
check_emscripten() {
    echo_info "Checking for Emscripten..."
    if ! command -v emcc &> /dev/null; then
        echo_error "Emscripten (emcc) not found!"
        echo_info "Please install Emscripten SDK:"
        echo "  git clone https://github.com/emscripten-core/emsdk.git"
        echo "  cd emsdk"
        echo "  ./emsdk install latest"
        echo "  ./emsdk activate latest"
        echo "  source emsdk_env.sh"
        exit 1
    fi
    echo_info "Found emcc: $(which emcc)"
    emcc --version | head -1
}

# Clean previous builds
clean_build() {
    echo_info "Cleaning previous build artifacts..."
    rm -rf "${BUILD_DIR}"
    rm -rf "${DIST_DIR}"
    rm -rf "${SRC_DIR}"
    echo_info "Clean complete"
}

# Clone rayforce from GitHub
clone_rayforce() {
    echo_info "Cloning RayforceDB from GitHub..."
    mkdir -p "${BUILD_DIR}"
    
    if [ -d "${BUILD_DIR}/rayforce-c" ]; then
        echo_warn "Removing existing clone..."
        rm -rf "${BUILD_DIR}/rayforce-c"
    fi
    
    git clone --depth 1 "${RAYFORCE_GITHUB}" "${BUILD_DIR}/rayforce-c"
    echo_info "Clone complete"
}

# Copy sources from local directory
sync_local() {
    local LOCAL_PATH="${1:-../rayforce}"
    echo_info "Syncing from local directory: ${LOCAL_PATH}"
    
    if [ ! -d "${LOCAL_PATH}/core" ]; then
        echo_error "Local rayforce directory not found: ${LOCAL_PATH}"
        exit 1
    fi
    
    mkdir -p "${SRC_DIR}"
    cp -r "${LOCAL_PATH}/core/"* "${SRC_DIR}/"
    cp "${LOCAL_PATH}/app/main.c" "${SRC_DIR}/main.c"
    echo_info "Sync complete"
}

# Prepare sources from cloned repo
prepare_sources() {
    echo_info "Preparing sources..."
    mkdir -p "${SRC_DIR}"
    cp -r "${BUILD_DIR}/rayforce-c/core/"* "${SRC_DIR}/"
    cp "${BUILD_DIR}/rayforce-c/app/main.c" "${SRC_DIR}/main.c"
    
    # Copy examples if available
    if [ -d "${BUILD_DIR}/rayforce-c/examples" ]; then
        mkdir -p "${BUILD_DIR}/examples"
        cp -r "${BUILD_DIR}/rayforce-c/examples/"* "${BUILD_DIR}/examples/"
    fi
    
    echo_info "Sources prepared"
}

# Build WASM
build_wasm() {
    local BUILD_TYPE="${1:-release}"
    echo_info "Building WASM (${BUILD_TYPE})..."
    
    mkdir -p "${BUILD_DIR}/obj"
    mkdir -p "${DIST_DIR}"
    
    # Compiler flags
    local CFLAGS
    local EXTRA_FLAGS=""
    
    if [ "${BUILD_TYPE}" = "debug" ]; then
        CFLAGS="-fPIC -Wall -std=c17 -g -O0 -DDEBUG -DSYS_MALLOC"
        EXTRA_FLAGS="-s ASSERTIONS=2 -s SAFE_HEAP=1 -s STACK_OVERFLOW_CHECK=2"
    else
        CFLAGS="-fPIC -Wall -std=c17 -O3 -msimd128 -fassociative-math -ftree-vectorize -fno-math-errno -funsafe-math-optimizations -ffinite-math-only -funroll-loops -DSYS_MALLOC"
    fi
    
    # Compile object files
    echo_info "Compiling object files..."
    for src in "${SRC_DIR}"/*.c; do
        local obj=$(basename "${src}" .c).o
        if [ "${obj}" != "main.o" ]; then
            emcc -include "${SRC_DIR}/def.h" -c "${src}" ${CFLAGS} -o "${BUILD_DIR}/obj/${obj}"
        fi
    done
    
    # Create static library
    echo_info "Creating static library..."
    emar rc "${BUILD_DIR}/librayforce.a" "${BUILD_DIR}/obj/"*.o
    
    # Exported functions
    local EXPORTED_FUNCS="['_main', '_version', '_null', '_drop_obj', '_clone_obj', '_eval_str', '_obj_fmt', '_strof_obj']"
    local EXPORTED_RUNTIME="['ccall', 'cwrap', 'FS', 'getValue', 'setValue', 'UTF8ToString', 'stringToUTF8']"
    
    # Link final WASM
    echo_info "Linking WASM module..."
    local OUTPUT_NAME="rayforce"
    [ "${BUILD_TYPE}" = "debug" ] && OUTPUT_NAME="rayforce-debug"
    
    emcc -include "${SRC_DIR}/def.h" ${CFLAGS} -o "${DIST_DIR}/${OUTPUT_NAME}.js" \
        "${BUILD_DIR}/obj/"*.o \
        -s "EXPORTED_FUNCTIONS=${EXPORTED_FUNCS}" \
        -s "EXPORTED_RUNTIME_METHODS=${EXPORTED_RUNTIME}" \
        -s ALLOW_MEMORY_GROWTH=1 \
        -s MODULARIZE=1 \
        -s EXPORT_ES6=1 \
        -s EXPORT_NAME="createRayforce" \
        ${EXTRA_FLAGS} \
        -L"${BUILD_DIR}" -lrayforce
    
    echo_info "Build complete: ${DIST_DIR}/${OUTPUT_NAME}.js"
}

# Show usage
show_usage() {
    echo "RayforceDB WASM Build Script"
    echo ""
    echo "Usage: $0 [command] [options]"
    echo ""
    echo "Commands:"
    echo "  full          Full build from GitHub (default)"
    echo "  dev           Development build from local ../rayforce"
    echo "  debug         Debug build with assertions"
    echo "  clean         Clean all build artifacts"
    echo "  help          Show this help"
    echo ""
    echo "Environment Variables:"
    echo "  RAYFORCE_GITHUB   GitHub URL (default: https://github.com/RayforceDB/rayforce.git)"
}

# Main
main() {
    local COMMAND="${1:-full}"
    
    case "${COMMAND}" in
        full)
            check_emscripten
            clean_build
            clone_rayforce
            prepare_sources
            build_wasm release
            echo_info "🎉 Full build complete!"
            ;;
        dev)
            check_emscripten
            sync_local "${2:-../rayforce}"
            build_wasm release
            echo_info "🎉 Development build complete!"
            ;;
        debug)
            check_emscripten
            if [ ! -d "${SRC_DIR}" ]; then
                echo_error "Sources not found. Run 'full' or 'dev' first."
                exit 1
            fi
            build_wasm debug
            echo_info "🎉 Debug build complete!"
            ;;
        clean)
            clean_build
            ;;
        help|--help|-h)
            show_usage
            ;;
        *)
            echo_error "Unknown command: ${COMMAND}"
            show_usage
            exit 1
            ;;
    esac
}

main "$@"

