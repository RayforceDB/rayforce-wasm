/*
 *   RayforceDB WASM Entry Point — v2 engine
 *
 *   This file provides the main entry point and exported functions
 *   for the WebAssembly build of RayforceDB.
 *
 *   Provides a comprehensive JavaScript SDK with zero-copy ArrayBuffer views.
 */

#include <emscripten.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Public umbrella header — atom/vector/list/dict/table/sym/error API. */
#include <rayforce.h>
#include "mem/sys.h"
#include "table/sym.h"

/* Internal-engine functions we reach for WASM glue.  We declare them as
 * externs (rather than including the headers) because core/runtime.h and
 * lang/eval.h each define their own ray_vm_t with incompatible internal
 * fields — including both in one TU collides.  These prototypes are stable
 * across the engine's internal headers. */
extern const char*    ray_error_msg(void);

extern ray_t*  ray_eval_str(const char* source);
extern ray_t*  ray_eval_get_nfo(void);
extern void    ray_eval_set_nfo(ray_t* nfo);
extern ray_t*  ray_get_error_trace(void);

extern ray_t*  ray_select_fn(ray_t** args, int64_t n);
extern ray_t*  ray_update_fn(ray_t** args, int64_t n);
extern ray_t*  ray_insert_fn(ray_t** args, int64_t n);
extern ray_t*  ray_upsert_fn(ray_t** args, int64_t n);

extern ray_t*  ray_nfo_create(const char* filename, size_t fname_len,
                              const char* source,   size_t src_len);

extern ray_t*       ray_fmt(ray_t* obj, int mode);
extern const char*  ray_type_name(int8_t type);

extern ray_t*  ray_read_csv(const char* path);

/* ============================================================================
 * IPC stubs
 *
 * src/core/ipc.c is excluded from the WASM build (uses select()/sockets).
 * src/ops/system.c still references these symbols, so provide weak stubs
 * that return "nyi" errors at runtime.  Browsers can't open raw TCP sockets
 * from WASM anyway — these would be unsuitable even if the engine code
 * compiled.
 * ============================================================================ */

EMSCRIPTEN_KEEPALIVE int64_t ray_ipc_connect(const char* host, uint16_t port,
                                             const char* user, const char* pw,
                                             int timeout_ms) {
  (void)host; (void)port; (void)user; (void)pw; (void)timeout_ms;
  return -1;
}

EMSCRIPTEN_KEEPALIVE void ray_ipc_close(int64_t handle) { (void)handle; }

EMSCRIPTEN_KEEPALIVE ray_t* ray_ipc_send(int64_t handle, ray_t* msg) {
  (void)handle; (void)msg;
  return ray_error("nyi", "IPC not available in WASM build");
}

EMSCRIPTEN_KEEPALIVE ray_err_t ray_ipc_send_async(int64_t handle, ray_t* msg) {
  (void)handle; (void)msg;
  return RAY_ERR_NYI;
}

EMSCRIPTEN_KEEPALIVE ray_t* ray_ipc_send_verbose(int64_t handle, ray_t* msg) {
  return ray_ipc_send(handle, msg);
}

EMSCRIPTEN_KEEPALIVE int64_t ray_ipc_current_handle(void) { return -1; }

EMSCRIPTEN_KEEPALIVE int64_t ray_ipc_listen(ray_poll_t* poll, uint16_t port) {
  (void)poll; (void)port;
  return -1;
}

/* Journal replay shares IPC's delta/RLE decoder even when networking is
 * unavailable, so keep the portable decoder in the WASM glue. */
EMSCRIPTEN_KEEPALIVE size_t ray_ipc_decompress(const uint8_t* src, size_t clen,
                                               uint8_t* dst, size_t dst_len) {
  uint8_t* decoded = ray_sys_alloc(dst_len);
  if (!decoded) return 0;

  size_t si = 0;
  size_t di = 0;
  while (si < clen && di < dst_len) {
    int8_t count = (int8_t)src[si++];
    if (count > 0) {
      if (si >= clen) { ray_sys_free(decoded); return 0; }
      size_t n = (size_t)count;
      if (di + n > dst_len) { ray_sys_free(decoded); return 0; }
      memset(decoded + di, src[si++], n);
      di += n;
    } else {
      size_t n = (size_t)(-(int)count);
      if (si + n > clen || di + n > dst_len) {
        ray_sys_free(decoded);
        return 0;
      }
      memcpy(decoded + di, src + si, n);
      si += n;
      di += n;
    }
  }

  if (di == 0) { ray_sys_free(decoded); return 0; }
  dst[0] = decoded[0];
  for (size_t i = 1; i < di; i++) dst[i] = (uint8_t)(decoded[i] + dst[i - 1]);
  ray_sys_free(decoded);
  return di;
}

EMSCRIPTEN_KEEPALIVE ray_t* ray_repl_connect_fn(ray_t* host_port_str) {
  (void)host_port_str;
  return ray_error("nyi", "remote REPL not available in WASM build");
}

EMSCRIPTEN_KEEPALIVE ray_t* ray_repl_disconnect_fn(ray_t** args, int64_t n) {
  (void)args; (void)n;
  return RAY_NULL_OBJ;
}

/* ANSI escapes for the boot banner. */
#define BOLD   "\033[1m"
#define YELLOW "\033[33m"
#define RESET  "\033[0m"

#define ABOUT_BANNER                                                           \
  "\n  %s%sRayforceDB: %s\n"                                                   \
  "  WASM target\n"                                                            \
  "  Documentation: https://rayforcedb.com/\n"                                 \
  "  Github: https://github.com/RayforceDB/rayforce%s\n"

/* ============================================================================
 * Static state
 * ============================================================================ */

