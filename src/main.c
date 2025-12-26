/*
 *   RayforceDB WASM Entry Point
 *
 *   This file provides the main entry point and exported functions
 *   for the WebAssembly build of RayforceDB.
 */

// System headers (string.h is already included via def.h)
#include <dirent.h>
#include <emscripten.h>
#include <stdio.h>
#include <stdlib.h>

// Rayforce headers (from RAYFORCE_SRC via -I flag)
#include "eval.h"
#include "format.h"
#include "runtime.h"
#include "string.h"
#include "sys.h"
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
// Exported WASM functions
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
// This is the preferred method for WASM - it tracks command history
// and provides detailed error location information.
//
// Parameters:
//   cmd  - The command string to evaluate
//   name - Optional source name (e.g., "repl", "file.ray", or NULL for auto-naming)
//
// Returns:
//   The result object (caller must call drop_obj when done)
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

// Get current command counter (useful for debugging/tracking)
EMSCRIPTEN_KEEPALIVE i64_t get_cmd_counter(nil_t) { return __CMD_COUNTER; }

// Reset command counter (e.g., when clearing history)
EMSCRIPTEN_KEEPALIVE nil_t reset_cmd_counter(nil_t) { __CMD_COUNTER = 0; }

EMSCRIPTEN_KEEPALIVE i32_t main(i32_t argc, str_p argv[]) {
  sys_info_t info;
  obj_p fmt = NULL_OBJ;
  runtime_p runtime;

  // Silence unused parameter warnings
  (void)argc;
  (void)argv;

  // Initialize runtime like Python binding does:
  // Pass -r 0 to disable REPL (we'll call eval_str directly from JS)
  str_p wasm_argv[] = {"rayforce-wasm", "-r", "0", NULL};
  atexit((void (*)(void))runtime_destroy);
  runtime = runtime_create(3, wasm_argv);

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
      printf("WASM init OK: (+ 1 2) = %.*s\n",
             (int)fmt_result->len, AS_C8(fmt_result));
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
