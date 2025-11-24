<#
scaffold.ps1 — generates a Jellyfin plugin project using modern plugin csproj patterns.

Example:
.\scaffold.ps1 -OutDir "D:\dev\Jellyfin.Plugin.EndpointExposer" -ProjName "Jellyfin.Plugin.EndpointExposer" -Namespace "Jellyfin.Plugin.EndpointExposer" -RouteBase "watchplanner" -ConfigFileName "watchplanner-config.json" -JellyfinVersion "10.11.2"
#>

param( 
    [string]$OutDir = "D:\Bibliotecas\OneDrive\Scripts\Jellyfin\plugins\jellyfin-plugin-endpoint-exposer", 
    [string]$ProjName = "Jellyfin.Plugin.EndpointExposer", 
    [string]$Namespace = "Jellyfin.Plugin.EndpointExposer", 
    [string]$RouteBase = "watchplanner", 
    [string]$ConfigFileName = "watchplanner-config.json", 
    [string]$TargetFramework = "net9.0",
    [string]$JellyfinVersion = "10.11.3"
)

Clear-Host
Stop-Process -Name "jellyfin" -Verbose -ErrorAction SilentlyContinue

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
  Write-Error "dotnet CLI not found. Install .NET SDK 9.0 before running this script."
  exit 1
}

# Prepare folders
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }
New-Item -ItemType Directory -Force -Path (Join-Path $OutDir "Controllers") | Out-Null

# Templates (literal here-strings; tokens replaced after)
$csprojTemplate = @'
<Project Sdk="Microsoft.NET.Sdk.Web">
    <PropertyGroup>
        <JellyfinVersion>__JELLYFINVERSION__</JellyfinVersion>
        <JellyfinNugetVersion>$(JellyfinVersion)</JellyfinNugetVersion>
        <TargetFramework>net9.0</TargetFramework>
        <OutputType>Library</OutputType>
        <GenerateProgramFile>false</GenerateProgramFile>
        <ImplicitUsings>enable</ImplicitUsings>
        <Nullable>enable</Nullable>
        <GenerateAssemblyInfo>false</GenerateAssemblyInfo>
        <Version>1.0.0.0</Version>
        <RepositoryUrl>https://example.org/</RepositoryUrl>
    </PropertyGroup>


    <ItemGroup>
        <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
        <PackageReference Include="Jellyfin.Model" Version="$(JellyfinNugetVersion)" />
        <PackageReference Include="Jellyfin.Controller" Version="$(JellyfinNugetVersion)" />
        <PackageReference Include="Jellyfin.Extensions" Version="$(JellyfinNugetVersion)" />
    </ItemGroup>
</Project>
'@

$pluginTemplate = @'
using System;
using System.IO;
using MediaBrowser.Common.Plugins;

namespace __NAMESPACE__
{
    public class Plugin : BasePlugin
    {
        public override string Name => "Endpoint Exposer";
        public override string Description => "Exposes a simple GET/POST JSON config API for plugins and clients.";

        public Plugin()
        {
            try
            {
                // Intentionally minimal. Do not resolve services, perform IO, or access DI here.
            }
            catch (Exception ex)
            {
                try
                {
                    var baseDir = AppContext.BaseDirectory ?? Environment.CurrentDirectory;
                    var path = Path.Combine(baseDir, "plugin-load-error.txt");
                    File.AppendAllText(path, $"[{DateTime.UtcNow:O}] Plugin ctor exception: {ex}{Environment.NewLine}");
                }
                catch { /* swallow to avoid double-fault */ }

                throw;
            }
        }
    }
}
'@


$controllerTemplate = @'
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using System;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;

namespace __NAMESPACE__.Controllers
{
    [ApiController]
    [Route("/__ROUTEBASE__")]
    public class ConfigController : ControllerBase
    {
        private readonly ILogger<ConfigController> _logger;
        private readonly IServiceProvider _services;
        private string? _cachedDataPath;

