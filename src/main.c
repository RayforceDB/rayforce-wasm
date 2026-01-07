/*
 *   RayforceDB WASM Entry Point
 *
 *   This file provides the main entry point and exported functions
 *   for the WebAssembly build of RayforceDB.
 *
 *   Provides a comprehensive JavaScript SDK with zero-copy ArrayBuffer views.
 */

// System headers (string.h is already included via def.h)
#include <dirent.h>
#include <emscripten.h>
#include <stdio.h>
#include <stdlib.h>

// Rayforce headers (from RAYFORCE_SRC via -I flag)
#include "binary.h"
#include "error.h" // Include error.h for err_length
#include "eval.h"
#include "format.h"
#include "io.h" // Include io.h for io_read_csv
#include "items.h"
#include "misc.h"
#include "query.h"
#include "runtime.h"
#include "string.h"
#include "sys.h"
#include "update.h"
#include "util.h"

#define __ABOUT                                                                \
  "\
  %s%sRayforceDB: %d.%d %s\n\
  WASM target\n\
  Started from: %s\n\
  Documentation: https://rayforcedb.com/\n\
  Github: https://github.com/RayforceDB/rayforce%s\n"

// ============================================================================
// Command history and source tracking
// ============================================================================

// Command counter for unique error location tracking
static i64_t __CMD_COUNTER = 0;

// ============================================================================
// JavaScript callbacks
// ============================================================================

// Declare rayforce_ready callback on js side
EM_JS(nil_t, js_rayforce_ready, (str_p text), {
  if (Module.rayforce_ready) {
    Module.rayforce_ready(UTF8ToString(text));
  }
});

// ============================================================================
// Helper functions
// ============================================================================

static nil_t list_examples(obj_p *dst) {
  DIR *dir;
  struct dirent *entry;

  str_fmt_into(dst, -1, "\n  -- Here is the list of examples:\n");

  // Attempt to open the directory
  dir = opendir("examples/");
  if (dir == NULL)
    return;

  // Read each entry in the directory
  while ((entry = readdir(dir)) != NULL) {
    if (strncmp(entry->d_name, ".", 1) == 0 ||
        strncmp(entry->d_name, "..", 2) == 0)
      continue;
    str_fmt_into(dst, -1, "  |- %s\n", entry->d_name);
  }

  // Close the directory
  closedir(dir);

  str_fmt_into(
      dst, -1,
      "  -- To try an example, type: (load \"examples/<example_name>)\"\n");

  return;
}

// ============================================================================
// Core WASM exports
// ============================================================================

// Version string buffer
static c8_t version_buf[64];

// Last formatted result (kept alive until next format call)
static obj_p last_formatted = NULL;

EMSCRIPTEN_KEEPALIVE str_p version_str(nil_t) {
  sys_info_t info = sys_info(1);
  snprintf(version_buf, sizeof(version_buf), "%d.%d (%s)", info.major_version,
           info.minor_version, info.build_date);
  return version_buf;
}

// Format any object to a string for JS consumption
EMSCRIPTEN_KEEPALIVE str_p strof_obj(obj_p obj) {
  // Free previous formatted result
  if (last_formatted != NULL) {
    drop_obj(last_formatted);
  }
  // Format the object (full=true for complete output)
  last_formatted = obj_fmt(obj, B8_TRUE);
  return AS_C8(last_formatted);
}

// ============================================================================
// Source-tracking evaluation functions
// ============================================================================

