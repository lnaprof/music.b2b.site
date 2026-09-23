# ============================================================
#  Demo audio generator (no Node / no external deps)
#  Produces 3 genres x 2 versions (BEFORE / AFTER) as WAV PCM.
#  BEFORE: quieter, duller. AFTER: louder, brighter/cleaner.
#  Run:  powershell -ExecutionPolicy Bypass -File tools\generate-audio.ps1
# ============================================================
$ErrorActionPreference = 'Stop'
$SR = 22050

$outDir = Join-Path $PSScriptRoot '..\public\audio'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

# ------------------------------------------------------------
# tone oscillator
function New-Tone {
    param([double]$Freq, [double]$Dur, [string]$Type, [bool]$Bright)
    $n = [Math]::Max(1, [int]([Math]::Floor($Dur * $SR))) + 2
    $arr = New-Object 'double[]' $n
    for ($i = 0; $i -lt $n; $i++) {
        $t = $i / $SR
        $ph = 2 * [Math]::PI * $Freq * $t
        switch ($Type) {
            'sine'   { $v = [Math]::Sin($ph) }
            'tri'    { $v = (2 / [Math]::PI) * [Math]::Asin([Math]::Sin($ph)) }
            'saw'    { $v = 2 * (($Freq * $t) % 1) - 1 }
            'square' { $v = [Math]::Sign([Math]::Sin($ph)) }
            default  { $v = [Math]::Sin($ph) }
        }
        if ($Bright) {
            $v = 0.55 * $v + 0.45 * [Math]::Sin(2 * $ph)
        }
        $arr[$i] = $v
    }
    return , $arr
}

# ------------------------------------------------------------
# envelope: exp attack, linear release
function Set-Env {
    param([double[]]$A, [double]$AtkSec, [double]$RelSec)
    $n = $A.Length
    $atk = [int]([Math]::Floor($AtkSec * $SR))
    $rel = [int]([Math]::Floor($RelSec * $SR))
    for ($i = 0; $i -lt $n; $i++) {
        $e = 1.0
        if ($atk -gt 0 -and $i -lt $atk) {
            $e = 1 - [Math]::Exp(-5 * $i / $atk)
        }
        if ($rel -gt 0 -and $i -ge ($n - $rel)) {
            $e *= (($n - 1 - $i) / $rel)
        }
        $A[$i] *= $e
    }
}

# ------------------------------------------------------------
# decaying noise burst (hats / snare)
function New-Noise {
    param([double]$Dur, [double]$Decay)
    $n = [int]([Math]::Floor($Dur * $SR)) + 2
    $arr = New-Object 'double[]' $n
    $r = New-Object System.Random(7)
    for ($i = 0; $i -lt $n; $i++) {
        $arr[$i] = ($r.NextDouble() * 2 - 1) * [Math]::Exp(-$Decay * $i / $n)
    }
    return , $arr
}

# ------------------------------------------------------------
# kick drum: pitch sweep sine with fast decay
function New-Kick {
    param([double]$Dur)
    $n = [int]([Math]::Floor($Dur * $SR)) + 2
    $arr = New-Object 'double[]' $n
    $ph = 0.0
    for ($i = 0; $i -lt $n; $i++) {
        $t = $i / $SR
        $f = 46 + 145 * [Math]::Exp(-22 * $t)
        $ph += 2 * [Math]::PI * $f / $SR
        $arr[$i] = [Math]::Sin($ph) * [Math]::Exp(-11 * $t)
    }
    return , $arr
}

# ------------------------------------------------------------
# add a note into the master bus
function Add-Note {
    param([double[]]$Master, [double[]]$Note, [double]$StartSec, [double]$Amp)
    $start = [int]([Math]::Floor($StartSec * $SR))
    if ($start -lt 0) { $start = 0 }
    for ($i = 0; $i -lt $Note.Length; $i++) {
        $idx = $start + $i
        if ($idx -ge $Master.Length) { break }
        $Master[$idx] += $Note[$i] * $Amp
    }
}

