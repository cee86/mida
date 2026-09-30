# Windows smoke test (run by GitHub Actions after each build): opens the freshly built Mida with
# three modules, clicks and presses shortcuts like a person would, and saves screenshots, so we
# can see the real sites load in the real app. Nothing here ships in the app.
param([string]$Exe = "src-tauri/target/release/mida.exe", [string]$Out = "smoke")
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force $Out | Out-Null

# Start as a returning user: three modules, seals.report open, window in the top-left corner.
$config = Join-Path $env:APPDATA "report.seals.mida"
New-Item -ItemType Directory -Force $config | Out-Null
$settings = @'
{
  "firstRunDone": true,
  "modules": [
    { "id": "seals-report", "name": "seals.report", "url": "https://d2-seals-report.vercel.app/" },
    { "id": "light-gg", "name": "light.gg", "url": "https://www.light.gg/" },
    { "id": "dim", "name": "DIM", "url": "https://app.destinyitemmanager.com/" }
  ],
  "activeId": "seals-report",
  "sidebarExpanded": true,
  "window": { "x": 0, "y": 0, "width": 1000, "height": 700, "maximized": false }
}
'@
[IO.File]::WriteAllText((Join-Path $config "settings.json"), $settings)

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
  public static void Click(IntPtr hwnd, int x, int y) {
    POINT p; p.X = x; p.Y = y; ClientToScreen(hwnd, ref p);
    SetCursorPos(p.X, p.Y); mouse_event(2, 0, 0, 0, UIntPtr.Zero); mouse_event(4, 0, 0, 0, UIntPtr.Zero);
  }
  public static void Keys(byte modifier, byte key) {
    keybd_event(modifier, 0, 0, UIntPtr.Zero); keybd_event(key, 0, 0, UIntPtr.Zero);
    keybd_event(key, 0, 2, UIntPtr.Zero); keybd_event(modifier, 0, 2, UIntPtr.Zero);
  }
}
"@

function Shot($name) {
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
  $bmp.Save((Join-Path $Out "$name.png"))
  # A rough sign of life in the log: how many different colours the site area shows.
  $colours = @{}
  for ($x = 300; $x -lt [Math]::Min(990, $b.Width); $x += 23) {
    for ($y = 120; $y -lt [Math]::Min(690, $b.Height); $y += 23) { $colours[$bmp.GetPixel($x, $y).ToArgb()] = 1 }
  }
  Write-Host "$name : $($colours.Count) colours in the site area"
  $g.Dispose(); $bmp.Dispose()
}

$app = Start-Process -FilePath $Exe -PassThru
Start-Sleep -Seconds 25
# The app's own window (by process; PowerShell turns $null into "" for FindWindow, which then fails).
$hwnd = (Get-Process -Id $app.Id).MainWindowHandle
if ($hwnd -eq [IntPtr]::Zero) { $hwnd = [Input]::FindWindow([NullString]::Value, "Mida") }
Write-Host "Mida window found: $($hwnd -ne [IntPtr]::Zero)"
[Input]::SetForegroundWindow($hwnd) | Out-Null
Shot "1-seals-report"

[Input]::Click($hwnd, 110, 155)          # light.gg in the sidebar
Start-Sleep -Seconds 15
Shot "2-light-gg"

[Input]::Click($hwnd, 600, 400)          # put the keyboard inside the light.gg page
[Input]::Keys(0x11, 0x33)                # Ctrl+3: DIM, pressed while a site has the keyboard
Start-Sleep -Seconds 15
Shot "3-dim-by-shortcut"

[Input]::Keys(0x11, 0x42)                # Ctrl+B: collapse the sidebar
Start-Sleep -Seconds 3
Shot "4-sidebar-collapsed"

[Input]::Click($hwnd, 30, 98)            # seals.report again (collapsed sidebar); instant, it stayed loaded
Start-Sleep -Seconds 2
Shot "5-back-to-seals-report"

Write-Host "Still running: $(-not $app.HasExited)"
Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue
