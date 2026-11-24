#include <rayforce.h>
#include "lang/eval.h"
int main(void) {
    ray_runtime_t* rt = ray_runtime_create(0, 0);
    if (!rt) return 1;
    ray_t* saved = ray_eval_str("(.db.splayed.set \"native-index-table\" (table [v] (list (.idx.hash [10 20 10]))))");
    if (!saved || RAY_IS_ERR(saved)) return 2;
    ray_release(saved);
    ray_runtime_destroy(rt);
    return 0;
}