# ------------------------------------------------------------
# write normalized WAV (16-bit PCM mono)
function Save-Wav {
    param([string]$Path, [double[]]$Master, [double]$Gain, [double]$PeakTarget)
    $peak = 0.0
    foreach ($s in $Master) {
        $a = [Math]::Abs($s)
        if ($a -gt $peak) { $peak = $a }
    }
    if ($peak -le 0.000001) { $scale = 0 } else { $scale = ($PeakTarget / $peak) * $Gain }
    $n = $Master.Length
    $dataSize = $n * 2
    $ms = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter($ms)
    $bw.Write([byte[]][System.Text.Encoding]::ASCII.GetBytes('RIFF'))
    $bw.Write([int](36 + $dataSize))
    $bw.Write([byte[]][System.Text.Encoding]::ASCII.GetBytes('WAVE'))
    $bw.Write([byte[]][System.Text.Encoding]::ASCII.GetBytes('fmt '))
    $bw.Write([int]16)
    $bw.Write([int16]1)
    $bw.Write([int16]1)
    $bw.Write([int]$SR)
    $bw.Write([int]($SR * 2))
    $bw.Write([int16]2)
    $bw.Write([int16]16)
    $bw.Write([byte[]][System.Text.Encoding]::ASCII.GetBytes('data'))
    $bw.Write([int]$dataSize)
    for ($i = 0; $i -lt $n; $i++) {
        $v = $Master[$i] * $scale
        if ($v -gt 1) { $v = 1 } elseif ($v -lt -1) { $v = -1 }
        $bw.Write([int16]([Math]::Round($v * 32767)))
    }
    $bw.Flush()
    [System.IO.File]::WriteAllBytes($Path, $ms.ToArray())
    $bw.Dispose()
    $ms.Dispose()
    Write-Host ("  wrote {0}  ({1:N0} samples)" -f (Split-Path $Path -Leaf), $n)
}

# ============================================================
# 1) Electro House
# ============================================================
function New-Electro {
    param([bool]$Bright)
    $bpm = 124
    $beat = 60.0 / $bpm
    $beats = 20
    $dur = $beats * $beat + 0.8
    $master = New-Object 'double[]' ([int]($dur * $SR) + 1)

    # bass sequence (roots in Hz), one per eighth note
    $roots = @(55, 55, 65.4, 49, 55, 55, 65.4, 49, 55, 82.4, 49, 73.4, 55, 55, 65.4, 49, 55, 49, 65.4, 98)
    $hair  = @(220.0, 261.6, 293.7, 329.6, 392.0, 440.0, 329.6, 293.7, 261.6, 220.0) # lead arp
    for ($b = 0; $b -lt $beats; $b++) {
        $t0 = $b * $beat
        Add-Note $master (New-Kick 0.22) $t0 0.95
        # hat on offbeats
        Add-Note $master (New-Noise 0.055 9.0) ($t0 + $beat / 2) $(if ($Bright) { 0.28 } else { 0.16 })
        # bass eighths
        $r = $roots[$b % $roots.Length]
        $r2 = $r * 2
        $bass = New-Tone $r2 ($beat * 0.48) 'saw' $Bright
        Set-Env $bass 0.004 0.10
        Add-Note $master $bass $t0 $(if ($Bright) { 0.55 } else { 0.40 })
        # lead 16ths arpeggio
        for ($s = 0; $s -lt 4; $s++) {
            $f = $hair[($b * 4 + $s) % $hair.Length]
            $lead = New-Tone $f ($beat * 0.22) 'tri' $Bright
            Set-Env $lead 0.003 0.06
            Add-Note $master $lead ($t0 + $s * $beat / 4) 0.30
        }
    }
    if (-not $Bright) { Save-Wav $outDir'\electro-before.wav' $master 0.95 0.46 }
    else              { Save-Wav $outDir'\electro-after.wav'  $master 1.20 0.92 }
}