static int64_t           g_cmd_counter   = 0;
static ray_runtime_t*    g_runtime       = NULL;
static ray_t*            g_last_format   = NULL;  /* keeps strof_obj's RAY_STR alive */
static char              g_version_buf[64];
static char              g_sym_to_str_buf[256];   /* symbol_to_str scratch */
static char              g_strof_buf[8192];       /* strof_obj scratch */
static char              g_str_vec_buf[8192];     /* str_vec_get per-cell scratch */
static char              g_err_msg_buf[256];      /* error message snapshot */

/* ============================================================================
 * JS callbacks
 * ============================================================================ */

EM_JS(void, js_rayforce_ready, (const char* text), {
  if (Module.rayforce_ready) {
    Module.rayforce_ready(UTF8ToString(text));
  }
});

/* ============================================================================
 * Core: version, formatting
 * ============================================================================ */

EMSCRIPTEN_KEEPALIVE const char* version_str(void) {
  snprintf(g_version_buf, sizeof(g_version_buf), "%s", ray_version_string());
  return g_version_buf;
}

/* Format any object to a NUL-terminated string for JS consumption.
 * The previous formatted ray_t is released; the returned pointer is valid
 * until the next strof_obj() call. */
EMSCRIPTEN_KEEPALIVE const char* strof_obj(ray_t* obj) {
  if (g_last_format) {
    ray_release(g_last_format);
    g_last_format = NULL;
  }
  if (!obj) {
    g_strof_buf[0] = '\0';
    return g_strof_buf;
  }
  ray_t* s = ray_fmt(obj, 1);  /* mode 1 = full / REPL */
  if (!s || RAY_IS_ERR(s)) {
    g_strof_buf[0] = '\0';
    if (s) ray_error_free(s);
    return g_strof_buf;
  }
  g_last_format = s;
  size_t n = ray_str_len(s);
  if (n >= sizeof(g_strof_buf)) n = sizeof(g_strof_buf) - 1;
  memcpy(g_strof_buf, ray_str_ptr(s), n);
  g_strof_buf[n] = '\0';
  return g_strof_buf;
}

/* ============================================================================
 * Eval (with source-location tracking via nfo)
 * ============================================================================ */

EMSCRIPTEN_KEEPALIVE ray_t* eval_cmd(const char* cmd, const char* name) {
  if (!cmd) return RAY_NULL_OBJ;

  char auto_name[32];
  if (!name || !name[0]) {
    snprintf(auto_name, sizeof(auto_name), "cmd:%lld",
             (long long)++g_cmd_counter);
    name = auto_name;
  }

  ray_t* nfo  = ray_nfo_create(name, strlen(name), cmd, strlen(cmd));
  ray_t* prev = ray_eval_get_nfo();
  if (nfo && !RAY_IS_ERR(nfo)) ray_eval_set_nfo(nfo);

  ray_t* result = ray_eval_str(cmd);

  ray_eval_set_nfo(prev);
  if (nfo && !RAY_IS_ERR(nfo)) ray_release(nfo);
  return result;
}

EMSCRIPTEN_KEEPALIVE int64_t get_cmd_counter(void) { return g_cmd_counter; }
EMSCRIPTEN_KEEPALIVE void    reset_cmd_counter(void) { g_cmd_counter = 0; }

/* ============================================================================
 * Type code constants (exported numerics for the JS Types enum)
 * ============================================================================ */

EMSCRIPTEN_KEEPALIVE int32_t TYPE_CODE_LIST(void)      { return RAY_LIST; }
EMSCRIPTEN_KEEPALIVE int32_t TYPE_CODE_B8(void)        { return RAY_BOOL; }
EMSCRIPTEN_KEEPALIVE int32_t TYPE_CODE_U8(void)        { return RAY_U8; }
EMSCRIPTEN_KEEPALIVE int32_t TYPE_CODE_I16(void)       { return RAY_I16; }
EMSCRIPTEN_KEEPALIVE int32_t TYPE_CODE_I32(void)       { return RAY_I32; }
EMSCRIPTEN_KEEPALIVE int32_t TYPE_CODE_I64(void)       { return RAY_I64; }
EMSCRIPTEN_KEEPALIVE int32_t TYPE_CODE_F32(void)       { return RAY_F32; }
EMSCRIPTEN_KEEPALIVE int32_t TYPE_CODE_F64(void)       { return RAY_F64; }
EMSCRIPTEN_KEEPALIVE int32_t TYPE_CODE_DATE(void)      { return RAY_DATE; }
EMSCRIPTEN_KEEPALIVE int32_t TYPE_CODE_TIME(void)      { return RAY_TIME; }
EMSCRIPTEN_KEEPALIVE int32_t TYPE_CODE_TIMESTAMP(void) { return RAY_TIMESTAMP; }
EMSCRIPTEN_KEEPALIVE int32_t TYPE_CODE_GUID(void)      { return RAY_GUID; }
EMSCRIPTEN_KEEPALIVE int32_t TYPE_CODE_SYM(void)       { return RAY_SYM; }
EMSCRIPTEN_KEEPALIVE int32_t TYPE_CODE_STR(void)       { return RAY_STR; }
EMSCRIPTEN_KEEPALIVE int32_t TYPE_CODE_TABLE(void)     { return RAY_TABLE; }
EMSCRIPTEN_KEEPALIVE int32_t TYPE_CODE_DICT(void)      { return RAY_DICT; }
EMSCRIPTEN_KEEPALIVE int32_t TYPE_CODE_LAMBDA(void)    { return RAY_LAMBDA; }
EMSCRIPTEN_KEEPALIVE int32_t TYPE_CODE_NULL(void)      { return RAY_NULL; }
EMSCRIPTEN_KEEPALIVE int32_t TYPE_CODE_ERR(void)       { return RAY_ERROR; }

/* ============================================================================
 * Object introspection
 * ============================================================================ */

EMSCRIPTEN_KEEPALIVE int32_t get_obj_type(ray_t* obj) {
  if (!obj) return RAY_NULL;
  return (int32_t)ray_type(obj);
}

EMSCRIPTEN_KEEPALIVE int64_t get_obj_len(ray_t* obj) {
  if (!obj) return 0;
  if (ray_is_atom(obj)) return 1;
  return ray_len(obj);
}

EMSCRIPTEN_KEEPALIVE bool is_obj_atom(ray_t* obj) {
  return obj ? ray_is_atom(obj) : false;
}

EMSCRIPTEN_KEEPALIVE bool is_obj_vector(ray_t* obj) {
  return obj ? ray_is_vec(obj) : false;
}

EMSCRIPTEN_KEEPALIVE bool is_obj_null(ray_t* obj) {
  return !obj || RAY_IS_NULL(obj);
}

EMSCRIPTEN_KEEPALIVE bool is_obj_error(ray_t* obj) {
  return obj && RAY_IS_ERR(obj);
}

EMSCRIPTEN_KEEPALIVE uint32_t get_obj_rc(ray_t* obj) {
  return obj ? obj->rc : 0;
}

/* ============================================================================
 * Error info
 *
 * v2 splits the error object's *code* (inline 7-byte SSO sdata, retrieved via
 * ray_err_code) from the error *message* (per-VM thread-local buffer, retrieved
 * via ray_error_msg).  The message must be snapshotted before the next
 * ray_error() call clobbers it — get_error_message returns a stable copy in
 * g_err_msg_buf so the JS SDK can read it after subsequent eval calls.
 * ============================================================================ */

EMSCRIPTEN_KEEPALIVE const char* get_error_code(ray_t* err) {
  if (!err || !RAY_IS_ERR(err)) return "unknown";
  const char* c = ray_err_code(err);
  return c ? c : "unknown";
}

EMSCRIPTEN_KEEPALIVE const char* get_error_message(ray_t* err) {
  (void)err;  /* message lives on the VM, not on the err object */
  const char* m = ray_error_msg();
  if (!m) m = "";
  size_t n = strlen(m);
  if (n >= sizeof(g_err_msg_buf)) n = sizeof(g_err_msg_buf) - 1;
  memcpy(g_err_msg_buf, m, n);
  g_err_msg_buf[n] = '\0';
  return g_err_msg_buf;
}

EMSCRIPTEN_KEEPALIVE ray_t* get_error_trace(void) {
  return ray_get_error_trace();
}

/* Convenience: return a fresh dict {code, message} for JS. */
EMSCRIPTEN_KEEPALIVE ray_t* get_error_info(ray_t* err) {
  if (!err || !RAY_IS_ERR(err)) return RAY_NULL_OBJ;

  const char* code = ray_err_code(err);
  const char* msg  = ray_error_msg();
  if (!code) code = "unknown";
  if (!msg)  msg  = "";

  int64_t code_id = ray_sym_intern("code", 4);
  int64_t msg_id  = ray_sym_intern("message", 7);

  ray_t* keys = ray_sym_vec_new(RAY_SYM_W64, 2);
  keys = ray_vec_append(keys, &code_id);
  keys = ray_vec_append(keys, &msg_id);

  ray_t* vals = ray_list_new(2);
  vals = ray_list_append(vals, ray_str(code, strlen(code)));
  vals = ray_list_append(vals, ray_str(msg,  strlen(msg)));

  return ray_dict_new(keys, vals);
}

/* ============================================================================
 * Memory access for zero-copy ArrayBuffer views
 * ============================================================================ */

EMSCRIPTEN_KEEPALIVE void* get_data_ptr(ray_t* obj) {
  if (!obj || ray_is_atom(obj)) return NULL;
  return ray_data(obj);
}

/* Element size in bytes for a vector type tag.  Mirrors ray_type_sizes
 * but special-cases RAY_LIST → sizeof(ray_t*) (which is 4 on WASM32, vs the
 * engine's hardcoded 8 in ray_type_sizes for native 64-bit builds), and
 * returns 0 for RAY_STR (per-cell ray_str_t structs aren't zero-copy
 * viewable from JS — use str_vec_get instead). */
EMSCRIPTEN_KEEPALIVE int32_t get_element_size(int8_t type) {
  int8_t t = type < 0 ? -type : type;
  if (t == RAY_LIST) return (int32_t)sizeof(ray_t*);
  if (t == RAY_STR)  return 0;
  return (int32_t)ray_type_sizes[(uint8_t)t];
}

EMSCRIPTEN_KEEPALIVE int64_t get_data_byte_size(ray_t* obj) {
  if (!obj || ray_is_atom(obj)) return 0;
  return ray_len(obj) * (int64_t)get_element_size(obj->type);
}

/* ============================================================================
 * Atom constructors
 * ============================================================================ */

/* Index, length and symbol-id parameters that cross the JS boundary are
 * declared `ray_jsidx_t` (double), never int64_t.
 *
 * The build links with `-s WASM_BIGINT=0`, which legalizes every i64 parameter
 * into two i32 words (lo, hi).  The SDK's cwrap arg lists declare one 'number'
 * per C parameter, so an i64 parameter that is not last shifts every parameter
 * after it: `vec_set_idx(obj, idx, val)` received `val` as idx's high word and
 * 0 as `val`, which tripped the `if (!obj || !val)` guard and returned
 * RAY_NULL_OBJ.  A trailing i64 appeared to work only because the missing high
 * word defaults to 0 -- it still truncated at 2^32.
 *
 * A double is passed as one f64, needs no legalization, matches the JS Number
 * domain exactly, and represents every integer up to 2^53 -- far beyond any
 * index reachable in a 4 GiB wasm32 heap.  Call sites in JS stay unchanged. */
