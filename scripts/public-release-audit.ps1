# Audits the repository for files and values that must never enter a public release.
# Run: powershell -ExecutionPolicy Bypass -File scripts/public-release-audit.ps1
# Needs: PowerShell 5.1+.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$excludedDirectories = @('.git', 'node_modules', 'dist', 'build', 'coverage')
$forbiddenExtensions = @(
  '.zip', '.tar', '.gz', '.apk', '.aab', '.jks', '.keystore', '.p12',
  '.pem', '.key', '.db', '.sqlite', '.sqlite3', '.bak', '.backup'
)

$allFiles = Get-ChildItem -LiteralPath $root -Recurse -File -Force | Where-Object {
  $relative = $_.FullName.Substring($root.Length).TrimStart('\', '/')
  $segments = $relative -split '[\\/]'
  -not ($segments | Where-Object { $excludedDirectories -contains $_ })
}

$forbiddenFiles = @($allFiles | Where-Object {
  $forbiddenExtensions -contains $_.Extension.ToLowerInvariant()
})
$privateEnvFiles = @($allFiles | Where-Object {
  $_.Name -like '.env*' -and $_.Name -notin @('.env.example', '.env.ios.example')
})

if ($forbiddenFiles.Count -gt 0 -or $privateEnvFiles.Count -gt 0) {
  throw 'Public release audit failed: forbidden binary, backup, database, key, or environment file found.'
}

$textExtensions = @(
  '.cjs', '.css', '.env', '.gradle', '.html', '.java', '.js', '.json',
  '.jsx', '.md', '.mjs', '.properties', '.ps1', '.sql', '.svg', '.ts',
  '.tsx', '.txt', '.xml', '.yaml', '.yml'
)
$textNames = @('.env.example', '.env.ios.example', '.gitattributes', '.gitignore', 'Dockerfile', 'LICENSE')
$patterns = @(
  'https://[^\s"]+\.(?:onrender\.com|supabase\.co|vercel\.app)',
  ('eyJhbGci' + 'Oi'),
  '-----BEGIN\s+(?:(?:RSA|EC|OPENSSH)\s+)?PRIVATE\s+KEY-----',
  '[A-Za-z]:\\(?:Users|chatgpt|workspaces|projects)\\',
  'gh[pousr]_[A-Za-z0-9_]{20,}',
  'sk-[A-Za-z0-9_-]{20,}',
  'sb_(?:secret|publishable)_[A-Za-z0-9_-]{16,}',
  '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
)
$safeValuePattern = '(?i)(your-project|your_|example\.|localhost|127\.0\.0\.1|users\.noreply\.github\.com|i@izs\.me|sk-provider-secret-123456789)'
# Explicit fictional iOS compile/test values, never production credentials.
$safeValuePattern += '|ios-ci\.supabase\.co|dengtatest\.supabase\.co|sb_publishable_ci_build_not_for_auth|sb_publishable_local_test_public_value'
$unsafeLocations = New-Object 'System.Collections.Generic.List[string]'

foreach ($file in $allFiles) {
  if (
    -not ($textExtensions -contains $file.Extension.ToLowerInvariant()) -and
    -not ($textNames -contains $file.Name)
  ) {
    continue
  }

  $lineNumber = 0
  foreach ($line in [System.IO.File]::ReadLines($file.FullName)) {
    $lineNumber += 1
    foreach ($pattern in $patterns) {
      foreach ($match in [regex]::Matches($line, $pattern)) {
        if ($match.Value -notmatch $safeValuePattern) {
          $relative = $file.FullName.Substring($root.Length).TrimStart('\', '/')
          $unsafeLocations.Add("${relative}:$lineNumber")
        }
      }
    }
  }
}

if ($unsafeLocations.Count -gt 0) {
  Write-Output 'Unsafe pattern locations (values intentionally hidden):'
  $unsafeLocations | Sort-Object -Unique | ForEach-Object { Write-Output "- $_" }
  throw 'Public release audit failed: a production endpoint, credential, private path, or personal email pattern was found.'
}

Write-Output 'Public release audit passed.'
