' YaoShiTong - double-click launcher (no command window)
' This script switches to the project folder, builds if needed,
' starts the preview server in the background, then opens the browser.

Set fso = CreateObject("Scripting.FileSystemObject")
Set WshShell = CreateObject("WScript.Shell")

folder = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = folder

' Show a small status window so the user knows something is happening.
Set wshShellPopup = CreateObject("WScript.Shell")
wshShellPopup.Popup "YaoShiTong is starting..." & vbCrLf & "This window will close automatically.", 2, "YaoShiTong", 64

' Build only if .next\BUILD_ID is missing.
If Not fso.FileExists(folder & "\.next\BUILD_ID") Then
  buildCmd = "cmd /c ""cd /d """ & folder & """ && npm run build"""
  returnCode = WshShell.Run(buildCmd, 1, True)
  If returnCode <> 0 Then
    WshShell.Popup "Build failed. Please open a terminal and run 'npm run build' to see the error.", 0, "YaoShiTong", 16
    WScript.Quit 1
  End If
End If

' Start the server in a hidden background window.
serverCmd = "cmd /c ""cd /d """ & folder & """ && npm run start > server.log 2>&1"""
WshShell.Run serverCmd, 0, False

' Wait for the server to be ready.
WScript.Sleep 6000

' Open browser if the server responded.
httpCode = ""
On Error Resume Next
Set http = CreateObject("Microsoft.XMLHTTP")
http.Open "GET", "http://localhost:3000", False
http.Send
httpCode = http.Status
On Error GoTo 0

If httpCode = "200" Then
  WshShell.Run "http://localhost:3000"
Else
  WshShell.Popup "The server did not start (HTTP " & httpCode & "). Check server.log in the project folder.", 0, "YaoShiTong", 48
End If
