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
  File "${PAYLOAD}\LICENSE.txt"
  File "${PAYLOAD}\DOTNET-LICENSE.txt"
  File "${PAYLOAD}\DOTNET-NOTICES.txt"
  File "${PAYLOAD}\README.txt"
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
  CreateShortcut "$SMPROGRAMS\Lingxi\Lingxi.lnk" "$INSTDIR\Lingxi.Launcher.exe" 'launch "$INSTDIR\installation"'
  CreateShortcut "$SMPROGRAMS\Lingxi\Stage updates.lnk" "$INSTDIR\Lingxi.Launcher.exe" 'stage "$INSTDIR\installation"'
  CreateShortcut "$SMPROGRAMS\Lingxi\Release credential.lnk" "$INSTDIR\Lingxi.Launcher.exe" 'credential'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Lingxi" "DisplayName" "Lingxi · 靈犀"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Lingxi" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Lingxi" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Lingxi" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Lingxi" "NoRepair" 1
complete:
SectionEnd

Section "Uninstall"
  ; A running supervising launcher cannot be removed. Fail before changing
  ; shortcuts or registration, leaving the active installation usable.
  ClearErrors
  Delete "$INSTDIR\Lingxi.Launcher.exe"
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
SectionEnd
