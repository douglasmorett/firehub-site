# Mãos no Windows para as gravações "ao vivo" (tela de verdade, com a barra do
# navegador, o quebra-cabeça das extensões e a janelinha delas — o que a
# captura por página não mostra). Lê um comando JSON por linha e responde uma
# linha JSON. Quem fala com ele é tutoriais/ao-vivo/mesa.mjs.
#
#   {"cmd":"mover","x":100,"y":200,"ms":600}      seta até o ponto, suave
#   {"cmd":"clicar"} / {"cmd":"rolar","delta":-240}
#   {"cmd":"digitar","texto":"oi","ms":80}         letra por letra (aceita acento)
#   {"cmd":"tecla","nome":"ENTER"}                 ENTER, TAB, ESC, BACK, CTRLA
#   {"cmd":"achar","nome":"Extensões","pid":123}   retângulo de um elemento pela acessibilidade do Windows
#   {"cmd":"listar","pid":123}                     nomes dos botões (para descobrir o que achar)
#   {"cmd":"direito"}                              clique com o botão direito
#   {"cmd":"atalho","vks":[17,78]}                 aperta as teclas na ordem e solta ao contrário (Ctrl+N)
#   {"cmd":"janelas","pid":123}                    janelas de cima do processo: hwnd, nome, retângulo
#   {"cmd":"posicionar","hwnd":1,"x":0,"y":0,"w":800,"h":600}   tira do maximizado e põe a janela no lugar
#   {"cmd":"valores","hwnd":1}                     campos de texto da janela com o valor (o prazo do iFood)
#   {"cmd":"cor","x":10,"y":20}                   cor do ponto da tela (a chave do robô: verde = ligada)
#   achar/listar aceitam "hwnd" no lugar de "pid" para olhar uma janela só
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class Maos {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out PONTO p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, int dados, UIntPtr extra);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint n, ENTRADA[] e, int tam);
  [StructLayout(LayoutKind.Sequential)] public struct PONTO { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct TECLADO { public ushort vk; public ushort scan; public uint flags; public uint tempo; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEI { public int dx; public int dy; public uint dados; public uint flags; public uint tempo; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] public struct UNIAO { [FieldOffset(0)] public MOUSEI m; [FieldOffset(0)] public TECLADO k; }
  [StructLayout(LayoutKind.Sequential)] public struct ENTRADA { public uint tipo; public UNIAO u; }
  static double Suave(double t) { return t < 0.5 ? 2*t*t : 1 - Math.Pow(-2*t + 2, 2) / 2; }
  public static void Mover(int x, int y, int ms) {
    PONTO p; GetCursorPos(out p);
    var inicio = DateTime.Now;
    while (true) {
      double k = (DateTime.Now - inicio).TotalMilliseconds / Math.Max(1, ms);
      if (k >= 1) break;
      double s = Suave(k);
      SetCursorPos((int)(p.X + (x - p.X) * s), (int)(p.Y + (y - p.Y) * s));
      Thread.Sleep(8);
    }
    SetCursorPos(x, y);
  }
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int alt, bool redesenhar);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr depois, int x, int y, int w, int alt, uint flags);
  // Põe a janela por cima das outras (passa por "sempre visível" e volta): o
  // Windows não deixa um processo de fundo roubar o foco, mas deixa reordenar.
  public static void Frente(IntPtr h) { SetWindowPos(h, new IntPtr(-1), 0, 0, 0, 0, 0x0003 | 0x0040); SetWindowPos(h, new IntPtr(-2), 0, 0, 0, 0, 0x0003 | 0x0040); }
  public static void Direito() { mouse_event(0x0008, 0, 0, 0, UIntPtr.Zero); Thread.Sleep(70); mouse_event(0x0010, 0, 0, 0, UIntPtr.Zero); }
  public static void Atalho(int[] vks) { foreach (var v in vks) Vk((ushort)v, false); Thread.Sleep(30); for (int i = vks.Length - 1; i >= 0; i--) Vk((ushort)vks[i], true); }
  public static void Clicar() { mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero); Thread.Sleep(70); mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero); }
  public static void Rolar(int delta) { mouse_event(0x0800, 0, 0, delta, UIntPtr.Zero); }
  static void Unicode(char c, bool solta) {
    var e = new ENTRADA[1]; e[0].tipo = 1; e[0].u.k.vk = 0; e[0].u.k.scan = c; e[0].u.k.flags = 0x0004 | (solta ? 0x0002u : 0u);
    SendInput(1, e, Marshal.SizeOf(typeof(ENTRADA)));
  }
  public static void Digitar(string texto, int ms) { foreach (char c in texto) { Unicode(c, false); Unicode(c, true); Thread.Sleep(ms); } }
  static void Vk(ushort vk, bool solta) {
    var e = new ENTRADA[1]; e[0].tipo = 1; e[0].u.k.vk = vk; e[0].u.k.flags = solta ? 0x0002u : 0u;
    SendInput(1, e, Marshal.SizeOf(typeof(ENTRADA)));
  }
  public static void Tecla(string nome) {
    if (nome == "CTRLA") { Vk(0x11, false); Vk(0x41, false); Vk(0x41, true); Vk(0x11, true); return; }
    ushort vk = nome == "ENTER" ? (ushort)0x0D : nome == "TAB" ? (ushort)0x09 : nome == "ESC" ? (ushort)0x1B : nome == "BACK" ? (ushort)0x08 : (ushort)0;
    if (vk == 0) throw new Exception("tecla desconhecida: " + nome);
    Vk(vk, false); Vk(vk, true);
  }
}
"@

function Janelas([int]$procId) {
  $raiz = [System.Windows.Automation.AutomationElement]::RootElement
  $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $procId)
  return $raiz.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
}

function Alvos($pedido) {
  if ($pedido.hwnd) { return @([System.Windows.Automation.AutomationElement]::FromHandle([IntPtr][long]$pedido.hwnd)) }
  $alvos = @()
  foreach ($procId in @($pedido.pid)) { foreach ($j in (Janelas $procId)) { $alvos += $j } }
  return $alvos
}

function Achar($pedido) {
  $alvos = Alvos $pedido
  if ($pedido.janela) { $alvos = @($alvos | Where-Object { $_.Current.Name -like "*$($pedido.janela)*" }) }
  foreach ($j in $alvos) {
    $todos = $j.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($el in $todos) {
      $nome = $el.Current.Name
      if (-not $nome) { continue }
      $bate = if ($pedido.exato) { $nome -eq $pedido.nome } else { $nome -like "*$($pedido.nome)*" }
      if (-not $bate) { continue }
      if ($pedido.tipo -and $el.Current.LocalizedControlType -notlike "*$($pedido.tipo)*" -and $el.Current.ControlType.ProgrammaticName -notlike "*$($pedido.tipo)*") { continue }
      $r = $el.Current.BoundingRectangle
      if ($r.Width -le 0 -or $r.Height -le 0) { continue }
      return @{ ok = $true; nome = $nome; x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height; tipo = $el.Current.ControlType.ProgrammaticName }
    }
  }
  return @{ ok = $false; erro = "não achei: $($pedido.nome)" }
}

function Listar($pedido) {
  $saida = @()
  foreach ($procId in @(1)) {
    foreach ($j in (Alvos $pedido)) {
      $todos = $j.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
      foreach ($el in $todos) {
        $t = $el.Current.ControlType.ProgrammaticName
        if ($pedido.tipo -and $t -notlike "*$($pedido.tipo)*") { continue }
        $r = $el.Current.BoundingRectangle
        if ($el.Current.Name -and $r.Width -gt 0) { $saida += ("{0} | {1} | {2},{3} {4}x{5} | {6}" -f $t, $el.Current.Name, [int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height, $j.Current.Name) }
      }
    }
  }
  return @{ ok = $true; itens = $saida }
}

function ListarJanelas($pedido) {
  $saida = @()
  foreach ($j in (Janelas ([int]$pedido.pid))) {
    $r = $j.Current.BoundingRectangle
    if ($r.IsEmpty -or [double]::IsInfinity($r.Width)) { $saida += @{ hwnd = $j.Current.NativeWindowHandle; nome = $j.Current.Name; oculta = $true }; continue }
    $saida += @{ hwnd = $j.Current.NativeWindowHandle; nome = $j.Current.Name; x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height }
  }
  return @{ ok = $true; janelas = $saida }
}

function Valores($pedido) {
  $j = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr][long]$pedido.hwnd)
  $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
  $saida = @()
  foreach ($el in $j.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)) {
    $r = $el.Current.BoundingRectangle
    if ($r.Width -le 0) { continue }
    $v = $null
    try { $v = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value } catch {}
    $saida += @{ nome = $el.Current.Name; valor = $v; x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height }
  }
  return @{ ok = $true; campos = $saida }
}

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
# Nome com acento ("Adicionar extensão") chega do Node em UTF-8; lido na página
# de código do Windows, virava "extens├úo" e nunca casava.
$entrada = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), (New-Object System.Text.UTF8Encoding($false)))
while ($true) {
  $linha = $entrada.ReadLine()
  if ($null -eq $linha) { break }
  try {
    $p = $linha | ConvertFrom-Json
    switch ($p.cmd) {
      "mover"   { [Maos]::Mover([int]$p.x, [int]$p.y, [int]$p.ms); $r = @{ ok = $true } }
      "clicar"  { [Maos]::Clicar(); $r = @{ ok = $true } }
      "rolar"   { [Maos]::Rolar([int]$p.delta); $r = @{ ok = $true } }
      "digitar" { [Maos]::Digitar([string]$p.texto, [int]$p.ms); $r = @{ ok = $true } }
      "tecla"   { [Maos]::Tecla([string]$p.nome); $r = @{ ok = $true } }
      "achar"   { $r = Achar $p }
      "listar"  { $r = Listar $p }
      "direito" { [Maos]::Direito(); $r = @{ ok = $true } }
      "atalho"  { [Maos]::Atalho([int[]]$p.vks); $r = @{ ok = $true } }
      "janelas" { $r = ListarJanelas $p }
      "valores" { $r = Valores $p }
      "cor"     { $b = New-Object System.Drawing.Bitmap 1, 1; $g = [System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen([int]$p.x, [int]$p.y, 0, 0, (New-Object System.Drawing.Size 1, 1)); $c = $b.GetPixel(0, 0); $g.Dispose(); $b.Dispose(); $r = @{ ok = $true; r = $c.R; g = $c.G; b = $c.B } }
      "posicionar" { $h = [IntPtr][long]$p.hwnd; [Maos]::ShowWindow($h, 9) | Out-Null; Start-Sleep -Milliseconds 150; [Maos]::MoveWindow($h, [int]$p.x, [int]$p.y, [int]$p.w, [int]$p.h, $true) | Out-Null; [Maos]::Frente($h); $r = @{ ok = $true } }
      default   { $r = @{ ok = $false; erro = "comando desconhecido" } }
    }
  } catch { $r = @{ ok = $false; erro = $_.Exception.Message } }
  [Console]::Out.WriteLine(($r | ConvertTo-Json -Compress -Depth 4))
  [Console]::Out.Flush()
}
