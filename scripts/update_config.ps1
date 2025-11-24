param (
    [Parameter(Mandatory = $true)]
    [string]$jsonData
)

function ConvertToHashtable($obj) {
    $ht = @{}
    foreach ($prop in $obj.PSObject.Properties) {
        $ht[$prop.Name] = $prop.Value
    }
    return $ht
}

try {
    if (-not $jsonData) { throw "No JSON data provided." }
    
    $parsed = $jsonData | ConvertFrom-Json
    $configPath = "D:\Bibliotecas\OneDrive\Scripts\Jellyfin\mods\jellyfin-mod-watchplanner-section\config\server-config.json"

    if (Test-Path $configPath) {
        $existingRaw = Get-Content -Path $configPath -Raw
        $existingObj = if ($existingRaw.Trim()) { $existingRaw | ConvertFrom-Json } else { $null }
        $serverWeekGrid = if ($existingObj.serverWeekGrid) { ConvertToHashtable($existingObj.serverWeekGrid) } else { @{} }
        $existingConfig = @{ serverWeekGrid = $serverWeekGrid }
    } else {
        $existingConfig = @{ serverWeekGrid = @{} }
    }

    foreach ($prop in $parsed.PSObject.Properties) {
        $existingConfig["serverWeekGrid"][$prop.Name] = $prop.Value
    }

    Set-Content -Path $configPath -Value ($existingConfig | ConvertTo-Json -Depth 10) -Encoding utf8 -Force
    Write-Host '{"success":true,"message":"Configuration updated successfully."}'
}
catch {
    $errMsg = $_.Exception.Message
    if (-not $errMsg) { $errMsg = $_.ToString() }
    Write-Output ('{"success":false,"message":"' + $errMsg + '"}')
    exit 1
}