// Evaluate a command with source tracking for proper error locations
EMSCRIPTEN_KEEPALIVE obj_p eval_cmd(lit_p cmd, lit_p name) {
  obj_p str_obj, name_obj, result;
  c8_t auto_name[32];

  if (cmd == NULL)
    return NULL_OBJ;

  // Create string object from command
  str_obj = string_from_str(cmd, strlen(cmd));

  // Create or auto-generate source name
  if (name != NULL && name[0] != '\0') {
    name_obj = string_from_str(name, strlen(name));
  } else {
    // Auto-generate name like "cmd:1", "cmd:2", etc.
    snprintf(auto_name, sizeof(auto_name), "cmd:%lld", ++__CMD_COUNTER);
    name_obj = string_from_str(auto_name, strlen(auto_name));
  }

  // Evaluate with source tracking
  result = ray_eval_str(str_obj, name_obj);

  // Cleanup input objects
  drop_obj(str_obj);
  drop_obj(name_obj);

  return result;
}

// Get current command counter
EMSCRIPTEN_KEEPALIVE i64_t get_cmd_counter(nil_t) { return __CMD_COUNTER; }

// Reset command counter
EMSCRIPTEN_KEEPALIVE nil_t reset_cmd_counter(nil_t) { __CMD_COUNTER = 0; }

// ============================================================================
// Type Code Constants (exported for JS)
// ============================================================================

EMSCRIPTEN_KEEPALIVE i32_t TYPE_CODE_LIST(nil_t) { return TYPE_LIST; }
EMSCRIPTEN_KEEPALIVE i32_t TYPE_CODE_B8(nil_t) { return TYPE_B8; }
EMSCRIPTEN_KEEPALIVE i32_t TYPE_CODE_U8(nil_t) { return TYPE_U8; }
EMSCRIPTEN_KEEPALIVE i32_t TYPE_CODE_I16(nil_t) { return TYPE_I16; }
EMSCRIPTEN_KEEPALIVE i32_t TYPE_CODE_I32(nil_t) { return TYPE_I32; }
EMSCRIPTEN_KEEPALIVE i32_t TYPE_CODE_I64(nil_t) { return TYPE_I64; }
EMSCRIPTEN_KEEPALIVE i32_t TYPE_CODE_SYMBOL(nil_t) { return TYPE_SYMBOL; }
EMSCRIPTEN_KEEPALIVE i32_t TYPE_CODE_DATE(nil_t) { return TYPE_DATE; }
EMSCRIPTEN_KEEPALIVE i32_t TYPE_CODE_TIME(nil_t) { return TYPE_TIME; }
EMSCRIPTEN_KEEPALIVE i32_t TYPE_CODE_TIMESTAMP(nil_t) { return TYPE_TIMESTAMP; }
EMSCRIPTEN_KEEPALIVE i32_t TYPE_CODE_F64(nil_t) { return TYPE_F64; }
EMSCRIPTEN_KEEPALIVE i32_t TYPE_CODE_GUID(nil_t) { return TYPE_GUID; }
EMSCRIPTEN_KEEPALIVE i32_t TYPE_CODE_C8(nil_t) { return TYPE_C8; }
EMSCRIPTEN_KEEPALIVE i32_t TYPE_CODE_TABLE(nil_t) { return TYPE_TABLE; }
EMSCRIPTEN_KEEPALIVE i32_t TYPE_CODE_DICT(nil_t) { return TYPE_DICT; }
EMSCRIPTEN_KEEPALIVE i32_t TYPE_CODE_LAMBDA(nil_t) { return TYPE_LAMBDA; }
EMSCRIPTEN_KEEPALIVE i32_t TYPE_CODE_NULL(nil_t) { return TYPE_NULL; }
EMSCRIPTEN_KEEPALIVE i32_t TYPE_CODE_ERR(nil_t) { return TYPE_ERR; }

// ============================================================================
// Object Introspection
// ============================================================================

// Get object type code
EMSCRIPTEN_KEEPALIVE i32_t get_obj_type(obj_p obj) {
  if (obj == NULL)
    return TYPE_NULL;
  return (i32_t)obj->type;
}

// Get object length (for vectors/lists)
EMSCRIPTEN_KEEPALIVE i64_t get_obj_len(obj_p obj) {
  if (obj == NULL)
    return 0;
  if (IS_ATOM(obj))
    return 1;
  return obj->len;
}

// Check if object is an atom (scalar)
EMSCRIPTEN_KEEPALIVE b8_t is_obj_atom(obj_p obj) {
  if (obj == NULL)
    return B8_FALSE;
  return IS_ATOM(obj) ? B8_TRUE : B8_FALSE;
}

// Check if object is a vector
EMSCRIPTEN_KEEPALIVE b8_t is_obj_vector(obj_p obj) {
  if (obj == NULL)
    return B8_FALSE;
  return IS_VECTOR(obj) ? B8_TRUE : B8_FALSE;
}

// Check if object is null
EMSCRIPTEN_KEEPALIVE b8_t is_obj_null(obj_p obj) {
  if (obj == NULL)
    return B8_TRUE;
  return is_null(obj);
}

// Check if object is an error
EMSCRIPTEN_KEEPALIVE b8_t is_obj_error(obj_p obj) {
  if (obj == NULL)
    return B8_FALSE;
  return IS_ERR(obj) ? B8_TRUE : B8_FALSE;
}

// Get error info as a dict with structured error information
// Returns a dict with keys like: code, message, expected, got, etc.
EMSCRIPTEN_KEEPALIVE obj_p get_error_info(obj_p err) {
  if (err == NULL || !IS_ERR(err))
    return NULL_OBJ;
  return err_info(err);
}

// Get error message as a simple string (doesn't allocate, returns pointer to static or inline data)
EMSCRIPTEN_KEEPALIVE lit_p get_error_message(obj_p err) {
  if (UNLIKELY(err == NULL || !IS_ERR(err))) {
    return "Unknown error";
  }
  
  // For EC_USER errors, get the inline message
  err_code_t code = err_code(err);
  if (code == EC_USER) {
    if (LIKELY(err->len > 0)) {
      return (lit_p)(err + 1);  // Message stored after struct
    }
    return "Out of memory";  // Fallback for OOM errors with no message
  }
  
  // For other error types, return the error code name
  return err_name(code);
}

// Get reference count
EMSCRIPTEN_KEEPALIVE u32_t get_obj_rc(obj_p obj) {
  if (obj == NULL)
    return 0;
  return rc_obj(obj);
}

// ============================================================================
// Memory Access for Zero-Copy ArrayBuffer Views
// ============================================================================

// Get pointer to raw data (for TypedArray views)
// Returns pointer to the start of the data array
EMSCRIPTEN_KEEPALIVE raw_p get_data_ptr(obj_p obj) {
  if (obj == NULL || IS_ATOM(obj))
    return NULL;
  return (raw_p)AS_C8(obj);
}

// Get byte size of element for a type
EMSCRIPTEN_KEEPALIVE i32_t get_element_size(i8_t type) {
  switch (type < 0 ? -type : type) {
  case TYPE_B8:
  case TYPE_U8:
  case TYPE_C8:
    return 1;
  case TYPE_I16:
    return 2;
  case TYPE_I32:
  case TYPE_DATE:
  case TYPE_TIME:
    return 4;
  case TYPE_I64:
  case TYPE_F64:
  case TYPE_SYMBOL:
  case TYPE_TIMESTAMP:
    return 8;
  case TYPE_GUID:
    return 16;
  case TYPE_LIST:
    return sizeof(obj_p);
  default:
    return 0;
  }
}

// Get total byte size of object data
EMSCRIPTEN_KEEPALIVE i64_t get_data_byte_size(obj_p obj) {
  if (obj == NULL || IS_ATOM(obj))
    return 0;
  return obj->len * get_element_size(obj->type);
}

// ============================================================================
// Scalar Constructors
// ============================================================================

EMSCRIPTEN_KEEPALIVE obj_p init_b8(b8_t val) { return b8(val); }

EMSCRIPTEN_KEEPALIVE obj_p init_u8(u8_t val) { return u8(val); }

EMSCRIPTEN_KEEPALIVE obj_p init_c8(c8_t val) { return c8(val); }

EMSCRIPTEN_KEEPALIVE obj_p init_i16(i16_t val) { return i16(val); }

EMSCRIPTEN_KEEPALIVE obj_p init_i32(i32_t val) { return i32(val); }

EMSCRIPTEN_KEEPALIVE obj_p init_i64(i64_t val) { return i64(val); }

EMSCRIPTEN_KEEPALIVE obj_p init_f64(f64_t val) { return f64(val); }

EMSCRIPTEN_KEEPALIVE obj_p init_date(i32_t days) { return adate(days); }

EMSCRIPTEN_KEEPALIVE obj_p init_time(i32_t ms) { return atime(ms); }

EMSCRIPTEN_KEEPALIVE obj_p init_timestamp(i64_t ns) { return timestamp(ns); }

EMSCRIPTEN_KEEPALIVE obj_p init_symbol_str(lit_p str, i64_t len) {
  return symbol(str, len);
}

EMSCRIPTEN_KEEPALIVE obj_p init_string_str(lit_p str, i64_t len) {
  return string_from_str(str, len);
}

// ============================================================================
// Scalar Readers
// ============================================================================

EMSCRIPTEN_KEEPALIVE b8_t read_b8(obj_p obj) {
  if (obj == NULL)
    return B8_FALSE;
  return obj->b8;
}

EMSCRIPTEN_KEEPALIVE u8_t read_u8(obj_p obj) {
  if (obj == NULL)
    return 0;
  return obj->u8;
}

EMSCRIPTEN_KEEPALIVE c8_t read_c8(obj_p obj) {
  if (obj == NULL)
    return 0;
  return obj->c8;
}

EMSCRIPTEN_KEEPALIVE i16_t read_i16(obj_p obj) {
  if (obj == NULL)
    return NULL_I16;
  return obj->i16;
}

EMSCRIPTEN_KEEPALIVE i32_t read_i32(obj_p obj) {
  if (obj == NULL)
    return NULL_I32;
  return obj->i32;
}

EMSCRIPTEN_KEEPALIVE i64_t read_i64(obj_p obj) {
  if (obj == NULL)
    return NULL_I64;
  return obj->i64;
}

EMSCRIPTEN_KEEPALIVE f64_t read_f64(obj_p obj) {
  if (obj == NULL)
    return NULL_F64;
  return obj->f64;
}

EMSCRIPTEN_KEEPALIVE i32_t read_date(obj_p obj) {
  if (obj == NULL)
    return NULL_I32;
  return obj->i32;
}

EMSCRIPTEN_KEEPALIVE i32_t read_time(obj_p obj) {
  if (obj == NULL)
    return NULL_I32;
  return obj->i32;
}

EMSCRIPTEN_KEEPALIVE i64_t read_timestamp(obj_p obj) {
  if (obj == NULL)
    return NULL_I64;
  return obj->i64;
}

// Read symbol as interned ID
EMSCRIPTEN_KEEPALIVE i64_t read_symbol_id(obj_p obj) {
  if (obj == NULL)
    return NULL_I64;
  return obj->i64;
}

// Get symbol string from interned ID
EMSCRIPTEN_KEEPALIVE str_p symbol_to_str(i64_t id) {
  return str_from_symbol(id);
}

// ============================================================================
// Vector Constructors
// ============================================================================

EMSCRIPTEN_KEEPALIVE obj_p init_vector(i8_t type, i64_t len) {
  return vector(type, len);
}

EMSCRIPTEN_KEEPALIVE obj_p init_list(i64_t len) { return LIST(len); }

// ============================================================================
// Vector Operations
// ============================================================================

// Get element at index (returns new object, caller must drop)
EMSCRIPTEN_KEEPALIVE obj_p vec_at_idx(obj_p obj, i64_t idx) {
  if (obj == NULL)
    return NULL_OBJ;
  return at_idx(obj, idx);
}

// Set element at index
EMSCRIPTEN_KEEPALIVE obj_p vec_set_idx(obj_p *obj, i64_t idx, obj_p val) {
  if (obj == NULL || *obj == NULL)
    return NULL_OBJ;
  return set_idx(obj, idx, val);
}

// Push element to end
EMSCRIPTEN_KEEPALIVE obj_p vec_push(obj_p *obj, obj_p val) {
  if (obj == NULL || *obj == NULL)
    return NULL_OBJ;
  return push_obj(obj, val);
}

// Insert element at index
EMSCRIPTEN_KEEPALIVE obj_p vec_insert(obj_p *obj, i64_t idx, obj_p val) {
  if (obj == NULL || *obj == NULL)
    return NULL_OBJ;
  return ins_obj(obj, idx, val);
}

// Resize vector
EMSCRIPTEN_KEEPALIVE obj_p vec_resize(obj_p *obj, i64_t len) {
  if (obj == NULL || *obj == NULL)
    return NULL_OBJ;
  return resize_obj(obj, len);
}

// ============================================================================
// Vector Data Fill (for batch operations)
// ============================================================================

// Fill i64 vector from buffer
EMSCRIPTEN_KEEPALIVE nil_t fill_i64_vec(obj_p obj, i64_t *data, i64_t len) {
  if (obj == NULL || data == NULL || obj->type != TYPE_I64)
    return;
  i64_t copy_len = len < obj->len ? len : obj->len;
  memcpy(AS_I64(obj), data, copy_len * sizeof(i64_t));
}

// Fill i32 vector from buffer
EMSCRIPTEN_KEEPALIVE nil_t fill_i32_vec(obj_p obj, i32_t *data, i64_t len) {
  if (obj == NULL || data == NULL || obj->type != TYPE_I32)
    return;
  i64_t copy_len = len < obj->len ? len : obj->len;
  memcpy(AS_I32(obj), data, copy_len * sizeof(i32_t));
}

// Fill f64 vector from buffer
EMSCRIPTEN_KEEPALIVE nil_t fill_f64_vec(obj_p obj, f64_t *data, i64_t len) {
  if (obj == NULL || data == NULL || obj->type != TYPE_F64)
    return;
  i64_t copy_len = len < obj->len ? len : obj->len;
  memcpy(AS_F64(obj), data, copy_len * sizeof(f64_t));
}

// ============================================================================
// Dict Operations
// ============================================================================

EMSCRIPTEN_KEEPALIVE obj_p init_dict(obj_p keys, obj_p vals) {
  return dict(keys, vals);
}

// Get dict keys
EMSCRIPTEN_KEEPALIVE obj_p dict_keys(obj_p d) {
  if (d == NULL || d->type != TYPE_DICT)
    return NULL_OBJ;
  return clone_obj(AS_LIST(d)[0]);
}

// Get dict values
EMSCRIPTEN_KEEPALIVE obj_p dict_vals(obj_p d) {
  if (d == NULL || d->type != TYPE_DICT)
    return NULL_OBJ;
  return clone_obj(AS_LIST(d)[1]);
}

// Get value by key
EMSCRIPTEN_KEEPALIVE obj_p dict_get(obj_p d, obj_p key) {
  if (d == NULL || d->type != TYPE_DICT)
    return NULL_OBJ;
  return at_obj(d, key);
}

// ============================================================================
// Table Operations
// ============================================================================

EMSCRIPTEN_KEEPALIVE obj_p init_table(obj_p cols, obj_p vals) {
  return table(cols, vals);
}

// Get table column names (symbol vector)
EMSCRIPTEN_KEEPALIVE obj_p table_keys(obj_p t) {
  if (t == NULL || t->type != TYPE_TABLE)
    return NULL_OBJ;
  return clone_obj(AS_LIST(t)[0]);
}

// Get table values (list of vectors)
EMSCRIPTEN_KEEPALIVE obj_p table_vals(obj_p t) {
  if (t == NULL || t->type != TYPE_TABLE)
    return NULL_OBJ;
  return clone_obj(AS_LIST(t)[1]);
}

