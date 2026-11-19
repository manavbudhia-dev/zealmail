; DeskFence (native) installer: per user, no administrator rights needed.
; Build: makensis -DEXE=path\to\DeskFence.exe -DOUT=DeskFence-Setup.exe installer.nsi

Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"

!ifndef VERSION
  !define VERSION "2.0.0"
!endif

Name "DeskFence"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\DeskFence Native"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "DeskFence ${VERSION}"

!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\DeskFenceNative"
!define MUI_ICON "app.ico"
!define MUI_UNICON "app.ico"
!define MUI_FINISHPAGE_RUN "$INSTDIR\DeskFence.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Start DeskFence now"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

; The earlier Electron DeskFence uses the same saved fences; both running at once would fight over
; them. Offer to remove it (its uninstaller keeps %APPDATA%\deskfence, so the fences stay).
Function RemoveOldVersion
  StrCpy $0 0
  loop:
    EnumRegKey $1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall" $0
    StrCmp $1 "" done
    IntOp $0 $0 + 1
    StrCmp $1 "DeskFenceNative" loop
    ReadRegStr $2 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$1" "DisplayName"
    StrCpy $3 $2 9
    StrCmp $3 "DeskFence" 0 loop
    ReadRegStr $4 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$1" "QuietUninstallString"
    StrCmp $4 "" 0 +2
      ReadRegStr $4 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$1" "UninstallString"
    StrCmp $4 "" loop
    MessageBox MB_YESNO|MB_ICONQUESTION "The earlier DeskFence ($2) is installed.$\r$\n$\r$\nRemove it now? Your fences are kept: this version uses them." IDNO loop
    nsExec::Exec 'taskkill /F /IM DeskFence.exe'
    Sleep 800
    ExecWait '$4 /S'
    Sleep 1500
    StrCpy $0 0 ; the list changed: start over
    Goto loop
  done:
FunctionEnd

Section "Install"
  ; an older copy of this version may be running: close it so the file can be replaced
  nsExec::Exec 'taskkill /F /IM DeskFence.exe'
  Sleep 500
  Call RemoveOldVersion

  SetOutPath "$INSTDIR"
  File "/oname=DeskFence.exe" "${EXE}"
  WriteUninstaller "$INSTDIR\Uninstall DeskFence.exe"

  CreateShortCut "$SMPROGRAMS\DeskFence.lnk" "$INSTDIR\DeskFence.exe"
  ; start with Windows (can be switched off in the tray menu: Settings > Start with Windows)
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "DeskFence" '"$INSTDIR\DeskFence.exe"'

  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "DeskFence (native)"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "AYPEE Industries"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\DeskFence.exe"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall DeskFence.exe"'
  WriteRegStr HKCU "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall DeskFence.exe" /S'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM DeskFence.exe'
  Sleep 500
  Delete "$INSTDIR\DeskFence.exe"
  Delete "$INSTDIR\Uninstall DeskFence.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\DeskFence.lnk"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "DeskFence"
  DeleteRegKey HKCU "${UNINST_KEY}"
  ; your fences (%APPDATA%\deskfence) and the files in Documents\DeskFence are kept
SectionEnd
