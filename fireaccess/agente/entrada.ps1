# FireAccess — mouse e teclado do Windows. Lê uma linha JSON por comando no stdin, responde "ok" ou "erro: ...".
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Entrada {
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct UNIAO { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNIAO u; }
  [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] i, int size);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  static void Enviar(INPUT i) { SendInput(1, new[] { i }, Marshal.SizeOf(typeof(INPUT))); }
  static void Mouse(uint flags, uint dado) { var i = new INPUT { type = 0 }; i.u.mi.dwFlags = flags; i.u.mi.mouseData = dado; Enviar(i); }
  static void Tecla(ushort vk, ushort scan, uint flags) { var i = new INPUT { type = 1 }; i.u.ki.wVk = vk; i.u.ki.wScan = scan; i.u.ki.dwFlags = flags; Enviar(i); }
  public static void Mover(int x, int y) { SetCursorPos(x, y); }
  public static void Clicar(int x, int y, bool direito, bool duplo) {
    SetCursorPos(x, y); System.Threading.Thread.Sleep(30);
    uint d = direito ? 0x8u : 0x2u, s = direito ? 0x10u : 0x4u;
    for (int k = 0; k < (duplo ? 2 : 1); k++) { Mouse(d, 0); Mouse(s, 0); System.Threading.Thread.Sleep(60); }
  }
  public static void Arrastar(int x1, int y1, int x2, int y2) {
    SetCursorPos(x1, y1); System.Threading.Thread.Sleep(40); Mouse(0x2, 0);
    for (int p = 1; p <= 15; p++) { SetCursorPos(x1 + (x2 - x1) * p / 15, y1 + (y2 - y1) * p / 15); System.Threading.Thread.Sleep(20); }
    Mouse(0x4, 0);
  }
  public static void Rolar(int quanto) { Mouse(0x800, unchecked((uint)(quanto * 120))); }
  public static void Digitar(string t) { foreach (char c in t) { Tecla(0, c, 0x4); Tecla(0, c, 0x4 | 0x2); } }
  public static void Combo(int[] vks) {
    foreach (var v in vks) Tecla((ushort)v, 0, 0);
    for (int k = vks.Length - 1; k >= 0; k--) Tecla((ushort)vks[k], 0, 0x2);
  }
}
"@
[Entrada]::SetProcessDPIAware() | Out-Null
[Console]::Out.WriteLine("pronto")
while ($null -ne ($linha = [Console]::In.ReadLine())) {
  try {
    $c = $linha | ConvertFrom-Json
    switch ($c.f) {
      'mover'    { [Entrada]::Mover($c.x, $c.y) }
      'clicar'   { [Entrada]::Clicar($c.x, $c.y, [bool]$c.direito, [bool]$c.duplo) }
      'arrastar' { [Entrada]::Arrastar($c.x1, $c.y1, $c.x2, $c.y2) }
      'rolar'    { if ($null -ne $c.x) { [Entrada]::Mover($c.x, $c.y) }; [Entrada]::Rolar($c.quanto) }
      'digitar'  { [Entrada]::Digitar([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($c.b64))) }
      'combo'    { [Entrada]::Combo([int[]]$c.vks) }
      default    { throw "funcao desconhecida" }
    }
    [Console]::Out.WriteLine("ok")
  } catch { [Console]::Out.WriteLine("erro: " + $_.Exception.Message) }
}
