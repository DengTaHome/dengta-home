#requires -Version 5.1
<#
DengTa v2.13.69 (327) GitHub Push + Release APK Upload + Live Production Health Gate

Beginner-friendly GUI mode:
  Double-click D:\GZdeepseek\dengta-home\tools\点我一键同步GitHub-v2.13.69.cmd
  - Zero Chinese mojibake (UTF-8 BOM + UTF-8 console + native Windows Forms dialog)
  - Zero PowerShell 5.1 git stderr NativeCommandError bug (Invoke-GitSafe checks $LASTEXITCODE)
  - Zero Ctrl+V control-character bug (one-click clipboard paste + token format check)

Non-interactive mode:
  $env:GH_TOKEN = "<Jessica-tce PAT>"
  powershell -ExecutionPolicy Bypass -File D:\GZdeepseek\dengta-home\tools\complete-github-release-v2.13.69.ps1
#>
param(
  [string]$GithubToken = $env:GH_TOKEN,
  [string]$GithubUser = "Jessica-tce"
)

$ErrorActionPreference = "Stop"
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Git = "D:\GZdeepseek\_tools\git\cmd\git.exe"
$Node = "D:\GZdeepseek\_tools\node\node.exe"
$ApkPath = "D:\GZdeepseek\apk-build\DengTa-2.13.69.apk"
$ExpectedSha256 = "44af08481451f66949a27f7ffb099cf26ed1746b2f584dbb9b9b9f1dd9bdb5bf"
$ExpectedSize = 38954594
$VersionName = "2.13.69"
$VersionCode = 327
$TokenCreateUrl = "https://github.com/settings/tokens/new?description=dengta-push&scopes=repo"

function Sanitize-Token([string]$Raw) {
  if ([string]::IsNullOrEmpty($Raw)) { return "" }
  return ($Raw -replace '[\x00-\x1F\x7F\s]+', '').Trim()
}

function Test-TokenFormat([string]$Tok) {
  return ($Tok -match '^(ghp_|github_pat_|gho_|ghu_)[A-Za-z0-9_]{16,}$')
}

function Invoke-GitSafe([string[]]$GitArgs) {
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $rawLines = & $Git @GitArgs 2>&1
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prevEap
  }
  $text = (($rawLines | ForEach-Object { $_.ToString() }) -join "`n").Trim()
  return [pscustomobject]@{
    ExitCode = $code
    Output = $text
  }
}

$interactive = [string]::IsNullOrWhiteSpace((Sanitize-Token $GithubToken))
$saveToCredentialManager = $false

