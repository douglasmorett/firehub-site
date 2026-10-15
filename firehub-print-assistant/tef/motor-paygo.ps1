# Motor TEF do Assistente FireHub (PayGo Web).
#
# O Assistente sobe ESTE script no PowerShell de 32 bits
#   %SystemRoot%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe
# (ou no de 64, se tef.json disser "arquitetura": "x64"), porque o processo
# precisa ter a MESMA arquitetura da PGWebLib.dll do kit.
#
# Compila PayGoHost.cs com Add-Type (C# 5, .NET Framework 4 do Windows) e
# entrega stdin/stdout para ele: JSON, uma mensagem por linha. Nada aqui
# escreve no stdout além do PayGoHost — qualquer texto solto quebraria o
# protocolo; erros vão para o stderr, que o Assistente guarda no log.
param([string]$Fonte)
$ErrorActionPreference = 'Stop'
try {
  Add-Type -TypeDefinition ([System.IO.File]::ReadAllText($Fonte)) -ReferencedAssemblies 'System.Web.Extensions' | Out-Null
} catch {
  [Console]::Error.WriteLine("Add-Type do PayGoHost falhou: " + $_.Exception.Message)
  exit 3
}
[PayGoHost]::Rodar()
