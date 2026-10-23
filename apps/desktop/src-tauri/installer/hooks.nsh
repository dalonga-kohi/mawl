; Mawl's installer hooks (PLAN D1.7b), wired through bundle.windows.nsis.installerHooks.
;
; Tauri's NSIS template !includes this file before it declares its own Modern UI 2 settings
; and pages, so the defines below reach MUI2 without forking the template. Only settings the
; template leaves unset belong here: redefining one it sets (MUI_ICON, MUI_FINISHPAGE_RUN,
; MUI_HEADERIMAGE_BITMAP, ...) makes makensis fail. src/installer-art/installer-art.test.ts
; keeps the list closed. Plain strings for now; a Polish option would move them to LangStrings.

; The header strip and the welcome/finish pages stay white: the header art blends into this
; color at its edges, and the themed finish-page checkboxes ignore SetCtlColors (NSIS bug
; #443), so a dark page would leave black checkbox text on a dark background.
!define MUI_BGCOLOR "FFFFFF"

; The header art reads from the right, like the porthole it shows.
!define MUI_HEADERIMAGE_RIGHT

!define MUI_WELCOMEPAGE_TITLE "Mawl is moving in"
!define MUI_WELCOMEPAGE_TEXT "This sets up Mawl for your Windows account only, so you won't need admin rights.$\r$\n$\r$\nClick Next to begin."

!define MUI_FINISHPAGE_TITLE "Mawl is all set"
!define MUI_FINISHPAGE_TEXT "Mawl is installed and ready to keep watch. You'll find it in your Start menu."
!define MUI_FINISHPAGE_RUN_TEXT "Launch Mawl"