        public ConfigController(ILogger<ConfigController> logger, IServiceProvider services)
        {
            _logger = logger;
            _services = services;
        }

        private string ResolveDataPath()
        {
            if (_cachedDataPath != null) return _cachedDataPath;

            const string typeName = "MediaBrowser.Common.Configuration.IServerApplicationPaths, MediaBrowser.Controller";

            try
            {
                var ifaceType = Type.GetType(typeName, throwOnError: false, ignoreCase: false);

                if (ifaceType == null)
                {
                    foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
                    {
                        ifaceType = asm.GetType("MediaBrowser.Common.Configuration.IServerApplicationPaths", throwOnError: false, ignoreCase: false);
                        if (ifaceType != null) break;
                    }
                }

                if (ifaceType != null)
                {
                    var svc = _services.GetService(ifaceType);
                    if (svc != null)
                    {
                        var dataPathProp = ifaceType.GetProperty("DataPath");
                        if (dataPathProp != null)
                        {
                            var val = dataPathProp.GetValue(svc) as string;
                            if (!string.IsNullOrEmpty(val))
                            {
                                _cachedDataPath = val;
                                return _cachedDataPath;
                            }
                        }
                    }
                }

                var alt = _services.GetService(typeof(string)) as string;
                if (!string.IsNullOrEmpty(alt))
                {
                    _cachedDataPath = alt;
                    return _cachedDataPath;
                }
            }
            catch (Exception ex)
            {
                _logger?.LogWarning(ex, "Unable to resolve IServerApplicationPaths via reflection/DI");
            }

            var fallback = AppContext.BaseDirectory;
            _cachedDataPath = fallback;
            return _cachedDataPath;
        }

        private string GetConfigFilePath()
        {
            var basePath = ResolveDataPath();
            var fileName = "__CONFIGFILENAME__";
            try
            {
                return Path.Combine(basePath, fileName);
            }
            catch
            {
                return Path.Combine(AppContext.BaseDirectory, fileName);
            }
        }

        [HttpGet("config")]
        public IActionResult GetConfig()
        {
            try
            {
                var path = GetConfigFilePath();
                if (!System.IO.File.Exists(path)) return NotFound();
                var json = System.IO.File.ReadAllText(path, Encoding.UTF8);
                return new ContentResult { Content = json, ContentType = "application/json", StatusCode = StatusCodes.Status200OK };
            }
            catch (Exception ex)
            {
                _logger?.LogError(ex, "Error reading config file");
                return StatusCode(StatusCodes.Status500InternalServerError);
            }
        }

        [HttpPost("config")]
        public async Task<IActionResult> PostConfig([FromBody] JsonElement payload)
        {
            try
            {
                var user = HttpContext.Items["User"];
                if (user == null)
                {
                    if (!HttpContext.User.Identity?.IsAuthenticated ?? true) return Unauthorized();
                }
                else
                {
                    try
                    {
                        var policyProp = user.GetType().GetProperty("Policy");
                        if (policyProp != null)
                        {
                            var policy = policyProp.GetValue(user);
                            var isAdminProp = policy?.GetType().GetProperty("IsAdministrator");
                            if (isAdminProp != null)
                            {
                                var isAdmin = isAdminProp.GetValue(policy) as bool?;
                                if (isAdmin == false) return Forbid();
                            }
                        }
                    }
                    catch { }
                }

                var options = new JsonSerializerOptions { WriteIndented = true };
                var json = JsonSerializer.Serialize(payload, options);

                var path = GetConfigFilePath();
                var dir = Path.GetDirectoryName(path) ?? AppContext.BaseDirectory;
                if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);

                await System.IO.File.WriteAllTextAsync(path, json, Encoding.UTF8);
                return Ok();
            }
            catch (Exception ex)
            {
                _logger?.LogError(ex, "Error saving config file");
                return StatusCode(StatusCodes.Status500InternalServerError);
            }
        }
    }
}
'@