typedef double ray_jsidx_t;

/* Values arriving as f64 are untrusted: JS (or a raw `_fill_i32_vec(p, d, -1)`
 * probe) can hand us NaN, Infinity, a fraction or a negative.  Casting those
 * straight to int64_t is undefined for NaN/Inf and, for a negative, yields a
 * negative count whose byte size wraps to nearly UINT32_MAX once memcpy's
 * 32-bit size_t truncates it on wasm32.  Narrow only after proving the value
 * is finite, integral, non-negative and inside the exact-integer range of a
 * double. */
#define RAY_JSIDX_MAX 9007199254740991.0 /* 2^53 - 1 */

static bool jsidx_to_i64(ray_jsidx_t v, int64_t* out) {
  if (!isfinite(v) || v < 0.0 || v > RAY_JSIDX_MAX || v != floor(v)) return false;
  *out = (int64_t)v;
  return true;
}

/* String-length arguments cross the boundary as f64 as well.  Every JS call
 * site marshals its argument through cwrap's 'string', which hands us a
 * NUL-terminated copy, so we can do better than trusting the number: validate
 * it, then clamp to the buffer's actual extent.  A bogus length then neither
 * wraps the size_t cast nor reads past the copy. */
static bool jsidx_to_strlen(const char* s, ray_jsidx_t len_f, size_t* out) {
  int64_t n;
  if (!s || !jsidx_to_i64(len_f, &n) || (uint64_t)n > (uint64_t)SIZE_MAX) return false;
  /* Open-coded strnlen: that is POSIX, and this TU builds with -std=c17. */
  size_t max = (size_t)n, i = 0;
  while (i < max && s[i]) i++;
  *out = i;
  return true;
}

EMSCRIPTEN_KEEPALIVE ray_t* init_b8(bool val)             { return ray_bool(val); }
EMSCRIPTEN_KEEPALIVE ray_t* init_u8(uint8_t val)          { return ray_u8(val); }
EMSCRIPTEN_KEEPALIVE ray_t* init_i16(int16_t val)         { return ray_i16(val); }
EMSCRIPTEN_KEEPALIVE ray_t* init_i32(int32_t val)         { return ray_i32(val); }
EMSCRIPTEN_KEEPALIVE ray_t* init_i64(int64_t val)         { return ray_i64(val); }
EMSCRIPTEN_KEEPALIVE ray_t* init_f32(float val)           { return ray_f32(val); }
EMSCRIPTEN_KEEPALIVE ray_t* init_f64(double val)          { return ray_f64(val); }
EMSCRIPTEN_KEEPALIVE ray_t* init_date(int64_t days)       { return ray_date(days); }
EMSCRIPTEN_KEEPALIVE ray_t* init_time(int64_t ms)         { return ray_time(ms); }
EMSCRIPTEN_KEEPALIVE ray_t* init_timestamp(int64_t ns)    { return ray_timestamp(ns); }

EMSCRIPTEN_KEEPALIVE ray_t* init_symbol_str(const char* s, ray_jsidx_t len) {
  size_t n;
  if (!jsidx_to_strlen(s, len, &n)) return ray_error("length", "init_symbol_str: invalid length");
  return ray_sym(ray_sym_intern(s, n));
}

EMSCRIPTEN_KEEPALIVE ray_t* init_string_str(const char* s, ray_jsidx_t len) {
  size_t n;
  if (!jsidx_to_strlen(s, len, &n)) return ray_error("length", "init_string_str: invalid length");
  return ray_str(s, n);
}

/* ============================================================================
 * Atom readers
 * ============================================================================ */

EMSCRIPTEN_KEEPALIVE bool     read_b8(ray_t* obj)        { return obj ? (bool)obj->b8 : false; }
EMSCRIPTEN_KEEPALIVE uint8_t  read_u8(ray_t* obj)        { return obj ? obj->u8 : 0; }
EMSCRIPTEN_KEEPALIVE int16_t  read_i16(ray_t* obj)       { return obj ? obj->i16 : 0; }
EMSCRIPTEN_KEEPALIVE int32_t  read_i32(ray_t* obj)       { return obj ? obj->i32 : 0; }
EMSCRIPTEN_KEEPALIVE int64_t  read_i64(ray_t* obj)       { return obj ? obj->i64 : 0; }
EMSCRIPTEN_KEEPALIVE float    read_f32(ray_t* obj)       { return obj ? (float)obj->f64 : 0.0f; }
EMSCRIPTEN_KEEPALIVE double   read_f64(ray_t* obj)       { return obj ? obj->f64 : 0.0; }

/* DATE/TIME atoms store their value in the i64 union slot (vector elements
 * are 4 bytes, but the atom storage union slot is i64).  Truncate to i32
 * to match the v1 SDK contract — values fit comfortably in 31 bits. */
EMSCRIPTEN_KEEPALIVE int32_t read_date(ray_t* obj) {
  return obj ? (int32_t)obj->i64 : 0;
}
EMSCRIPTEN_KEEPALIVE int32_t read_time(ray_t* obj) {
  return obj ? (int32_t)obj->i64 : 0;
}
EMSCRIPTEN_KEEPALIVE int64_t read_timestamp(ray_t* obj) {
  return obj ? obj->i64 : 0;
}
EMSCRIPTEN_KEEPALIVE int64_t read_symbol_id(ray_t* obj) {
  return obj ? obj->i64 : 0;
}

/* Reverse-lookup an interned symbol ID to its string.  Copies into a
 * thread-local scratch buffer so the returned pointer survives until the
 * next call (Emscripten's UTF8ToString already copies on the JS side
 * before the next call lands). */