if ($interactive) {
  Write-Host "============================================================" -ForegroundColor Cyan
  Write-Host "  DengTa v$VersionName ($VersionCode) 一键同步 GitHub / Vercel / Render" -ForegroundColor Cyan
  Write-Host "============================================================" -ForegroundColor Cyan
  Write-Host "正在弹出中文引导窗口，并自动为你打开 GitHub 授权码生成页..." -ForegroundColor Yellow

  try {
    Start-Process $TokenCreateUrl
  } catch {
    Write-Host "如未自动打开浏览器，请手动访问：$TokenCreateUrl" -ForegroundColor Yellow
  }

  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  [System.Windows.Forms.Application]::EnableVisualStyles()

  $form = New-Object System.Windows.Forms.Form
  $form.Text = "DengTa v$VersionName 一键同步 GitHub"
  $form.Size = New-Object System.Drawing.Size(560, 360)
  $form.StartPosition = "CenterScreen"
  $form.FormBorderStyle = "FixedDialog"
  $form.MaximizeBox = $false
  $form.TopMost = $true
  $form.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 9.5)

  $lbl = New-Object System.Windows.Forms.Label
  $lbl.Location = New-Object System.Drawing.Point(20, 16)
  $lbl.Size = New-Object System.Drawing.Size(510, 128)
  $lbl.Text = "已自动帮你打开 GitHub 授权页（repo 权限已自动勾选），只需 3 步：`r`n`r`n1. 确认网页右上角登录的是账号 Jessica-tce（不是旧账号 DengTaHome）`r`n2. 网页拉到最底，点绿色按钮 [Generate token]`r`n3. 点生成的 ghp_... 旁边的复制图标，再回到这里点下方按钮即可（本次已修复 PowerShell 推送报错）！"
  $form.Controls.Add($lbl)

  $openBtn = New-Object System.Windows.Forms.Button
  $openBtn.Location = New-Object System.Drawing.Point(20, 146)
  $openBtn.Size = New-Object System.Drawing.Size(170, 30)
  $openBtn.Text = "重新打开 GitHub 页面"
  $openBtn.Add_Click({ Start-Process $TokenCreateUrl })
  $form.Controls.Add($openBtn)

  $clipBtn = New-Object System.Windows.Forms.Button
  $clipBtn.Location = New-Object System.Drawing.Point(202, 146)
  $clipBtn.Size = New-Object System.Drawing.Size(320, 30)
  $clipBtn.Text = "点我直接从剪贴板粘贴（免按 Ctrl+V）"
  $clipBtn.BackColor = [System.Drawing.Color]::FromArgb(47, 111, 106)
  $clipBtn.ForeColor = [System.Drawing.Color]::White
  $clipBtn.FlatStyle = "Flat"
  $form.Controls.Add($clipBtn)

  $txt = New-Object System.Windows.Forms.TextBox
  $txt.Location = New-Object System.Drawing.Point(20, 188)
  $txt.Size = New-Object System.Drawing.Size(502, 28)
  $txt.UseSystemPasswordChar = $true
  $form.Controls.Add($txt)

  $chkSave = New-Object System.Windows.Forms.CheckBox
  $chkSave.Location = New-Object System.Drawing.Point(20, 224)
  $chkSave.Size = New-Object System.Drawing.Size(502, 26)
  $chkSave.Checked = $true
  $chkSave.Text = "记住账号 Jessica-tce 到本机电脑（替换旧账号 DengTaHome，以后不用再手动输）"
  $form.Controls.Add($chkSave)

  $statusLbl = New-Object System.Windows.Forms.Label
  $statusLbl.Location = New-Object System.Drawing.Point(20, 252)
  $statusLbl.Size = New-Object System.Drawing.Size(502, 22)
  $statusLbl.ForeColor = [System.Drawing.Color]::DarkRed
  $statusLbl.Text = ""
  $form.Controls.Add($statusLbl)

  $okBtn = New-Object System.Windows.Forms.Button
  $okBtn.Location = New-Object System.Drawing.Point(250, 280)
  $okBtn.Size = New-Object System.Drawing.Size(170, 34)
  $okBtn.Text = "开始一键同步到 GitHub"
  $okBtn.BackColor = [System.Drawing.Color]::FromArgb(37, 99, 235)
  $okBtn.ForeColor = [System.Drawing.Color]::White
  $okBtn.FlatStyle = "Flat"
  $form.Controls.Add($okBtn)

  $cancelBtn = New-Object System.Windows.Forms.Button
  $cancelBtn.Location = New-Object System.Drawing.Point(432, 280)
  $cancelBtn.Size = New-Object System.Drawing.Size(90, 34)
  $cancelBtn.Text = "取消"
  $cancelBtn.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
  $form.Controls.Add($cancelBtn)

  $clipBtn.Add_Click({
    try {
      $clip = Sanitize-Token ([System.Windows.Forms.Clipboard]::GetText())
      if (Test-TokenFormat $clip) {
        $txt.Text = $clip
        $statusLbl.ForeColor = [System.Drawing.Color]::DarkGreen
        $statusLbl.Text = "已成功读取授权码（长度 $($clip.Length)），请点「开始一键同步到 GitHub」！"
      } else {
        $statusLbl.ForeColor = [System.Drawing.Color]::DarkRed
        $statusLbl.Text = "剪贴板里还不是 GitHub 授权码（应以 ghp_ 开头），请先去网页点复制图标。"
      }
    } catch {
      $statusLbl.ForeColor = [System.Drawing.Color]::DarkRed
      $statusLbl.Text = "读取剪贴板失败，请直接点上方输入框按 Ctrl+V 粘贴。"
    }
  })

  $okBtn.Add_Click({
    $clean = Sanitize-Token $txt.Text
    if (-not (Test-TokenFormat $clean)) {
      $statusLbl.ForeColor = [System.Drawing.Color]::DarkRed
      $statusLbl.Text = "授权码格式不对（应以 ghp_ 或 github_pat_ 开头）。请回到网页点复制按钮再点上面绿色粘贴按钮。"
      return
    }
    $txt.Text = $clean
    $form.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $form.Close()
  })

  $form.AcceptButton = $okBtn
  $form.CancelButton = $cancelBtn
  $dialogResult = $form.ShowDialog()
  if ($dialogResult -ne [System.Windows.Forms.DialogResult]::OK) {
    Write-Host "已取消同步。" -ForegroundColor Yellow
    exit 0
  }
  $GithubToken = Sanitize-Token $txt.Text
  $saveToCredentialManager = ($chkSave.Checked -eq $true)
} else {
  $GithubToken = Sanitize-Token $GithubToken
}

