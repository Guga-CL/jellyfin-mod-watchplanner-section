# --- Config: adjust this path to your deployed injector file ---
$InjectorPath = "$PSScriptRoot\mods\jellyfin-mod-watchplanner-section\js-injector.js"

if (-not (Test-Path $InjectorPath)) {
    Write-Error "Injector file not found: $InjectorPath"
    exit 1
}

# --- Generate token ---
$Token = [guid]::NewGuid().ToString()
Write-Host "Generated token: $Token"

# --- Read file ---
$js = Get-Content -Path $InjectorPath -Raw -ErrorAction Stop

# --- Insert token constant after the staticConfig line ---
$pattern = "const\s+staticConfig\s*=\s*base\s*\+\s*'\/watchplanner-config\.json';"
if ($js -notmatch $pattern) {
    Write-Error "Could not find staticConfig line. Aborting."
    exit 1
}

$replacement = "`$&`r`nconst token = '$Token';"
$js = [regex]::Replace($js, $pattern, $replacement, [System.Text.RegularExpressions.RegexOptions]::None)

# --- Add token to watchplanner:config dispatches ---
# Replace detail: { config: cfg, root } with detail: { config: cfg, root, token }
$js = $js -replace "detail:\s*\{\s*config:\s*cfg,\s*root\s*\}", "detail: { config: cfg, root, token }"

# --- Write back (backup first) ---
$backup = "$InjectorPath.bak.$((Get-Date).ToString('yyyyMMddHHmmss'))"
Copy-Item -Path $InjectorPath -Destination $backup -Force
Set-Content -Path $InjectorPath -Value $js -Encoding UTF8

Write-Host "Patched js-injector.js and created backup: $backup"
Write-Host "Token injected into injector. Do not commit the token to source control."
