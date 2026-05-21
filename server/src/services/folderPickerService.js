import { spawn } from 'node:child_process';

export function pickFolder() {
  return new Promise((resolve, reject) => {
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      "$dialog.ShowNewFolderButton = $true",
      "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
      "  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
      "  Write-Output $dialog.SelectedPath",
      "}"
    ].join('; ');

    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', script], {
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('close', (code) => {
      const value = stdout.trim();
      if (code === 0 && value) {
        resolve(value);
        return;
      }

      if (code === 0 && !value) {
        resolve(null);
        return;
      }

      reject(new Error(stderr.trim() || `Folder picker exited with code ${code}`));
    });
  });
}
