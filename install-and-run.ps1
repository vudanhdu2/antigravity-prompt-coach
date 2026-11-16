$ErrorActionPreference = "Stop"
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "  ANTIGRAVITY PROMPT COACH — CÀI ĐẶT & CHẠY 1-CHẠM (SELF-HOST LOCAL)" -ForegroundColor Cyan
Write-Host "========================================================================" -ForegroundColor Cyan

$TargetDir = Join-Path $HOME "antigravity-prompt-coach"
if (-not ($PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot "prompt_coach_server.py")))) {
    if (Get-Command git -ErrorAction SilentlyContinue) {
        if (Test-Path (Join-Path $TargetDir ".git")) {
            Write-Host "[*] Đang cập nhật bản mới nhất từ GitHub..." -ForegroundColor Yellow
            try {
                git -C $TargetDir fetch origin main --quiet
                git -C $TargetDir reset --hard origin/main --quiet
            } catch {
                git -C $TargetDir pull --ff-only
            }
        } else {
            if (Test-Path $TargetDir) { Remove-Item $TargetDir -Recurse -Force -ErrorAction SilentlyContinue }
            Write-Host "[*] Đang tải Antigravity Prompt Coach về $TargetDir..." -ForegroundColor Yellow
            git clone https://github.com/vudanhdu2/antigravity-prompt-coach.git $TargetDir
        }
    } else {
        $ZipPath = Join-Path $env:TEMP "ag-prompt-coach.zip"
        Invoke-WebRequest -Uri "https://github.com/vudanhdu2/antigravity-prompt-coach/archive/refs/heads/main.zip" -OutFile $ZipPath
        Expand-Archive -Path $ZipPath -DestinationPath $env:TEMP -Force
        if (Test-Path $TargetDir) { Remove-Item $TargetDir -Recurse -Force }
        Move-Item (Join-Path $env:TEMP "antigravity-prompt-coach-main") $TargetDir
    }
    Set-Location $TargetDir
} else {
    $TargetDir = $PSScriptRoot
    Set-Location $PSScriptRoot
}

$pyExe = "python"
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    foreach ($cand in @(
        (Join-Path $env:LOCALAPPDATA "Python\pythoncore-3.14-64\python.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python313\python.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe")
    )) {
        if (Test-Path $cand) { $pyExe = $cand; break }
    }
}

Write-Host "[+] Đang khởi chạy Antigravity Prompt Coach tại http://127.0.0.1:8788 ..." -ForegroundColor Green
& $pyExe prompt_coach_server.py --detach --port 8788
