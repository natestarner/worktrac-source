"""Name the faulting module in a Windows minidump, without a debugger.

This is what identified the 2026-09-01 root cause. There is no cdb/windbg on the dev machine and
no admin rights to install one, but the two facts needed to place blame are plain structures in
the dump: the exception stream (code, subcode, faulting address) and the module list (base, size,
name). Whichever module's address range contains the faulting address is the component that died.

Getting a dump (no admin needed for a process you own):
    curl -o procdump.zip https://download.sysinternals.com/files/Procdump.zip
    procdump64 -accepteula -ma -e -t <vite-pid> <dump-dir>
    # -e dumps on unhandled exception, -t on process exit. Then reproduce the crash.

Then:
    python scripts/diagnostics/parse-minidump.py [path-to-dump]     # defaults to newest in ./dumps

Reading the result -- the SUBCODE is the part that matters for 0xC0000409:
    2 = STACK_COOKIE_CHECK_FAILURE  -> real memory corruption (this is what Node v24.15.0 hit)
    7 = FATAL_APP_EXIT              -> a deliberate abort(), i.e. someone panicked on purpose
Treating those two as the same thing is how a crash gets misread as a panic and vice versa.

Full narrative: docs/incidents/2026-09-01-vite-dev-server-node-stack-corruption.md
"""
import struct, sys, glob, os

if len(sys.argv) > 1:
    path = sys.argv[1]
else:
    cands = glob.glob('dumps/*.dmp') or glob.glob('*.dmp')
    if not cands:
        sys.exit('no .dmp given and none found in ./dumps -- pass a path')
    path = max(cands, key=os.path.getmtime)

f = open(path, 'rb')
print('dump: %s  (%.0f MB)' % (os.path.basename(path), os.path.getsize(path) / 1048576))

sig, ver, nstreams, dir_rva = struct.unpack('<IIII', f.read(16))
if sig != 0x504D444D:
    sys.exit('not a minidump (signature %08X)' % sig)

f.seek(dir_rva)
streams = {}
for _ in range(nstreams):
    stype, size, rva = struct.unpack('<III', f.read(12))
    streams[stype] = (size, rva)

EXCEPTION_STREAM, MODULE_LIST_STREAM = 6, 4


def mdstring(rva):
    f.seek(rva)
    n = struct.unpack('<I', f.read(4))[0]
    return f.read(n).decode('utf-16-le', 'replace')


if EXCEPTION_STREAM not in streams:
    sys.exit('dump has no exception stream -- it was taken on exit (-t), not on a fault (-e)')

_, rva = streams[EXCEPTION_STREAM]
f.seek(rva)
thread_id, _pad = struct.unpack('<II', f.read(8))
code, flags, _rec, addr, nparams, _ = struct.unpack('<IIQQII', f.read(32))
params = struct.unpack('<15Q', f.read(120))

FAST_FAIL = {
    0: 'LEGACY_GS_VIOLATION', 1: 'VTGUARD_CHECK_FAILURE',
    2: 'STACK_COOKIE_CHECK_FAILURE  <- real stack/memory corruption',
    3: 'CORRUPT_LIST_ENTRY', 4: 'INCORRECT_STACK', 5: 'INVALID_ARG', 6: 'GS_COOKIE_INIT',
    7: 'FATAL_APP_EXIT  <- a deliberate abort(), NOT corruption',
    8: 'RANGE_CHECK_FAILURE', 9: 'UNSAFE_REGISTRY_ACCESS',
}

print()
print('=== EXCEPTION ===')
print('  code            : 0x%08X' % code)
print('  faulting thread : %d' % thread_id)
print('  faulting address: 0x%016X' % addr)
if code == 0xC0000409 and nparams >= 1:
    print('  fast-fail code  : %d  (%s)' % (params[0], FAST_FAIL.get(params[0], 'unmapped')))

_, rva = streams[MODULE_LIST_STREAM]
f.seek(rva)
nmods = struct.unpack('<I', f.read(4))[0]
raw = f.read(nmods * 108)
mods = []
for i in range(nmods):
    b = raw[i * 108:(i + 1) * 108]
    base, imgsize, _c, _t, name_rva = struct.unpack('<QIIII', b[:24])
    mods.append((base, imgsize, name_rva))

print()
print('=== FAULTING MODULE ===')
for base, imgsize, name_rva in mods:
    if base <= addr < base + imgsize:
        print('  %s' % mdstring(name_rva))
        print('  base 0x%016X  size 0x%X  offset +0x%X' % (base, imgsize, addr - base))
        break
else:
    print('  address is inside no loaded module (JIT/dynamic code?)')

print()
print('=== NATIVE ADDONS LOADED (of %d modules) ===' % nmods)
for base, imgsize, name_rva in mods:
    n = mdstring(name_rva)
    if n.lower().endswith('.node'):
        print('  0x%016X  %s' % (base, n))