$readmeTemplate = @'
Generic Config API plugin scaffold

Project: __PROJ__
Namespace: __NAMESPACE__
Route base: /__ROUTEBASE__
Config file name: __CONFIGFILENAME__
JellyfinVersion: __JELLYFINVERSION__

Build:
  dotnet build -c Release

Install:
  Copy assembly from bin\Release\net9.0\ to Jellyfin plugin folder and restart Jellyfin.

Config file saved to: {JellyfinDataPath}\__CONFIGFILENAME__
'@



$metaTemplate = @'
{
  "Name": "__NAME__",
  "Id": "__ID__",
  "Version": "__VERSION__",
  "targetAbi": "__JELLYFINVERSION__",
  "Description": "__DESCRIPTION__",
  "Author": "__AUTHOR__",
  "assemblies": [ "__ASSEMBLY__" ],
  "autoUpdate": false,
  "Enable": true
}
'@





$probeTemplate = @'
using System;
using System.IO;

namespace __NAMESPACE__.Internal
{
    // Diagnostic probe that forces type initialization and logs any type-load/type-init failures.
    // Placed in an Internal namespace and named TypeProbe to avoid collisions with existing types.
    internal static class TypeProbe
    {
        static TypeProbe()
        {
            try
            {
                var asm = typeof(TypeProbe).Assembly;
                foreach (var t in asm.GetTypes())
                {
                    try
                    {
                        System.Runtime.CompilerServices.RuntimeHelpers.RunClassConstructor(t.TypeHandle);
                    }
                    catch (Exception inner)
                    {
                        // Log each type-specific exception but continue to try others
                        try
                        {
                            var baseDir = AppContext.BaseDirectory ?? Environment.CurrentDirectory;
                            var outPath = Path.Combine(baseDir, "type-load-error.txt");
                            var content = $"[{DateTime.UtcNow:O}] Type initializer exception for {t.FullName}:{Environment.NewLine}{inner}{Environment.NewLine}";
                            File.AppendAllText(outPath, content);
                        }
                        catch {}
                    }
                }
            }
            catch (Exception ex)
            {
                try
                {
                    var baseDir = AppContext.BaseDirectory ?? Environment.CurrentDirectory;
                    var outPath = Path.Combine(baseDir, "type-load-error.txt");
                    var content = $"[{DateTime.UtcNow:O}] Probe failed to enumerate types:{Environment.NewLine}{ex}{Environment.NewLine}";
                    File.AppendAllText(outPath, content);
                }
                catch {}
                throw;
            }
        }

        // No public members; class exists solely for static ctor side-effect
    }
}
'@




Remove-Item -Recurse -Force $OutDir\bin, $OutDir\obj, $OutDir\Controllers\* -ErrorAction SilentlyContinue

