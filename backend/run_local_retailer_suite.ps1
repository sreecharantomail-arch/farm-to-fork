$ErrorActionPreference = 'Stop'

Write-Host "`n=== Farm-to-Fork Local Verification Suite ===" -ForegroundColor Cyan

if (-not (Test-Path ".\.env.local")) {
    throw "ABORT: .env.local not found. Run from the backend folder."
}

$envText = Get-Content ".\.env.local" -Raw

if ($envText -notmatch '(?m)^SUPABASE_URL=http://127\.0\.0\.1:54321\s*$') {
    throw "ABORT: .env.local must use local Supabase at 127.0.0.1:54321."
}

if ($envText -notmatch '(?m)^SUPABASE_SERVICE_ROLE_KEY=.+') {
    throw "ABORT: Local service-role key is missing."
}

$tests = @(
    ".\test_retailer_sales_integration.ts",
    ".\test_retailer_wastage_integration.ts",
    ".\test_retailer_returns_integration.ts"
)

foreach ($test in $tests) {
    if (-not (Test-Path $test)) {
        throw "ABORT: Required test file not found: $test"
    }
}

Write-Host "`n[1/4] TypeScript check..." -ForegroundColor Yellow
& npx tsc --noEmit

if ($LASTEXITCODE -ne 0) {
    throw "FAIL: TypeScript check failed. Tests stopped."
}

Write-Host "[PASS] TypeScript check" -ForegroundColor Green

$step = 2

foreach ($test in $tests) {
    Write-Host "`n[$step/4] Running $test ..." -ForegroundColor Yellow

    & npx tsx $test

    if ($LASTEXITCODE -ne 0) {
        throw "FAIL: $test failed. Remaining tests stopped."
    }

    Write-Host "[PASS] $test process completed" -ForegroundColor Green
    $step++
}

Write-Host "`n=== SUITE COMPLETED ===" -ForegroundColor Green