// Get column by name
EMSCRIPTEN_KEEPALIVE obj_p table_col(obj_p t, lit_p col_name, i64_t len) {
  if (t == NULL || t->type != TYPE_TABLE)
    return NULL_OBJ;
  obj_p sym = symbol(col_name, len);
  obj_p result = at_obj(t, sym);
  drop_obj(sym);
  return result;
}

// Get row by index
EMSCRIPTEN_KEEPALIVE obj_p table_row(obj_p t, i64_t idx) {
  if (t == NULL || t->type != TYPE_TABLE)
    return NULL_OBJ;
  return at_idx(t, idx);
}

// Get table row count
EMSCRIPTEN_KEEPALIVE i64_t table_count(obj_p t) {
  if (t == NULL || t->type != TYPE_TABLE)
    return 0;
  obj_p vals = AS_LIST(t)[1];
  if (vals == NULL || vals->len == 0)
    return 0;
  obj_p first_col = AS_LIST(vals)[0];
  return first_col ? first_col->len : 0;
}

// ============================================================================
// Query Operations
// ============================================================================

// Execute select query (takes dict as query)
EMSCRIPTEN_KEEPALIVE obj_p query_select(obj_p query) {
  if (query == NULL)
    return NULL_OBJ;
  return ray_select(query);
}

// Execute update query
EMSCRIPTEN_KEEPALIVE obj_p query_update(obj_p query) {
  if (query == NULL)
    return NULL_OBJ;
  return ray_update(query);
}

// Insert into table
// Arguments: t = table, data = data to insert
EMSCRIPTEN_KEEPALIVE obj_p table_insert(obj_p t, obj_p data) {
  if (t == NULL || data == NULL)
    return NULL_OBJ;
  obj_p args[2] = {t, data};
  return ray_insert(args, 2);
}

// Upsert into table
// Arguments: t = table, match_count = number of key columns, data = data
EMSCRIPTEN_KEEPALIVE obj_p table_upsert(obj_p t, obj_p match_count,
                                        obj_p data) {
  if (t == NULL || data == NULL)
    return NULL_OBJ;
  obj_p args[3] = {t, match_count, data};
  return ray_upsert(args, 3);
}

// ============================================================================
// Symbol Interning
// ============================================================================

// Intern a string as symbol and return ID
EMSCRIPTEN_KEEPALIVE i64_t intern_symbol(lit_p str, i64_t len) {
  obj_p sym = symbol(str, len);
  i64_t id = sym->i64;
  drop_obj(sym);
  return id;
}

// ============================================================================
// Binary Set/Get (global variable assignment)
// ============================================================================

EMSCRIPTEN_KEEPALIVE obj_p global_set(obj_p name, obj_p val) {
  if (name == NULL)
    return NULL_OBJ;
  return binary_set(name, val);
}

// Quote object (wrap in reference)
EMSCRIPTEN_KEEPALIVE obj_p quote_obj(obj_p obj) {
  if (obj == NULL)
    return NULL_OBJ;
  return ray_quote(obj);
}

// ============================================================================
// Serialization
// ============================================================================

// Serialize object to bytes
EMSCRIPTEN_KEEPALIVE obj_p serialize(obj_p obj) {
  if (obj == NULL)
    return NULL_OBJ;
  return ser_obj(obj);
}

// Deserialize bytes to object
EMSCRIPTEN_KEEPALIVE obj_p deserialize(obj_p buf) {
  if (buf == NULL)
    return NULL_OBJ;
  return de_obj(buf);
}

// ============================================================================
// Type Name
// ============================================================================

EMSCRIPTEN_KEEPALIVE str_p get_type_name(i8_t type) { return type_name(type); }

// ============================================================================
// CSV Parsing
// ============================================================================