if (-not (Test-TokenFormat $GithubToken)) {
  throw "GitHub 授权码格式无效（应以 ghp_ 或 github_pat_ 开头，不能包含换行或控制字符）。"
}
if (-not (Test-Path $ApkPath)) { throw "APK missing: $ApkPath" }
$actualSha = (Get-FileHash -Algorithm SHA256 $ApkPath).Hash.ToLower()
$actualSize = (Get-Item $ApkPath).Length
if ($actualSha -ne $ExpectedSha256 -or $actualSize -ne $ExpectedSize) {
  throw "APK verification failed: size=$actualSize sha256=$actualSha"
}

$headers = @{
  Authorization = "Bearer $GithubToken"
  Accept = "application/vnd.github+json"
  "User-Agent" = "dengta-release-v$VersionName"
  "X-GitHub-Api-Version" = "2022-11-28"
}
$me = Invoke-RestMethod -Uri "https://api.github.com/user" -Headers $headers -TimeoutSec 20
Write-Host "GitHub 登录验证成功，当前账号：$($me.login)" -ForegroundColor Green
if ($me.login -ieq "DengTaHome") {
  throw "当前授权码属于旧账号 DengTaHome（邮箱未验证无法推送）。请在浏览器切换为新账号 Jessica-tce 后重新生成授权码！"
}
$basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("$($me.login):$GithubToken"))

function Push-Repo([string]$Dir, [string]$Slug) {
  Write-Host "== 正在推送 $Slug main ==" -ForegroundColor Cyan
  $res = Invoke-GitSafe @(
    "-C", $Dir,
    "-c", "credential.helper=",
    "-c", "http.proxy=",
    "-c", "https.proxy=",
    "-c", "http.extraheader=Authorization: Basic $basic",
    "push", "https://github.com/$Slug.git", "HEAD:main"
  )
  if (-not [string]::IsNullOrWhiteSpace($res.Output)) {
    Write-Host ($res.Output.Replace($GithubToken, "***").Replace($basic, "***"))
  }
  if ($res.ExitCode -ne 0) {
    throw "推送 $Slug 失败（退出码 $($res.ExitCode)），请确认登录的是 Jessica-tce 且勾选了 repo 权限。"
  }
  $headRes = Invoke-GitSafe @("-C", $Dir, "rev-parse", "HEAD")
  return $headRes.Output.Trim()
}

$beSha = Push-Repo "D:\GZdeepseek\_refs\backend-prod" "tnineninet/dengta-home-backend"
$feSha = Push-Repo "D:\GZdeepseek\_refs\frontend-gh" "tnineninet/dengta-home-frontend"
$docsSha = Push-Repo "D:\GZdeepseek\dengta-home" "tnineninet/dengta-home"
Write-Host "GitHub backend main = $beSha" -ForegroundColor Green
Write-Host "GitHub frontend main = $feSha" -ForegroundColor Green
Write-Host "GitHub docs main = $docsSha" -ForegroundColor Green

if ($saveToCredentialManager) {
  try {
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    "protocol=https`nhost=github.com`n`n" | & $Git credential reject 2>$null | Out-Null
    "protocol=https`nhost=github.com`nusername=$($me.login)`npassword=$GithubToken`n`n" | & $Git credential approve 2>$null | Out-Null
    $ErrorActionPreference = $prevEap
    Write-Host "已把 $($me.login) 保存到 Windows 凭据管理器（替换了旧账号 DengTaHome），以后 AI 可直接自动推送！" -ForegroundColor Green
  } catch {
    Write-Host "（凭据保存跳过，不影响本次线上发布）" -ForegroundColor Yellow
  }
}

Write-Host "== 正在发布 GitHub Release v$VersionName 并上传新版 APK ==" -ForegroundColor Cyan
$tag = "v$VersionName"
$rel = $null
try {
  $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/tnineninet/dengta-home-frontend/releases/tags/$tag" -Headers $headers -TimeoutSec 20
} catch {
  $rel = $null
}

$releaseNotes = @"
## DengTa v$VersionName (versionCode $VersionCode)

