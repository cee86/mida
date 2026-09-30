# Windows smoke test (run by GitHub Actions after each build): opens the freshly built Mida with
# real sites, clicks and presses shortcuts like a person would, and saves screenshots, so we can
# see the real app working. Nothing here ships in the app.
param([string]$Exe = "src-tauri/target/release/mida.exe", [string]$Out = "smoke")
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force $Out | Out-Null
$config = Join-Path $env:APPDATA "report.seals.mida"
New-Item -ItemType Directory -Force $config | Out-Null

# A returning user: one Destiny 2 profile with four modules (the last one can't load, to show
# Mida's own error panel), seals.report open, window in the top-left corner.
function Settings($addressBar) {
  $bar = if ($addressBar) { "true" } else { "false" }
  return @"
{
  "version": 2,
  "firstRunDone": true,
  "profiles": [{
    "id": "p-test", "name": "Smoke test", "game": "destiny2", "activeId": "seals-report",
    "modules": [
      { "id": "seals-report", "name": "seals.report", "url": "https://d2-seals-report.vercel.app/" },
      { "id": "light-gg", "name": "light.gg", "url": "https://www.light.gg/" },
      { "id": "dim", "name": "DIM", "url": "https://app.destinyitemmanager.com/" },
      { "id": "custom-broken", "name": "Broken site", "url": "https://mida-smoke-test.invalid/" }
    ]
  }],
  "defaultProfile": "p-test",
  "currentProfile": "p-test",
  "sidebarExpanded": true,
  "window": { "x": 0, "y": 0, "width": 1000, "height": 700, "maximized": false },
  "prefs": { "showAddressBar": $bar, "controlsCorner": "top-right" }
}
"@
}

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Input {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hwnd, ref POINT p);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint f, UIntPtr e);
  public static void Click(IntPtr hwnd, int x, int y, bool right) {
    POINT p; p.X = x; p.Y = y; ClientToScreen(hwnd, ref p);
    SetCursorPos(p.X, p.Y);
    uint down = right ? 8u : 2u, up = right ? 16u : 4u;
    mouse_event(down, 0, 0, 0, UIntPtr.Zero); mouse_event(up, 0, 0, 0, UIntPtr.Zero);
  }
  public static void Keys(byte modifier, byte key) {
    if (modifier != 0) keybd_event(modifier, 0, 0, UIntPtr.Zero);
    keybd_event(key, 0, 0, UIntPtr.Zero); keybd_event(key, 0, 2, UIntPtr.Zero);
    if (modifier != 0) keybd_event(modifier, 0, 2, UIntPtr.Zero);
  }
}
"@

function Shot($name) {
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
  $bmp.Save((Join-Path $Out "$name.png"))
  Write-Host "Saved $name"
  $g.Dispose(); $bmp.Dispose()
}

function Start-Mida($addressBar) {
  [IO.File]::WriteAllText((Join-Path $config "settings.json"), (Settings $addressBar))
  $app = Start-Process -FilePath $Exe -PassThru
  Start-Sleep -Seconds 20
  # The app's own window (by process; PowerShell turns $null into "" for FindWindow, which fails).
  $hwnd = (Get-Process -Id $app.Id).MainWindowHandle
  if ($hwnd -eq [IntPtr]::Zero) { $hwnd = [Input]::FindWindow([NullString]::Value, "Mida") }
  Write-Host "Mida window found: $($hwnd -ne [IntPtr]::Zero)"
  [Input]::SetForegroundWindow($hwnd) | Out-Null
  return @($app, $hwnd)
}

# Sidebar rows (client pixels, sidebar expanded): Home 128, modules from 208, 44 apart.
$HOME_Y = 128; $ROW = @(208, 252, 296, 340)

$app, $hwnd = Start-Mida $true
Shot "01-seals-report-80pct"

[Input]::Click($hwnd, 110, $ROW[1], $false)       # light.gg
Start-Sleep -Seconds 12
Shot "02-light-gg"

[Input]::Click($hwnd, 600, 400, $false)           # keyboard inside the page
[Input]::Keys(0x11, 0x33)                         # Ctrl+3: DIM, pressed inside a site
Start-Sleep -Seconds 12
Shot "03-dim-by-shortcut"

[Input]::Click($hwnd, 110, $ROW[2], $true)        # right-click DIM: the menu overlaps the site
Start-Sleep -Seconds 2
Shot "04-module-menu-over-site"
[Input]::Keys(0, 0x1B)                            # Esc
Start-Sleep -Seconds 1

[Input]::Keys(0x11, 0xBC)                         # Ctrl+, : settings over a blurred picture of the site
Start-Sleep -Seconds 3
Shot "05-settings-over-site"
[Input]::Keys(0, 0x1B)
Start-Sleep -Seconds 1

[Input]::Click($hwnd, 110, $ROW[3], $false)       # the broken site: Mida's own error panel
Start-Sleep -Seconds 8
Shot "06-error-panel"

[Input]::Click($hwnd, 110, $HOME_Y, $false)       # Home, with the sites' icons fetched by now
Start-Sleep -Seconds 3
Shot "07-home-with-icons"

Write-Host "Still running: $(-not $app.HasExited)"
Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# Again with the address bar hidden: floating site controls in the top-right corner.
$app, $hwnd = Start-Mida $false
Shot "08-floating-controls"
Write-Host "Still running: $(-not $app.HasExited)"
Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue
