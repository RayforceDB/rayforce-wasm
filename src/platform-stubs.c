/* Browser builds have no native TCP listener or transmit queue. Keep these
 * signatures checked against the core headers, and refuse operations explicitly.
 */
#include "core/ipc.h"
#include "app/repl.h"

static ray_t* no_ipc(void) { return ray_error("nyi", "native IPC is unavailable in WASM"); }
ray_t* ray_ipc_parse_open_opts_full(ray_t* arg, ray_ipc_open_opts_t* out) {
    (void)arg; (void)out; return no_ipc();
}
int64_t ray_ipc_connect_with(const char* h, uint16_t p, const char* u,
                             const char* pw, const ray_ipc_open_opts_t* opts) {
    (void)h; (void)p; (void)u; (void)pw; (void)opts; return -1;
}
int64_t ray_ipc_listen_at(ray_poll_t* poll, const char* host, uint16_t port) {
    (void)poll; (void)host; (void)port; return -1;
}
ray_t* ray_ipc_send_timeout(int64_t h, ray_t* msg, int64_t timeout) {
    (void)h; (void)msg; (void)timeout; return no_ipc();
}
int ray_ipc_xport_policy_get(void) { return RAY_IPC_XPORT_TCP; }
const char* ray_ipc_xport_policy_name(int p) { return p == RAY_IPC_XPORT_TCP ? "tcp" : NULL; }
const char* ray_ipc_xport_kind_name(int kind) { (void)kind; return NULL; }
/* No browser handle resolves; match the native invalid-handle contract. */
size_t ray_ipc_handle_threshold(int64_t h) { (void)h; return RAY_IPC_COMPRESS_AUTO; }
ray_err_t ray_ipc_frame_async_at(ray_t* msg, size_t threshold, ray_poll_frame_t** out) {
    (void)msg; (void)threshold; *out = NULL; return RAY_ERR_NYI;
}
ray_err_t ray_ipc_try_send_frame(int64_t h, ray_poll_frame_t* f) {
    (void)h; (void)f; return RAY_ERR_NYI;
}
void ray_poll_frame_release(ray_poll_frame_t* f) {
    if (f && --f->rc == 0) ray_free_raw(f);
}
void ray_ipc_tx_limit_get(int64_t* bytes, int64_t* frames) {
    if (bytes) *bytes = 0;
    if (frames) *frames = 0;
}
ray_err_t ray_ipc_tx_info(int64_t h, ray_ipc_tx_info_t* out) {
    (void)h; (void)out; return RAY_ERR_IO;
}
int64_t ray_ipc_tx_hwm_bytes(ray_poll_t* poll) { (void)poll; return 0; }
static _Thread_local bool auto_journal;
bool ray_ipc_auto_journal_eval(void) { return auto_journal; }
bool ray_ipc_set_auto_journal_eval(bool enabled) {
    bool previous = auto_journal; auto_journal = enabled; return previous;
}
ray_t* ray_repl_complete_fn(ray_t* prefix) {
    (void)prefix; return ray_error("nyi", "native REPL completion is unavailable in WASM");
}
ray_err_t ray_ipc_tx_limit_set(int64_t bytes, int64_t frames) {
    (void)bytes; (void)frames; return RAY_ERR_NYI;
}
ray_err_t ray_ipc_tx_limit_set_handle(int64_t h, int64_t bytes, int64_t frames) {
    (void)h; (void)bytes; (void)frames; return RAY_ERR_NYI;
}
int ray_ipc_xport_policy_parse(const char* s, size_t n) { (void)s; (void)n; return -1; }
bool ray_ipc_xport_policy_set(int policy) { (void)policy; return false; }
ray_poll_t* ray_ipc_context_poll(void) { return NULL; }
ray_poll_t* ray_ipc_active_poll(void) { return NULL; }
