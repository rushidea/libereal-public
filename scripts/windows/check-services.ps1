[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$serviceNames = @(
    'actions.runner.*',
    'W32Time',
    'Dnscache',
    'Spooler'
)

Write-Host '=== Selected Windows Services ==='
foreach ($pattern in $serviceNames) {
    Get-Service -Name $pattern -ErrorAction SilentlyContinue |
        Select-Object Name, DisplayName, Status, StartType
}

Write-Host "`nService check completed successfully."