EMSCRIPTEN_KEEPALIVE const char* symbol_to_str(ray_jsidx_t id_f) {
  int64_t id;
  if (!jsidx_to_i64(id_f, &id)) {
    g_sym_to_str_buf[0] = '\0';
    return g_sym_to_str_buf;
  }
  ray_t* s = ray_sym_str(id);
  if (!s) {
    g_sym_to_str_buf[0] = '\0';
    return g_sym_to_str_buf;
  }
  size_t n = ray_str_len(s);
  if (n >= sizeof(g_sym_to_str_buf)) n = sizeof(g_sym_to_str_buf) - 1;
  memcpy(g_sym_to_str_buf, ray_str_ptr(s), n);
  g_sym_to_str_buf[n] = '\0';
  ray_release(s);
  return g_sym_to_str_buf;
}

/* Resolve a symbol vector cell through the vector's own domain. CSV/splayed
 * columns may use a file-local dictionary whose positions are not runtime
 * symbol IDs. */
EMSCRIPTEN_KEEPALIVE const char* symbol_vec_get(ray_t* vec, ray_jsidx_t idx) {
  int64_t i;
  if (!vec || ray_type(vec) != RAY_SYM || !jsidx_to_i64(idx, &i) || i >= ray_len(vec)) {
    g_sym_to_str_buf[0] = '\0';
    return g_sym_to_str_buf;
  }
  ray_t* s = ray_sym_vec_cell(vec, i); /* borrowed from the domain */
  if (!s) {
    g_sym_to_str_buf[0] = '\0';
    return g_sym_to_str_buf;
  }
  size_t n = ray_str_len(s);
  if (n >= sizeof(g_sym_to_str_buf)) n = sizeof(g_sym_to_str_buf) - 1;
  memcpy(g_sym_to_str_buf, ray_str_ptr(s), n);
  g_sym_to_str_buf[n] = '\0';
  return g_sym_to_str_buf;
}

/* ============================================================================
 * String helpers — RAY_STR atoms and RAY_STR vectors
 * ============================================================================ */

EMSCRIPTEN_KEEPALIVE const char* str_atom_ptr(ray_t* s) {
  return s ? ray_str_ptr(s) : "";
}

EMSCRIPTEN_KEEPALIVE int64_t str_atom_len(ray_t* s) {
  return s ? (int64_t)ray_str_len(s) : 0;
}

/* Per-cell read of a RAY_STR vector.  Copies into a thread-local scratch
 * buffer; lifetime as for symbol_to_str. */
EMSCRIPTEN_KEEPALIVE const char* str_vec_get(ray_t* vec, ray_jsidx_t idx) {
  int64_t i;
  if (!vec || !jsidx_to_i64(idx, &i)) {
    g_str_vec_buf[0] = '\0';
    return g_str_vec_buf;
  }
  size_t n = 0;
  const char* p = ray_str_vec_get(vec, i, &n);
  if (!p) {
    g_str_vec_buf[0] = '\0';
    return g_str_vec_buf;
  }
  if (n >= sizeof(g_str_vec_buf)) n = sizeof(g_str_vec_buf) - 1;
  memcpy(g_str_vec_buf, p, n);
  g_str_vec_buf[n] = '\0';
  return g_str_vec_buf;
}

/* ============================================================================
 * Vector / list constructors
 * ============================================================================ */

/* v2's ray_vec_new returns a vector with capacity=N but len=0 — caller is
 * expected to ray_vec_append.  The SDK's "create vector of length N" API
 * relies on len being set up-front so the JS side can write through the
 * typed-array view and have the engine see the elements.  We bridge that
 * by setting v->len = capacity after allocation; data starts zero-filled
 * because mmap'd pages are zero-init. */
EMSCRIPTEN_KEEPALIVE ray_t* init_vector(int8_t type, ray_jsidx_t len_f) {
  int64_t len;
  if (!jsidx_to_i64(len_f, &len)) return ray_error("length", "init_vector: invalid length");
  ray_t* v = (type == RAY_SYM) ? ray_sym_vec_new(RAY_SYM_W64, len) : ray_vec_new(type, len);
  if (v && !RAY_IS_ERR(v)) v->len = len;
  return v;
}

EMSCRIPTEN_KEEPALIVE ray_t* init_list(ray_jsidx_t len_f) {
  int64_t len;
  if (!jsidx_to_i64(len_f, &len)) return ray_error("length", "init_list: invalid length");
  ray_t* l = ray_list_new(len);
  if (l && !RAY_IS_ERR(l)) {
    /* Slots default to RAY_NULL_OBJ so iteration / drop is safe before
     * the SDK fills them in. */
    ray_t** elems = (ray_t**)ray_data(l);
    for (int64_t i = 0; i < len; i++) elems[i] = RAY_NULL_OBJ;
    l->len = len;
  }
  return l;
}

/* ============================================================================
 * Vector / list ops
 *
 * v2 vectors take raw element pointers (memcpy'd into the slot) while lists
 * take ray_t* directly.  These helpers branch on the parent type so the JS
 * SDK can stay uniform: every operation takes a "value" ray_t* (an atom)
 * and we either unbox the scalar or hand the ray_t* through.
 * ============================================================================ */

/* Pull a void* to the storage slot of the relevant scalar inside `atom`,
 * suitable for ray_vec_append/set/insert_at on a vector of `target_type`.
 * Returns NULL for types that need a per-cell append helper instead. */
static const void* scalar_addr(ray_t* atom, int8_t target_type) {
  if (!atom) return NULL;
  switch (target_type) {
    case RAY_BOOL: case RAY_U8:        return &atom->u8;
    case RAY_I16:                       return &atom->i16;
    case RAY_I32:                       return &atom->i32;
    case RAY_I64: case RAY_DATE:
    case RAY_TIME: case RAY_TIMESTAMP:
    case RAY_SYM:                       return &atom->i64;
    case RAY_F32: {
      static _Thread_local float f;     /* narrow once into a stable slot */
      f = (float)atom->f64;
      return &f;
    }
    case RAY_F64:                       return &atom->f64;
    case RAY_GUID:                      return ray_data(atom);
    default:                            return NULL;
  }
}

