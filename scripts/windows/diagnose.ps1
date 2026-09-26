[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

Write-Host '=== Windows Runner Diagnosis ==='
Write-Host "ComputerName: $env:COMPUTERNAME"
Write-Host "User: $([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)"
Write-Host "PowerShell: $($PSVersionTable.PSVersion)"
Write-Host "OS: $([System.Environment]::OSVersion.VersionString)"
Write-Host "RunnerWorkDirectory: $env:RUNNER_WORKSPACE"
Write-Host "WorkingDirectory: $(Get-Location)"

Write-Host "`n=== Runner Service ==="
Get-Service | Where-Object { $_.Name -like 'actions.runner.*' } |
    Select-Object Name, Status, StartType |
    Format-Table -AutoSize

Write-Host "`n=== Disk Summary ==="
Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" |
    Select-Object DeviceID,
        @{Name='FreeGB'; Expression={[math]::Round($_.FreeSpace / 1GB, 2)}},
        @{Name='SizeGB'; Expression={[math]::Round($_.Size / 1GB, 2)}} |
    Format-Table -AutoSize

Write-Host "`nDiagnosis completed successfully."