# ============================================================
# 2) Rock / Indie
# ============================================================
function New-Rock {
    param([bool]$Bright)
    $bpm = 120
    $beat = 0.5
    $beats = 20
    $dur = $beats * $beat + 0.8
    $master = New-Object 'double[]' ([int]($dur * $SR) + 1)
    $chords = @(82.4, 110.0, 130.8, 98.0) # E2 A2 C3 G2 power-chord roots
    for ($b = 0; $b -lt $beats; $b++) {
        $t0 = $b * $beat
        $bar = [int][Math]::Floor($b / 4)
        $root = $chords[$bar % $chords.Length]
        $root5 = $root * 1.5
        # chugging 8th-note power chords (root + fifth)
        for ($s = 0; $s -lt 2; $s++) {
            $ch = New-Tone $root5 ($beat * 0.42) 'square' $Bright
            Set-Env $ch 0.005 0.16
            Add-Note $master $ch ($t0 + $s * $beat / 2) $(if ($Bright) { 0.60 } else { 0.42 })
        }
        # kick every beat, snare on 2 & 4
        Add-Note $master (New-Kick 0.20) $t0 0.95
        $beatsInBar = $b % 4
        if ($beatsInBar -eq 1 -or $beatsInBar -eq 3) {
            Add-Note $master (New-Noise 0.16 7.0) $t0 0.55
        }
    }
    if (-not $Bright) { Save-Wav $outDir'\rock-before.wav' $master 0.95 0.46 }
    else              { Save-Wav $outDir'\rock-after.wav'  $master 1.25 0.92 }
}

# ============================================================
# 3) Ambient / Score
# ============================================================
function New-Ambient {
    param([bool]$Bright)
    $dur = 13.5
    $master = New-Object 'double[]' ([int]($dur * $SR) + 1)
    $roots = @(65.4, 51.9, 43.65, 49.0)   # C2 Ab1 F1 G1
    $seg   = $dur / $roots.Length
    for ($k = 0; $k -lt $roots.Length; $k++) {
        $t0 = $k * $seg
        $r  = $roots[$k]
        $r2 = $r * 2
        $r3 = $r * 3
        $r4 = $r * 4
        $r6 = $r * 6
        $rD = $r * 1.006
        $parts = @($r, $r2, $r3, $r4, $r6)
        foreach ($p in $parts) {
            $pad = New-Tone $p ($seg + 1.6) 'tri' $Bright
            Set-Env $pad 1.3 2.4
            Add-Note $master $pad $t0 $(if ($Bright) { 0.32 } else { 0.24 })
            # slight detune layer for width
            $pad2 = New-Tone $rD ($seg + 1.6) 'sine' $Bright
            Set-Env $pad2 1.4 2.4
            Add-Note $master $pad2 $t0 $(if ($Bright) { 0.20 } else { 0.12 })
        }
        # sparse high shimmer
        $sf1 = $r * 8
        $sf2 = $r * 10.7
        foreach ($sf in @($sf1, $sf2)) {
            $sh = New-Tone $sf ($seg * 0.9) 'sine' $Bright
            Set-Env $sh 2.0 2.2
            Add-Note $master $sh ($t0 + $seg * 0.35) $(if ($Bright) { 0.16 } else { 0.08 })
        }
    }
    if (-not $Bright) { Save-Wav $outDir'\ambient-before.wav' $master 0.95 0.42 }
    else              { Save-Wav $outDir'\ambient-after.wav'  $master 1.25 0.90 }
}

Write-Host 'Generating demo audio...'
Write-Host 'Electro:'
New-Electro $false
New-Electro $true
Write-Host 'Rock:'
New-Rock $false
New-Rock $true
Write-Host 'Ambient:'
New-Ambient $false
New-Ambient $true
Write-Host 'Done.'