/* Box a vector element (raw pointer) back into a fresh atom. */
static ray_t* box_vec_element(int8_t vec_type, const void* p) {
  if (!p) return RAY_NULL_OBJ;
  switch (vec_type) {
    case RAY_BOOL:      return ray_bool(*(const uint8_t*)p);
    case RAY_U8:        return ray_u8(*(const uint8_t*)p);
    case RAY_I16:       return ray_i16(*(const int16_t*)p);
    case RAY_I32:       return ray_i32(*(const int32_t*)p);
    case RAY_I64:       return ray_i64(*(const int64_t*)p);
    case RAY_F32:       return ray_f32(*(const float*)p);
    case RAY_F64:       return ray_f64(*(const double*)p);
    case RAY_DATE:      return ray_date(*(const int32_t*)p);
    case RAY_TIME:      return ray_time(*(const int32_t*)p);
    case RAY_TIMESTAMP: return ray_timestamp(*(const int64_t*)p);
    case RAY_SYM:       return ray_sym(*(const int64_t*)p);
    case RAY_GUID:      return ray_guid((const uint8_t*)p);
    default:            return RAY_NULL_OBJ;
  }
}

EMSCRIPTEN_KEEPALIVE ray_t* vec_at_idx(ray_t* obj, ray_jsidx_t idx_f) {
  int64_t idx;
  /* An unusable index reads like an out-of-range one: RAY_NULL_OBJ. */
  if (!obj || !jsidx_to_i64(idx_f, &idx)) return RAY_NULL_OBJ;
  int8_t t = ray_type(obj);
  if (t == RAY_LIST) {
    ray_t* item = ray_list_get(obj, idx);
    if (item) ray_retain(item);
    return item ? item : RAY_NULL_OBJ;
  }
  if (t == RAY_STR) {
    size_t n = 0;
    const char* p = ray_str_vec_get(obj, idx, &n);
    return p ? ray_str(p, n) : RAY_NULL_OBJ;
  }
  void* p = ray_vec_get(obj, idx);
  return box_vec_element(t, p);
}

EMSCRIPTEN_KEEPALIVE ray_t* vec_set_idx(ray_t* obj, ray_jsidx_t idx_f, ray_t* val) {
  int64_t idx;
  if (!obj || !val) return RAY_NULL_OBJ;
  if (!jsidx_to_i64(idx_f, &idx)) return ray_error("index", "vec_set_idx: invalid index");
  int8_t t = ray_type(obj);
  if (t == RAY_LIST) {
    /* ray_list_set retains `val` itself — the caller's ref stays its own.
     * Retaining here too would strand one ref per element. */
    return ray_list_set(obj, idx, val);
  }
  if (t == RAY_STR) {
    size_t n = ray_str_len(val);
    return ray_str_vec_set(obj, idx, ray_str_ptr(val), n);
  }
  const void* sp = scalar_addr(val, t);
  if (!sp) return ray_error("type", "vec_set_idx: unsupported element type");
  return ray_vec_set(obj, idx, sp);
}

EMSCRIPTEN_KEEPALIVE ray_t* vec_push(ray_t* obj, ray_t* val) {
  if (!obj || !val) return RAY_NULL_OBJ;
  int8_t t = ray_type(obj);
  if (t == RAY_LIST) {
    /* ray_list_append retains `val` itself — see vec_set_idx. */
    return ray_list_append(obj, val);
  }
  if (t == RAY_STR) {
    size_t n = ray_str_len(val);
    return ray_str_vec_append(obj, ray_str_ptr(val), n);
  }
  const void* sp = scalar_addr(val, t);
  if (!sp) return ray_error("type", "vec_push: unsupported element type");
  return ray_vec_append(obj, sp);
}

EMSCRIPTEN_KEEPALIVE ray_t* vec_insert(ray_t* obj, ray_jsidx_t idx_f, ray_t* val) {
  int64_t idx;
  if (!obj || !val) return RAY_NULL_OBJ;
  if (!jsidx_to_i64(idx_f, &idx)) return ray_error("index", "vec_insert: invalid index");
  int8_t t = ray_type(obj);
  if (t == RAY_LIST) {
    /* ray_list_insert_at retains `val` itself — see vec_set_idx. */
    return ray_list_insert_at(obj, idx, val);
  }
  if (t == RAY_STR) {
    size_t n = ray_str_len(val);
    return ray_str_vec_insert_at(obj, idx, ray_str_ptr(val), n);
  }
  const void* sp = scalar_addr(val, t);
  if (!sp) return ray_error("type", "vec_insert: unsupported element type");
  return ray_vec_insert_at(obj, idx, sp);
}

/* ============================================================================
 * Vector batch fill
 *
 * Caller-must-own contract: writes through ray_data() honor slice offsets
 * but bypass COW.  If obj->rc > 1 we'd silently mutate other holders, so
 * the JS wrappers must build vectors fresh before filling.
 * ============================================================================ */

EMSCRIPTEN_KEEPALIVE void fill_i64_vec(ray_t* obj, int64_t* data, ray_jsidx_t len_f) {
  int64_t len;
  if (!obj || !data || obj->type != RAY_I64 || !jsidx_to_i64(len_f, &len)) return;
  int64_t copy_len = len < ray_len(obj) ? len : ray_len(obj);
  if (copy_len <= 0) return;
  memcpy(ray_data(obj), data, (size_t)copy_len * sizeof(int64_t));
}

EMSCRIPTEN_KEEPALIVE void fill_i32_vec(ray_t* obj, int32_t* data, ray_jsidx_t len_f) {
  int64_t len;
  if (!obj || !data || obj->type != RAY_I32 || !jsidx_to_i64(len_f, &len)) return;
  int64_t copy_len = len < ray_len(obj) ? len : ray_len(obj);
  if (copy_len <= 0) return;
  memcpy(ray_data(obj), data, (size_t)copy_len * sizeof(int32_t));
}

EMSCRIPTEN_KEEPALIVE void fill_f64_vec(ray_t* obj, double* data, ray_jsidx_t len_f) {
  int64_t len;
  if (!obj || !data || obj->type != RAY_F64 || !jsidx_to_i64(len_f, &len)) return;
  int64_t copy_len = len < ray_len(obj) ? len : ray_len(obj);
  if (copy_len <= 0) return;
  memcpy(ray_data(obj), data, (size_t)copy_len * sizeof(double));
}

/* ============================================================================
 * Dict
 *
 * ray_dict_new consumes both refs.  JS wrappers retain their own handles to
 * keys/vals, so we ray_retain before the call to keep both lifetimes intact.
 * ============================================================================ */

EMSCRIPTEN_KEEPALIVE ray_t* init_dict(ray_t* keys, ray_t* vals) {
  if (!keys || !vals) return RAY_NULL_OBJ;
  ray_retain(keys);
  ray_retain(vals);
  return ray_dict_new(keys, vals);
}

EMSCRIPTEN_KEEPALIVE ray_t* dict_keys(ray_t* d) {
  if (!d || ray_type(d) != RAY_DICT) return RAY_NULL_OBJ;
  ray_t* k = ray_dict_keys(d);  /* borrowed */
  if (k) ray_retain(k);
  return k ? k : RAY_NULL_OBJ;
}

EMSCRIPTEN_KEEPALIVE ray_t* dict_vals(ray_t* d) {
  if (!d || ray_type(d) != RAY_DICT) return RAY_NULL_OBJ;
  ray_t* v = ray_dict_vals(d);  /* borrowed */
  if (v) ray_retain(v);
  return v ? v : RAY_NULL_OBJ;
}

EMSCRIPTEN_KEEPALIVE ray_t* dict_get(ray_t* d, ray_t* key) {
  if (!d || ray_type(d) != RAY_DICT || !key) return RAY_NULL_OBJ;
  ray_t* v = ray_dict_get(d, key);
  return v ? v : RAY_NULL_OBJ;
}

/* ============================================================================
 * Table
 *
 * v2 builds tables column-by-column; init_table replays the v1 contract by
 * iterating the JS-supplied (sym-vec, list-of-cols) and chaining add_col.
 * ray_table_add_col retains each col itself, so the caller's refs (held by
 * the JS wrappers) survive the call untouched.
 * ============================================================================ */

EMSCRIPTEN_KEEPALIVE ray_t* init_table(ray_t* keys, ray_t* vals) {
  if (!keys || !vals) return RAY_NULL_OBJ;
  if (ray_type(keys) != RAY_SYM || ray_type(vals) != RAY_LIST)
    return ray_error("type", "init_table: expected (RAY_SYM, RAY_LIST)");
  int64_t n = ray_len(keys);
  if (ray_len(vals) != n)
    return ray_error("length", "init_table: keys/vals length mismatch");

  ray_t* tbl = ray_table_new(n);
  if (RAY_IS_ERR(tbl)) return tbl;

  int64_t* key_ids = (int64_t*)ray_data(keys);
  for (int64_t i = 0; i < n; i++) {
    ray_t* col = ray_list_get(vals, i);  /* borrowed */
    if (!col) continue;
    /* ray_table_add_col retains col_vec itself; an extra retain here would
     * strand one ref per column. */
    tbl = ray_table_add_col(tbl, key_ids[i], col);
    if (RAY_IS_ERR(tbl)) return tbl;
  }
  return tbl;
}

EMSCRIPTEN_KEEPALIVE ray_t* table_keys(ray_t* t) {
  if (!t || ray_type(t) != RAY_TABLE) return RAY_NULL_OBJ;
  int64_t n = ray_table_ncols(t);
  ray_t* keys = ray_sym_vec_new(RAY_SYM_W64, n);
  for (int64_t i = 0; i < n; i++) {
    int64_t id = ray_table_col_name(t, i);
    keys = ray_vec_append(keys, &id);
  }
  return keys;
}

EMSCRIPTEN_KEEPALIVE ray_t* table_vals(ray_t* t) {
  if (!t || ray_type(t) != RAY_TABLE) return RAY_NULL_OBJ;
  int64_t n = ray_table_ncols(t);
  ray_t* lst = ray_list_new(n);
  for (int64_t i = 0; i < n; i++) {
    ray_t* col = ray_table_get_col_idx(t, i);  /* borrowed */
    /* ray_list_append takes the ref the returned list needs; retaining here
     * too would strand one per column on every .values() call. */
    lst = ray_list_append(lst, col ? col : RAY_NULL_OBJ);
  }
  return lst;
}

EMSCRIPTEN_KEEPALIVE ray_t* table_col(ray_t* t, const char* name, ray_jsidx_t len) {
  size_t n;
  if (!t || ray_type(t) != RAY_TABLE) return RAY_NULL_OBJ;
  if (!jsidx_to_strlen(name, len, &n)) return RAY_NULL_OBJ;
  int64_t id = ray_sym_intern(name, n);
  ray_t* col = ray_table_get_col(t, id);  /* borrowed */
  if (col) ray_retain(col);
  return col ? col : RAY_NULL_OBJ;
}

