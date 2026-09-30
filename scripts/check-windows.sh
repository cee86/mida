#!/bin/bash
# Type-checks the Windows build (including src-tauri/src/win.rs) from Linux, e.g. in the Claude
# Code cloud workspace, in seconds instead of a GitHub round trip. Needs clang-cl + llvm-lib
# (LLVM 18) and `rustup target add x86_64-pc-windows-msvc`. The `ring` library compiles a little
# C; tiny stand-in headers replace the Windows C headers, which is fine for checking only.
# Nothing built this way is shipped.
set -e
stub=$(mktemp -d)
printf '#pragma once\n#define assert(x) ((void)0)\n' > "$stub/assert.h"
printf '#pragma once\n#include <stddef.h>\nvoid *memcpy(void *, const void *, size_t);\nvoid *memset(void *, int, size_t);\nint memcmp(const void *, const void *, size_t);\nvoid *memmove(void *, const void *, size_t);\n' > "$stub/string.h"
printf '#pragma once\n#include <stddef.h>\nvoid abort(void);\nvoid *malloc(size_t);\nvoid free(void *);\nunsigned long _byteswap_ulong(unsigned long);\nunsigned __int64 _byteswap_uint64(unsigned __int64);\nunsigned short _byteswap_ushort(unsigned short);\n' > "$stub/stdlib.h"
cd "$(dirname "$0")/../src-tauri"
CC_x86_64_pc_windows_msvc=clang-cl-18 AR_x86_64_pc_windows_msvc=llvm-lib-18 \
CFLAGS_x86_64_pc_windows_msvc="/I$stub" \
  cargo check --lib --target x86_64-pc-windows-msvc "$@"
