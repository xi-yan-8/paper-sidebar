' Paper Sidebar - Auto-Start Launcher (silent, no console window)
Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

scriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)

' Ensure dependencies exist
If Not FSO.FolderExists(scriptDir & "\node_modules") Then
    WshShell.Run "cmd /c cd /d """ & scriptDir & """ && npm install", 0, True
End If

' Launch server — cmd wrapper ensures correct working directory
WshShell.Run "cmd /c cd /d """ & scriptDir & """ && node server/index.js", 0, False