/* Build a {col_name: col[idx]} dict for one row. */
EMSCRIPTEN_KEEPALIVE ray_t* table_row(ray_t* t, ray_jsidx_t idx) {
  int64_t row;
  if (!t || ray_type(t) != RAY_TABLE) return RAY_NULL_OBJ;
  /* Checked here rather than left to vec_at_idx, so a bad index fails as a
   * row instead of yielding a dict of nulls. */
  if (!jsidx_to_i64(idx, &row)) return RAY_NULL_OBJ;
  int64_t n = ray_table_ncols(t);
  ray_t* keys = ray_sym_vec_new(RAY_SYM_W64, n);
  ray_t* vals = ray_list_new(n);
  for (int64_t i = 0; i < n; i++) {
    int64_t id = ray_table_col_name(t, i);
    keys = ray_vec_append(keys, &id);
    ray_t* col = ray_table_get_col_idx(t, i);
    ray_t* cell = col ? vec_at_idx(col, idx) : RAY_NULL_OBJ;
    vals = ray_list_append(vals, cell);
  }
  return ray_dict_new(keys, vals);
}

EMSCRIPTEN_KEEPALIVE int64_t table_count(ray_t* t) {
  if (!t || ray_type(t) != RAY_TABLE) return 0;
  return ray_table_nrows(t);
}

/* ============================================================================
 * Query operations
 *
 * v2 exposes the special-form bodies as ray_*_fn(args, n).  ray_insert_fn
 * short-circuits when args[0]->type == RAY_TABLE so live tables work without
 * being re-evaluated.  See src/ops/query.c.
 *
 * NOTE: ray_select_fn / ray_update_fn evaluate `from:` as an AST node, so
 * the JS-side SelectQuery class must render to a Rayfall string and call
 * eval_cmd instead of building a dict that stuffs a raw pointer into `from`.
 * That work happens in the JS SDK, not here.
 * ============================================================================ */

EMSCRIPTEN_KEEPALIVE ray_t* query_select(ray_t* query) {
  if (!query) return RAY_NULL_OBJ;
  return ray_select_fn(&query, 1);
}

EMSCRIPTEN_KEEPALIVE ray_t* query_update(ray_t* query) {
  if (!query) return RAY_NULL_OBJ;
  return ray_update_fn(&query, 1);
}

EMSCRIPTEN_KEEPALIVE ray_t* table_insert(ray_t* t, ray_t* data) {
  if (!t || !data) return RAY_NULL_OBJ;
  ray_t* args[2] = { t, data };
  return ray_insert_fn(args, 2);
}

EMSCRIPTEN_KEEPALIVE ray_t* table_upsert(ray_t* t, ray_t* match_count, ray_t* data) {
  if (!t || !data) return RAY_NULL_OBJ;
  ray_t* args[3] = { t, match_count, data };
  return ray_upsert_fn(args, 3);
}

/* ============================================================================
 * Symbol / global env / type name
 * ============================================================================ */

/* Returns -1 for an invalid length; interned IDs are non-negative slots. */
EMSCRIPTEN_KEEPALIVE int64_t intern_symbol(const char* s, ray_jsidx_t len) {
  size_t n;
  if (!jsidx_to_strlen(s, len, &n)) return -1;
  return ray_sym_intern(s, n);
}

EMSCRIPTEN_KEEPALIVE ray_t* global_set(ray_t* name, ray_t* val) {
  if (!name) return RAY_NULL_OBJ;
  ray_err_t e = ray_env_set(name->i64, val);
  if (e != RAY_OK) return ray_error(ray_err_code_str(e), NULL);
  return val;
}

EMSCRIPTEN_KEEPALIVE const char* get_type_name(int8_t type) {
  return ray_type_name(type);
}

/* ============================================================================
 * CSV
 *
 * v2 dropped the buffer-based reader.  ray_read_csv is file-only (mmap +
 * MAP_POPULATE).  The JS SDK writes the supplied buffer to Emscripten MEMFS
 * at /tmp/<name>.csv, calls read_csv(path), then unlinks.
 * ============================================================================ */

EMSCRIPTEN_KEEPALIVE ray_t* read_csv(const char* path) {
  if (!path) return ray_error("user", "CSV path is NULL");
  return ray_read_csv(path);
}

/* ============================================================================
 * Main entry point
 * ============================================================================ */

static void shutdown_runtime(void) {
  if (g_runtime) {
    ray_runtime_destroy(g_runtime);
    g_runtime = NULL;
  }
}

EMSCRIPTEN_KEEPALIVE int main(int argc, char** argv) {
  (void)argc;
  (void)argv;

  g_runtime = ray_runtime_create(0, NULL);
  if (!g_runtime) {
    fprintf(stderr, "WASM init: ray_runtime_create failed\n");
    return -1;
  }
  atexit(shutdown_runtime);

  /* Smoke test — confirms eval + format link cleanly. */
  {
    ray_t* r = ray_eval_str("(+ 1 2)");
    if (!r) {
      fprintf(stderr, "WASM init: eval_str returned NULL\n");
    } else if (RAY_IS_ERR(r)) {
      fprintf(stderr, "WASM init: smoke-test eval errored: %s\n",
              ray_error_msg());
      ray_error_free(r);
    } else {
      ray_t* fmt = ray_fmt(r, 1);
      if (fmt && !RAY_IS_ERR(fmt)) {
        printf("WASM init OK: (+ 1 2) = %.*s\n",
               (int)ray_str_len(fmt), ray_str_ptr(fmt));
        ray_release(fmt);
      }
      ray_release(r);
    }
  }

  /* Build the boot banner. */
  char banner[512];
  snprintf(banner, sizeof(banner), ABOUT_BANNER, BOLD, YELLOW,
           ray_version_string(), RESET);

  js_rayforce_ready(banner);
  return 0;
}
