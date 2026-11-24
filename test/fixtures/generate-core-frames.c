#include <stdio.h>
#include <rayforce.h>
#include "lang/eval.h"
#include "store/serde.h"
static const char* exprs[] = {
    "1",
    "0D00:00:00.000000001",
    "(as 'TIMESPAN 9007199254740993)",
    "(as 'TIMESPAN 0Nl)",
    "(as 'TIMESPAN [1 -1 9007199254740993 0Nl])",
    "(table [duration] (list (as 'TIMESPAN [1 -1 9007199254740993 0Nl])))"
};
int main(void) {
    ray_runtime_t* rt = ray_runtime_create(0, NULL);
    if (!rt) return 1;
    printf("{\"core\":\"v3.0.2/d5a44cdb4ec33772104f466a2ca177a74b528041\",\"wire\":%d,\"cases\":[", RAY_SERDE_WIRE_VERSION);
    for (size_t i = 0; i < sizeof(exprs)/sizeof(exprs[0]); i++) {
        ray_t* obj = ray_eval_str(exprs[i]);
        if (!obj || RAY_IS_ERR(obj)) return 2;
        ray_t* bytes = ray_ser(obj);
        if (!bytes || RAY_IS_ERR(bytes)) return 3;
        printf("%s{\"expr\":\"%s\",\"hex\":\"", i ? "," : "", exprs[i]);
        const unsigned char* data = ray_data(bytes);
        for (int64_t j = 0; j < bytes->len; j++) printf("%02x", data[j]);
        printf("\"}");
        ray_release(bytes); ray_release(obj);
    }
    printf("]}\n");
    ray_runtime_destroy(rt);
    return 0;
}
