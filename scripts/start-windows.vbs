Option Explicit
Dim shell, files, root
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(files.GetParentFolderName(WScript.ScriptFullName))
shell.CurrentDirectory = root
shell.Environment("PROCESS").Item("TERMINAL_SERVE_HOSTS") = "shang.tailc2493b.ts.net:18443,shang.tailc2493b.ts.net"
shell.Run "node """ & root & "\scripts\start.mjs"" --lan --no-open --background --dev", 0, False
