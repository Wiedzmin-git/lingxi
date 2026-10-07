Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"

!ifndef PAYLOAD
  !error "PAYLOAD must contain the independently published launcher, notices and desktop.zip"
!endif
!ifndef BUNDLE_SHA256
  !error "BUNDLE_SHA256 is required"
!endif
!ifndef BUNDLE_BYTES
  !error "BUNDLE_BYTES is required"
!endif
!ifndef OUTPUT
  !error "OUTPUT is required"
!endif

Name "Lingxi · 靈犀"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\Lingxi"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
Var Portable

!define MUI_ICON "${__FILEDIR__}\..\desktop\icons\lingxi\icon.ico"
!define MUI_UNICON "${__FILEDIR__}\..\desktop\icons\lingxi\icon.ico"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${PAYLOAD}\LICENSE.txt"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/PORTABLE" $1
  StrCpy $Portable "0"
  IfErrors +2 0
  StrCpy $Portable "1"
FunctionEnd

Section "Lingxi"
  StrCmp $Portable "1" ownershipChecked
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Lingxi" "InstallLocation"
  StrCmp $0 "" ownershipChecked
  GetFullPathName $0 $0
  GetFullPathName $1 $INSTDIR
  StrCmp $0 $1 ownershipChecked
  SetErrorLevel 1
  Abort "Lingxi is registered in another directory. Use that installation or /PORTABLE; setup does not move profiles."
ownershipChecked:
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=Lingxi.Setup.exe "${PAYLOAD}\Lingxi.Launcher.exe"
  File /oname=desktop.zip "${PAYLOAD}\desktop.zip"
  SetOutPath "$INSTDIR"
  ; Existing launchers are updated manually. Staging runs through this payload's
  ; temporary helper, so an active supervising launcher is never replaced.
  IfFileExists "$INSTDIR\Lingxi.Launcher.exe" launcherInstalled
  File "${PAYLOAD}\Lingxi.Launcher.exe"
launcherInstalled:
  IfFileExists "$INSTDIR\Lingxi.Start.exe" guiInstalled
  File "${PAYLOAD}\Lingxi.Start.exe"
guiInstalled:
  File "${PAYLOAD}\LICENSE.txt"
  File "${PAYLOAD}\DOTNET-LICENSE.txt"
  File "${PAYLOAD}\DOTNET-NOTICES.txt"
  File "${PAYLOAD}\README.txt"
  File /oname=Lingxi.ico "${__FILEDIR__}\..\desktop\icons\lingxi\icon.ico"
  IfFileExists "$INSTDIR\installation\installation.json" stage 0
  nsExec::ExecToLog '"$PLUGINSDIR\Lingxi.Setup.exe" initialize-new "$INSTDIR\installation" "$INSTDIR\profile" dev'
  Pop $0
  StrCmp $0 "0" stage failed
stage:
  nsExec::ExecToLog '"$PLUGINSDIR\Lingxi.Setup.exe" stage-local "$INSTDIR\installation" "$PLUGINSDIR\desktop.zip" ${BUNDLE_SHA256} ${BUNDLE_BYTES}'
  Pop $0
  StrCmp $0 "0" installed failed
failed:
  SetErrorLevel 1
  Abort "Lingxi setup could not initialize or stage the bundle. Existing profile data was retained; see details above."
installed:
  SetOutPath "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  StrCmp $Portable "1" complete
  CreateDirectory "$SMPROGRAMS\Lingxi"
   ; The immutable bundle carries the matching recovery-capable supervisor.
   ; Existing running/root entrypoints remain untouched during staging.
   CreateShortcut "$SMPROGRAMS\Lingxi\Lingxi.lnk" "$INSTDIR\installation\bundles\${BUNDLE_SHA256}\resources\lingxi-updater\Lingxi.Start.exe" '"$INSTDIR\installation"' "$INSTDIR\Lingxi.ico"
   CreateShortcut "$SMPROGRAMS\Lingxi\Stage updates.lnk" "$INSTDIR\installation\bundles\${BUNDLE_SHA256}\resources\lingxi-updater\Lingxi.Launcher.exe" 'stage-interactive "$INSTDIR\installation"' "$INSTDIR\Lingxi.ico"
  CreateShortcut "$SMPROGRAMS\Lingxi\Release credential.lnk" "$INSTDIR\Lingxi.Launcher.exe" 'credential' "$INSTDIR\Lingxi.ico"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Lingxi" "DisplayName" "Lingxi · 靈犀"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Lingxi" "DisplayIcon" "$INSTDIR\Lingxi.ico"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Lingxi" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Lingxi" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Lingxi" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Lingxi" "NoRepair" 1
complete:
SectionEnd

Section "Uninstall"
   ; Hold the same installation launch lock through removal. This also covers
   ; supervisors launched from immutable bundles, not just the root executable.
   ClearErrors
   FileOpen $2 "$INSTDIR\installation\launch.lock" a
   IfErrors inUse
  ; A running supervising launcher cannot be removed. Fail before changing
  ; shortcuts or registration, leaving the active installation usable.
  ; Probe the GUI supervisor before deleting either entrypoint. Opening for
  ; append writes no bytes but fails while Windows maps this executable.
  IfFileExists "$INSTDIR\Lingxi.Start.exe" 0 guiNotRunning
  ClearErrors
  FileOpen $0 "$INSTDIR\Lingxi.Start.exe" a
  IfErrors inUse
  FileClose $0
guiNotRunning:
  ClearErrors
  Delete "$INSTDIR\Lingxi.Launcher.exe"
  IfErrors inUse
  Delete "$INSTDIR\Lingxi.Start.exe"
  IfErrors inUse
  ; Messages, descriptors, launch journals and immutable bundles remain in place.
  ; Remove global registration only if this is the recorded installation.
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Lingxi" "InstallLocation"
  StrCmp $0 "$INSTDIR" 0 local
  Delete "$SMPROGRAMS\Lingxi\Lingxi.lnk"
  Delete "$SMPROGRAMS\Lingxi\Stage updates.lnk"
  Delete "$SMPROGRAMS\Lingxi\Release credential.lnk"
  RMDir "$SMPROGRAMS\Lingxi"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Lingxi"
local:
  Delete "$INSTDIR\Lingxi.ico"
  Delete "$INSTDIR\LICENSE.txt"
  Delete "$INSTDIR\DOTNET-LICENSE.txt"
  Delete "$INSTDIR\DOTNET-NOTICES.txt"
  Delete "$INSTDIR\README.txt"
  Delete "$INSTDIR\Uninstall.exe"
  Goto uninstallComplete
inUse:
  SetErrorLevel 1
  Abort "Lingxi launcher could not be removed. Close Lingxi before uninstalling; the installation was retained."
uninstallComplete:
   FileClose $2
SectionEnd