// Read CSV from string content
// - Assumes types are all strings (C8) for simplicity in WASM
// - Infers column names from first line
EMSCRIPTEN_KEEPALIVE obj_p read_csv(lit_p content, i64_t len) {
  i64_t i, l, lines;
  str_p buf, pos, line, prev;
  obj_p names, cols, res;
  c8_t sep = ',';

  if (content == NULL) {
    printf("ERROR: read_csv content is NULL\n");
    return err_user("CSV content is NULL");
  }

  // We receive a heap pointer and byte length from JS.
  // Trust the length passed in.
  if (len <= 0) {
    printf("ERROR: read_csv len <= 0\n");
    return err_user("CSV length is zero or negative");
  }

  printf("INFO: read_csv starting, len=%lld bytes (%.1f MB)\n", len, len / (1024.0 * 1024.0));

  // Since we receive a JS string pointer, we shouldn't modify it.
  // However, parse_csv_lines expects a buffer it can read.
  // We treat 'content' as the buffer.
  buf = (str_p)content;

  // Count lines
  lines = 0;
  pos = buf;
  while ((pos = (str_p)memchr(pos, '\n', buf + len - pos))) {
    ++lines;
    ++pos;
  }

  if (len > 0 && buf[len - 1] != '\n') {
    ++lines;
  }

  if (lines == 0) {
    printf("ERROR: read_csv no lines found\n");
    return err_user("CSV has no lines");
  }

  printf("INFO: read_csv found %lld lines\n", lines);

  // Parse header
  pos = (str_p)memchr(buf, '\n', len);
  i64_t header_len = (pos == NULL) ? len : (pos - buf);
  line = (pos == NULL) ? NULL : (pos + 1);

  // Count columns based on separator
  l = 1;
  pos = buf;
  while ((pos = (str_p)memchr(pos, sep, header_len - (pos - buf)))) {
    ++l;
    ++pos;
  }

  printf("INFO: read_csv found %lld columns\n", l);

  names = SYMBOL(l);
  if (names == NULL) {
    printf("ERROR: read_csv failed to allocate names vector\n");
    return err_user("Failed to allocate column names");
  }

  pos = buf;
  i64_t remaining = header_len;

  for (i = 0; i < l; i++) {
    prev = pos;
    str_p next_sep = (str_p)memchr(pos, sep, remaining);

    if (next_sep == NULL) {
      // Last column
      if (remaining > 0 && prev[remaining - 1] == '\r') {
        AS_SYMBOL(names)
        [i] = io_symbol_from_str_trimmed(prev, remaining - 1);
      } else {
        AS_SYMBOL(names)[i] = io_symbol_from_str_trimmed(prev, remaining);
      }
      pos += remaining;
      remaining = 0;
    } else {
      AS_SYMBOL(names)
      [i] = io_symbol_from_str_trimmed(prev, next_sep - prev);
      remaining -= (next_sep - prev + 1);
      pos = next_sep + 1;
    }
  }

  // Alloc types - default to C8 (String)
  i8_t *type_arr = (i8_t *)malloc(l * sizeof(i8_t));
  if (type_arr == NULL) {
    printf("ERROR: read_csv failed to allocate type_arr\n");
    drop_obj(names);
    return err_user("Failed to allocate type array");
  }
  for (i = 0; i < l; i++) {
    type_arr[i] = TYPE_C8;
  }

  // Exclude header from data lines
  lines--;
  if (lines < 0)
    lines = 0;

  printf("INFO: read_csv allocating %lld columns x %lld rows\n", l, lines);

  // Allocate columns
  cols = LIST(l);
  if (cols == NULL) {
    printf("ERROR: read_csv failed to allocate cols list\n");
    free(type_arr);
    drop_obj(names);
    return err_user("Failed to allocate columns list");
  }

  for (i = 0; i < l; i++) {
    AS_LIST(cols)[i] = LIST(lines);
    if (AS_LIST(cols)[i] == NULL) {
      printf("ERROR: read_csv failed to allocate column %lld (lines=%lld)\n", i, lines);
      free(type_arr);
      drop_obj(names);
      drop_obj(cols);
      return err_user("Failed to allocate column data - file too large for memory");
    }
  }

  printf("INFO: read_csv column allocation successful, parsing data...\n");

  // parse lines
  // If line is NULL (only header), we skip parsing
  if (lines > 0 && line != NULL) {
    printf("INFO: read_csv calling io_read_csv for %lld lines...\n", lines);
    res = io_read_csv(type_arr, l, line, len - (line - buf), lines, cols, sep);
    printf("INFO: read_csv io_read_csv returned: %p, type=%d\n", res, res ? res->type : -999);

    if (res && res->type == TYPE_ERR) {
      printf("ERROR: read_csv io_read_csv returned error\n");
      free(type_arr);
      drop_obj(names);
      drop_obj(cols);
      return res;
    }
  }

  free(type_arr);
  
  // Verify objects are still valid before creating table
  printf("INFO: read_csv verifying objects - names=%p type=%d len=%lld, cols=%p type=%d len=%lld\n", 
         names, names ? names->type : -1, names ? names->len : -1,
         cols, cols ? cols->type : -1, cols ? cols->len : -1);
  
  if (names == NULL || cols == NULL) {
    printf("ERROR: read_csv names or cols became NULL!\n");
    if (names) drop_obj(names);
    if (cols) drop_obj(cols);
    return err_user("Memory corruption - names or cols became NULL");
  }
  
  printf("INFO: read_csv creating table...\n");
  obj_p t = table(names, cols);
  printf("INFO: read_csv table() returned: %p\n", t);
  if (t == NULL) {
    printf("ERROR: read_csv table() returned NULL - out of memory!\n");
    drop_obj(names);
    drop_obj(cols);
    return err_user("Out of memory: failed to allocate table structure");
  }

  printf("INFO: read_csv success. Table: %p, rows=%lld, cols=%lld\n", t, lines, l);
  return t;
}