- **博美犬小棉花 3D 全面重塑（按桌宠教程升级）**：
  - 手绘暖奶油杏色卡通毛绒纹理 + 凹凸贴图 + 粉嫩耳廓/腮红 + 闪亮高光动漫眼瞳 + 珊瑚项圈金铃（彻底告别白膜）
  - 24 骨骼完整动作与实景 3D 道具：吃饭（3D 食盆粮粒渐减+骨头饼干）、喝水（3D 水碗涟漪）、梳毛、四足奔跑、悬吊蹬腿回弹
  - 手机陀螺仪满屏跑动 + 真实物理甩球与追球回拍；GPU `translate3d` 零卡顿零闪烁身体部位拎拖；全新精致半透明图标菜单栏；修复「小棉花的小屋」无法上下滑动
- **彩虹胶囊与灵动岛大减负 + 根治闪屏与定位模块显示错误**：
  - 天气胶囊移至右侧：彩色天气 SVG 图标 + 两字城市缩写（如 `上海 9°`）并去除时钟与中文天气词；卫星芯片不再压住聊天文字
  - 展开面板拆分为「此刻陪伴 / 天气与工具」双标签防杂乱，根治打开闪屏、WebGL 光球透字、定位按钮圆圈裁切文字与「黃浦區」繁体问题
- **真人感「喜怒哀乐」与健康元气基线**：
  - 根治默认/重置/闲置元气跌至 0% 的缺陷（恢复 70–80% 健康人类日常基线与柔和昼夜节律），移除游戏化「回元气 +18%」数值条
  - 新增 `喜 / 怒 / 哀 / 乐` 象限与情境化哄人/陪伴逻辑，前后端回复忠实于人设与真实情绪惯性
- **聊天左下角麦克风一键修复**：同时支持单击录音再点发送与长按松手发送，自动申请原生权限并在语音离线时无缝回落本机语音识别

- **SHA-256**: ``$ExpectedSha256``
- **Size**: ``$ExpectedSize`` bytes
"@

if ($null -eq $rel) {
  $bodyJson = @{
    tag_name = $tag
    target_commitish = $feSha
    name = "DengTa v$VersionName ($VersionCode)"
    body = $releaseNotes
    draft = $false
    prerelease = $false
  } | ConvertTo-Json -Depth 4
  $rel = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/tnineninet/dengta-home-frontend/releases" -Headers $headers -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($bodyJson)) -TimeoutSec 30
}

foreach ($a in @($rel.assets)) {
  if ($a.name -eq "DengTa-$VersionName.apk") {
    Invoke-RestMethod -Method Delete -Uri "https://api.github.com/repos/tnineninet/dengta-home-frontend/releases/assets/$($a.id)" -Headers $headers -TimeoutSec 20 | Out-Null
  }
}

$uploadBase = ($rel.upload_url -split "\{", 2)[0]
$uploadUrl = "${uploadBase}?name=DengTa-$VersionName.apk"
Write-Host "正在上传 DengTa-$VersionName.apk ($ExpectedSize bytes)..."
$uploaded = Invoke-RestMethod -Method Post -Uri $uploadUrl -Headers $headers -ContentType "application/vnd.android.package-archive" -InFile $ApkPath -TimeoutSec 300
Write-Host "APK 上传成功：$($uploaded.browser_download_url)" -ForegroundColor Green

Write-Host "== 正在等待 Vercel 官网更新并验证全链路健康 ==" -ForegroundColor Cyan
$env:EXPECTED_FEED_VERSION_CODE = "$VersionCode"
for ($i = 1; $i -le 12; $i++) {
  try {
    $feed = Invoke-RestMethod -Uri "https://www.dengtahome.com/updates/android.json?ts=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())" -TimeoutSec 15
    if ($feed.latest.version_code -eq $VersionCode) {
      Write-Host "官网更新清单已刷新至 v$($feed.latest.version) ($($feed.latest.version_code))！" -ForegroundColor Green
      break
    }
    Write-Host "第 $i/12 次检查：官网还是 version_code=$($feed.latest.version_code)，等待 10 秒..."
  } catch {
    Write-Host "第 $i/12 次检查：等待 Vercel 构建中..."
  }
  Start-Sleep -Seconds 10
}

$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& $Node "D:\GZdeepseek\_refs\frontend-gh\scripts\deployment-health.mjs"
$healthCode = $LASTEXITCODE
$ErrorActionPreference = $prevEap
if ($healthCode -ne 0) { throw "deployment-health.mjs failed ($healthCode)" }
Write-Host ""
Write-Host "全部完成！GitHub + Vercel 官网 + Render 后端 + v$VersionName APK 均已线上生效！" -ForegroundColor Green
