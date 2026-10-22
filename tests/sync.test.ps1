$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot '../sync/BackupSync.psm1') -Force
$root=Join-Path ([IO.Path]::GetTempPath()) ('pwa-sync-tests-'+[Guid]::NewGuid().ToString('N'));[void][IO.Directory]::CreateDirectory($root)
$script:checks=0
function Assert($Condition,$Message){if(!$Condition){throw $Message};$script:checks++}
function Fixture([int]$N) {
 $id=[Guid]::NewGuid().ToString();$course='course-'+($N%2);$profile=if($N%2){'11111111-1111-4111-8111-111111111111'}else{'33333333-3333-4333-8333-333333333333'}
 $b=@{backupType='course-backup';schemaVersion=1;backupId=$id;course=@{id=$course;label='Français'};entries=@();progress=@();history=@();exams=@()}
 [byte[]]$bytes=[Text.Encoding]::UTF8.GetBytes(($b|ConvertTo-Json -Depth 20 -Compress));$hash=Get-BackupHash $bytes;$ck=Get-BackupHash ([Text.Encoding]::UTF8.GetBytes($course))
 return @{bytes=$bytes;item=@{backupId=$id;profileId=$profile;courseKey=$ck;sha256=$hash;size=$bytes.Length;profileName='../Profil\test';courseName='Français 6';createdAt='2026-10-21T20:30:00Z';downloadPath="/backup/download/$profile/22222222-2222-4222-8222-222222222222/$ck/$id"}}
}
function Mock($Rows,$State){return {param($Method,$Path,$Body)
 if($Path.StartsWith('/backup/list')){return ,([Text.Encoding]::UTF8.GetBytes((@{items=@($Rows|ForEach-Object {$_.item});cursor=$null}|ConvertTo-Json -Depth 20 -Compress)))}
 if($Method -eq 'POST'){$State.acks++;return ,([Text.Encoding]::UTF8.GetBytes('{"ok":true}'))}
 if($State.fail){throw 'NETWORK_FAILED'}
 $record=@($Rows|Where-Object {$_.item.downloadPath -eq $Path})[0]
 if($State.corrupt){return ,([Text.Encoding]::UTF8.GetBytes('broken'))}
 return ,$record.bytes
}.GetNewClosure()}
try {
 $one=Fixture 1;$state=@{acks=0;fail=$false;corrupt=$false};$request=Mock @($one) $state
 $r=Invoke-BackupSync $root $request;Assert ($r.ok -and $r.saved -eq 1 -and $state.acks -eq 1 -and $r.downloaded -eq 1 -and $r.verified -eq 1 -and $r.finalVerified -eq 1) 'single backup failed'
 $r=Invoke-BackupSync $root $request;Assert ($r.ok -and $r.existing -eq 1 -and $r.saved -eq 0) 'idempotence failed'
 Assert (@(Get-ChildItem $root -Recurse -Filter '*.json').Count -eq 1) 'duplicate file'
 $many=@((Fixture 1),(Fixture 2),(Fixture 3));$state.acks=0;$r=Invoke-BackupSync $root (Mock $many $state);Assert ($r.ok -and $r.saved -eq 3 -and $state.acks -eq 3) 'multiple profiles/courses failed'
 $new=Fixture 4;$state.acks=0;$state.corrupt=$true;$r=Invoke-BackupSync $root (Mock @($new) $state);Assert (!$r.ok -and $state.acks -eq 0) 'corruption acknowledged'
 $state.corrupt=$false;$new.item.sha256=('0'*64);$r=Invoke-BackupSync $root (Mock @($new) $state);Assert (!$r.ok -and $state.acks -eq 0) 'wrong hash acknowledged'
 $new=Fixture 5;$r=Invoke-BackupSync (Join-Path $root 'missing-share') (Mock @($new) $state);Assert (!$r.ok -and $state.acks -eq 0) 'missing NAS acknowledged'
 $r=Invoke-BackupSync $root (Mock @($new) $state) -WriteFile {param($p,$b)[IO.File]::WriteAllBytes($p,$b[0..2]);throw 'SIMULATED_WRITE_FAILURE'}
 Assert (!$r.ok -and $state.acks -eq 0) 'failed write acknowledged';Assert (@(Get-ChildItem $root -Recurse -Filter '*.partial').Count -eq 0) 'partial left behind'
 $r=Invoke-BackupSync $root (Mock @($new) $state);Assert ($r.ok -and $state.acks -eq 1) 'restart failed'
 $state.acks=0;$state.fail=$true;$r=Invoke-BackupSync $root (Mock @((Fixture 6)) $state);Assert (!$r.ok -and $state.acks -eq 0) 'failed download acknowledged';$state.fail=$false
 $file=Get-ChildItem $root -Recurse -Filter ('*'+$one.item.backupId+'.json')|Select-Object -First 1;[IO.File]::WriteAllText($file.FullName,'existing-user-file')
 $r=Invoke-BackupSync $root $request;Assert (!$r.ok -and [IO.File]::ReadAllText($file.FullName) -eq 'existing-user-file') 'existing file overwritten'
 Write-Output ('PowerShell sync assertions passed: '+$script:checks)
} finally {Remove-Item -LiteralPath $root -Recurse -Force}