# Token replacement
$csproj = $csprojTemplate -replace "__JELLYFINVERSION__", $JellyfinVersion
$pluginCs = $pluginTemplate -replace "__NAMESPACE__", $Namespace
$controllerCs = $controllerTemplate -replace "__NAMESPACE__", $Namespace -replace "__ROUTEBASE__", $RouteBase -replace "__CONFIGFILENAME__", $ConfigFileName
$readme = $readmeTemplate -replace "__PROJ__", $ProjName -replace "__NAMESPACE__", $Namespace -replace "__ROUTEBASE__", $RouteBase -replace "__CONFIGFILENAME__", $ConfigFileName -replace "__JELLYFINVERSION__", $JellyfinVersion
$metaContent = $metaTemplate `
  -replace "__NAME__", [Regex]::Escape($ProjName) `
  -replace "__ID__", [Regex]::Escape($AssemblyName) `
  -replace "__VERSION__", "1.0.0.0" `
  -replace "__JELLYFINVERSION__", $JellyfinVersion `
  -replace "__DESCRIPTION__", [Regex]::Escape("Exposes a simple GET/POST JSON config API for plugins and clients.") `
  -replace "__AUTHOR__", [Regex]::Escape($env:USERNAME) `
  -replace "__ASSEMBLY__", "$ProjName.dll"

$probeContent = $probeTemplate -replace "__NAMESPACE__", $Namespace
# Write files
Set-Content -Path (Join-Path $OutDir "$ProjName.csproj") -Value $csproj -Encoding UTF8
Set-Content -Path (Join-Path $OutDir "Plugin.cs") -Value $pluginCs -Encoding UTF8
Set-Content -Path (Join-Path $OutDir "Controllers\ConfigController.cs") -Value $controllerCs -Encoding UTF8
Set-Content -Path (Join-Path $OutDir "Readme-Plugin.md") -Value $readme -Encoding UTF8
Set-Content -Path (Join-Path $OutDir "meta.json") -Value $metaContent -Encoding UTF8

Set-Content -Path (Join-Path $OutDir "Controllers\Probe.cs") -Value $probeContent -Encoding UTF8

Write-Output "Files written to $OutDir"


 
# Build
try {
    dotnet nuget locals all --clear
    dotnet restore $OutDir
    dotnet build $OutDir -c Release
} catch {
    Write-Error "Build failed. Inspect generated files in $OutDir"
    throw
}

# Get-Command "C:\Program Files\Jellyfin\Server\jellyfin.dll"
# ""

# Get-content $OutDir\Jellyfin.Plugin.EndpointExposer.csproj
# ""

# $nuget = Join-Path $env:USERPROFILE ".nuget\packages"                                                                                      
# Get-ChildItem -Path $nuget -Recurse -Filter "*.dll" |
#   ForEach-Object {
#     if (Select-String -Path $_.FullName -Pattern "IServerApplicationPaths" -SimpleMatch -Quiet) {
#       Write-Output "FOUND in NuGet DLL: $($_.FullName)"
#     }
#   }
# ""

# $pkg = Join-Path $env:USERPROFILE ".nuget\packages\jellyfin.controller\10.11.3\lib\net9.0\MediaBrowser.*.dll"
# if (Test-Path $pkg) { Write-Output "DLL exists: $pkg" } else { Write-Output "DLL missing at expected path: $pkg" }
# (Get-Command dotnet).FileVersionInfo | Select-Object FileVersion, ProductVersion
# dotnet --info
# ""

Write-Host "Scaffold complete. Built artifacts in: $(Join-Path $OutDir 'bin\Release')"

Try {

    $src = Join-Path $OutDir "bin\Release\$TargetFramework"
    $dst = Join-Path $env:LOCALAPPDATA "jellyfin\plugins\$ProjName"
    Remove-Item -Recurse -Force $dst -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $dst | Out-Null
    Start-Sleep 2
    Copy-Item -Path (Join-Path $src "Jellyfin.Plugin.EndpointExposer.dll") -Destination $dst -Force
    Copy-Item -Path (Join-Path $src "Jellyfin.Plugin.EndpointExposer.deps.json") -Destination $dst -Force
    Copy-Item -Path (Join-Path $src "Jellyfin.Plugin.EndpointExposer.pdb") -Destination $dst -ErrorAction SilentlyContinue
    Copy-Item -Path (Join-Path $src "Jellyfin.Plugin.EndpointExposer.staticwebassets.endpoints.json") -Destination $dst -ErrorAction SilentlyContinue
    
} Catch {
    $_
    Pause
    Exit
}

Get-ChildItem "C:\Users\Gustavo\AppData\Local\jellyfin\plugins\Jellyfin.Plugin.EndpointExposer\"

Start-Process -FilePath pwsh -ArgumentList "-Command & 'C:\Program Files\Jellyfin\Server\jellyfin.exe' --datadir '$env:LOCALAPPDATA\jellyfin'"