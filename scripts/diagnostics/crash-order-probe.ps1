# Which process in the dev-server chain dies FIRST, and with what REAL exit code?
#
# The chain is 5-6 deep (bash -> npm -> cmd -> node/vite), and when it collapses it collapses in
# under 50ms. A 500ms sampler puts every member in the same tick and cannot order them, which is
# how "the whole tree died together" got recorded as evidence for a tree-teardown that was not
# happening. Get-Process by id needs no WMI round trip, so this samples at ~40ms.
#
# It also captures each member's NATIVE exit code. That is the number that matters: bash collapses
# every abnormal end to 127, so an external kill and a crash are indistinguishable through it.
# Touching .Handle up front is REQUIRED -- .NET can only read ExitCode afterwards if it still holds
# the native handle, and without it every code comes back blank.
#
#   powershell -File scripts/diagnostics/crash-order-probe.ps1 -Port 3003 -Out probe.log
#   # then reproduce the crash; the probe exits once the whole chain is gone
#
# Reading it:
#   leaf (vite) dies first, ancestors follow  -> vite crashed or was targeted
#   an ancestor dies first                    -> the tree is being torn down from above
#   0xFFFFFFFF = TerminateProcess(-1), i.e. an external kill (down.sh does this -- expect
#                intent=planned in the ledger); 0xC0000409 = fail-fast, check the subcode with
#                scripts/diagnostics/parse-minidump.py; small int = a real self-exit.
#
# Full narrative: docs/incidents/2026-09-01-vite-dev-server-node-stack-corruption.md
param([int]$Port = 3003, [int]$Seconds = 900, [string]$Out = 'crash-order-probe.log')

$vitePid = (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue).OwningProcess
if (-not $vitePid) { "no listener on port $Port" | Set-Content $Out; exit 1 }

# Walk from the leaf up to collect the whole chain.
$chain = @()
$id = $vitePid
for ($i = 0; $i -lt 8 -and $id; $i++) {
    $w = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue
    if (-not $w) { break }
    $c = $w.CommandLine; if ($c -and $c.Length -gt 44) { $c = $c.Substring(0, 44) }
    $chain += [pscustomobject]@{ Pid = $w.ProcessId; Cmd = $c }
    $id = $w.ParentProcessId
}

$tracked = @{}
"chain (leaf first), vite=$vitePid" | Set-Content $Out
foreach ($c in $chain) {
    "  pid=$($c.Pid)  $($c.Cmd)" | Add-Content $Out
    try {
        $p = [System.Diagnostics.Process]::GetProcessById($c.Pid)
        $null = $p.Handle          # REQUIRED so ExitCode survives the exit
        $tracked[$c.Pid] = @{ proc = $p; cmd = $c.Cmd; dead = $false }
    } catch { "  (cannot open $($c.Pid))" | Add-Content $Out }
}
"" | Add-Content $Out
"--- deaths, in order ---" | Add-Content $Out

$deadline = (Get-Date).AddSeconds($Seconds)
$remaining = $tracked.Count
while ((Get-Date) -lt $deadline -and $remaining -gt 0) {
    foreach ($k in @($tracked.Keys)) {
        $t = $tracked[$k]
        if ($t.dead) { continue }
        if ($t.proc.HasExited) {
            $t.dead = $true; $remaining--
            $code = try { $t.proc.ExitCode } catch { $null }
            $hex = if ($null -ne $code) { '0x{0:X8}' -f $code } else { 'n/a' }
            $et = try { $t.proc.ExitTime.ToString('HH:mm:ss.fff') } catch { '?' }
            "$et  pid=$k  exit=$code ($hex)  $($t.cmd)" | Add-Content $Out
        }
    }
    Start-Sleep -Milliseconds 40
}
"--- done; still alive: $remaining ---" | Add-Content $Out