// ============================================================================
// Main Entry Point
// ============================================================================

EMSCRIPTEN_KEEPALIVE i32_t main(i32_t argc, str_p argv[]) {
  sys_info_t info;
  obj_p fmt = NULL_OBJ;
  runtime_p runtime;

  // Silence unused parameter warnings
  (void)argc;
  (void)argv;

  // Initialize runtime like Python binding does:
  // Pass -r 0 to disable REPL (we'll call eval_str directly from JS)
  // Pass -p 1 to force single-threaded mode (avoids pool crashes in WASM)
  str_p wasm_argv[] = {"rayforce-wasm", "-r", "0", "-p", "1", NULL};
  atexit((void (*)(void))runtime_destroy);
  runtime = runtime_create(5, wasm_argv);

  if (runtime == NULL) {
    printf("Failed to initialize Rayforce runtime\n");
    return -1;
  }

  // Verify eval_str works after runtime initialization (LISP syntax)
  {
    obj_p test_result = eval_str("(+ 1 2)");
    if (test_result == NULL) {
      printf("WASM init error: eval_str returned NULL\n");
    } else {
      obj_p fmt_result = obj_fmt(test_result, B8_TRUE);
      printf("WASM init OK: (+ 1 2) = %.*s\n", (int)fmt_result->len,
             AS_C8(fmt_result));
      drop_obj(fmt_result);
      drop_obj(test_result);
    }
  }

  // Get system info after runtime is initialized
  info = sys_info(1);

  str_fmt_into(&fmt, -1, __ABOUT, BOLD, YELLOW, info.major_version,
               info.minor_version, info.build_date, info.cwd, RESET);

  list_examples(&fmt);

  // Signal to JS that we're ready
  js_rayforce_ready(AS_C8(fmt));
  drop_obj(fmt);

  // Don't call runtime_run() - that would start a blocking event loop
  // JS will call eval_str directly
  return 0;
}
