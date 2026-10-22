param([string]$FixturePath,[string]$TargetRoot)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot '../sync/BackupSync.psm1') -Force
[byte[]]$payload=[IO.File]::ReadAllBytes($FixturePath);$backup=[Text.Encoding]::UTF8.GetString($payload)|ConvertFrom-Json
$profile='11111111-1111-4111-8111-111111111111';$device='22222222-2222-4222-8222-222222222222';$hash=Get-BackupHash $payload;$courseKey=Get-BackupHash ([Text.Encoding]::UTF8.GetBytes([string]$backup.course.id))
$item=@{backupId=$backup.backupId;profileId=$profile;courseKey=$courseKey;sha256=$hash;size=$payload.Length;profileName=$backup.profileName;courseName=$backup.course.label;createdAt=$backup.exportedAt;downloadPath="/backup/download/$profile/$device/$courseKey/$($backup.backupId)"}
$state=@{acks=0}
$request={param($Method,$Path,$Body)
 if($Path.StartsWith('/backup/list')){return ,([Text.Encoding]::UTF8.GetBytes((@{items=@($item);cursor=$null}|ConvertTo-Json -Depth 40 -Compress)))}
 if($Method -eq 'POST'){$state.acks++;return ,([Text.Encoding]::UTF8.GetBytes('{"ok":true}'))}
 return ,$payload
}.GetNewClosure()
$result=Invoke-BackupSync $TargetRoot $request
if(!$result.ok -or $state.acks -ne 1){throw 'ROUNDTRIP_FAILED'}
$file=Get-ChildItem -LiteralPath $TargetRoot -Recurse -Filter '*.json' | Select-Object -First 1
@{ok=$result.ok;path=$file.FullName;sha256=(Get-BackupHash ([IO.File]::ReadAllBytes($file.FullName)))}|ConvertTo-Json -Compress
