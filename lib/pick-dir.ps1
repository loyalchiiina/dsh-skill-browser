# dsh-skill-browser - folder picker (Windows).
# Spawned by lib/index.js with: powershell.exe -NoProfile -STA -WindowStyle Hidden -File pick-dir.ps1
# Writes the selected directory path to stdout (empty output = cancelled).
# Must stay ASCII-only to avoid any encoding pitfalls when spawned headless.
# NOTE: ShowDialog() intentionally takes NO owner argument - an invisible
# owner form anchors the modal dialog off-screen/behind and nothing appears.
Add-Type -AssemblyName System.Windows.Forms | Out-Null
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select the skill library root folder (skill library root)'
$dialog.ShowNewFolderButton = $false
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write($dialog.SelectedPath)
}
