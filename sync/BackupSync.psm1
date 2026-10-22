Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-BackupHash([byte[]]$Bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}
function ConvertTo-SafeBackupName([string]$Name) {
    $value = ([regex]::Replace($Name.Normalize(), '[^\p{L}\p{N} _.-]', '_')).Trim(' ', '.')
    if (!$value) { $value = 'Profil' }
    if ($value.Length -gt 60) { $value = $value.Substring(0,60) }
    if ($value -match '^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])($|\.)') { $value = '_' + $value }
    return $value
}
function Invoke-BackupHttp {
    param([string]$BaseUrl, [string]$Token, [string]$Method, [string]$Path, $Body = $null)
    if ($BaseUrl -ne 'https://fritz-filelink-worker.michael-538.workers.dev' -or !$Path.StartsWith('/backup/')) { throw 'ENDPOINT_INVALID' }
    Add-Type -AssemblyName System.Net.Http
    $handler = [Net.Http.HttpClientHandler]::new(); $handler.AllowAutoRedirect = $false
    $client = [Net.Http.HttpClient]::new($handler); $client.Timeout = [TimeSpan]::FromSeconds(30)
    $deadline=[Threading.CancellationTokenSource]::new();$deadline.CancelAfter(30000)
    $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::new($Method), $BaseUrl+$Path)
    try {
        if($Token){$request.Headers.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer',$Token)}
        if ($null -ne $Body) { $request.Content = [Net.Http.StringContent]::new(($Body | ConvertTo-Json -Depth 40 -Compress), [Text.Encoding]::UTF8, 'application/json') }
        $response = $client.SendAsync($request,[Net.Http.HttpCompletionOption]::ResponseHeadersRead,$deadline.Token).GetAwaiter().GetResult()
        try {
            if (!$response.IsSuccessStatusCode) { throw 'WORKER_REQUEST_FAILED' }
            $stream=$response.Content.ReadAsStreamAsync().GetAwaiter().GetResult(); $output=[IO.MemoryStream]::new();$buffer=[byte[]]::new(8192)
            try { while (($n=$stream.ReadAsync($buffer,0,$buffer.Length,$deadline.Token).GetAwaiter().GetResult()) -gt 0) { if ($output.Length+$n -gt 2097152) { throw 'RESPONSE_TOO_LARGE' };$output.Write($buffer,0,$n) }; return ,$output.ToArray() }
            finally { $output.Dispose();$stream.Dispose() }
        } finally { $response.Dispose() }
    } catch { throw 'WORKER_REQUEST_FAILED' }
    finally { $request.Dispose();$client.Dispose();$handler.Dispose();$deadline.Dispose() }
}
function Invoke-BackupSync {
    param([string]$TargetRoot, [scriptblock]$Request, [int]$Maximum = 100, [scriptblock]$WriteFile = { param($Path,$Bytes) [IO.File]::WriteAllBytes($Path,$Bytes) })
    $result = [ordered]@{ ok=$true; saved=0; existing=0; acknowledged=0; downloaded=0; verified=0; finalVerified=0; failed=0; error=$null }
    if (!(Test-Path -LiteralPath $TargetRoot -PathType Container)) { $result.ok=$false;$result.error='TARGET_UNAVAILABLE';return [pscustomobject]$result }
    $root = [IO.Path]::GetFullPath($TargetRoot);$cursor=$null;$count=0;$visited=[Collections.Generic.HashSet[string]]::new()
    try {
        do {
            $path='/backup/list';if ($cursor) { $path+='?cursor='+[Uri]::EscapeDataString($cursor) }
            [byte[]]$listBytes = & $Request 'GET' $path $null
            $page = [Text.Encoding]::UTF8.GetString($listBytes) | ConvertFrom-Json
            foreach ($item in $page.items) {
                if ($count -ge $Maximum) { break };$count++;$partial=$null
                try {
                    if ($item.backupId -notmatch '^[a-f0-9-]{36}$' -or $item.profileId -notmatch '^[a-f0-9-]{36}$' -or $item.courseKey -notmatch '^[a-f0-9]{64}$' -or $item.sha256 -notmatch '^[a-f0-9]{64}$' -or $item.size -gt 2097152) { throw 'METADATA_INVALID' }
                    if ($item.downloadPath -notmatch '^/backup/download/[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9]{64}/[a-f0-9-]{36}$') { throw 'PATH_INVALID' }
                    [byte[]]$bytes = & $Request 'GET' $item.downloadPath $null
                    $result.downloaded++
                    if ($bytes.Length -ne $item.size -or (Get-BackupHash $bytes) -ne $item.sha256) { throw 'INTEGRITY_MISMATCH' }
                    $result.verified++
                    $backup = [Text.UTF8Encoding]::new($false,$true).GetString($bytes) | ConvertFrom-Json
                    if ($backup.backupType -ne 'course-backup' -or $backup.schemaVersion -ne 1 -or $backup.backupId -ne $item.backupId -or !$backup.course.id -or $null -eq $backup.entries -or $null -eq $backup.progress -or $null -eq $backup.history -or $null -eq $backup.exams) { throw 'BACKUP_INVALID' }
                    $courseHash=Get-BackupHash ([Text.Encoding]::UTF8.GetBytes([string]$backup.course.id))
                    if ($courseHash -ne $item.courseKey) { throw 'COURSE_MISMATCH' }
                    $profile=(ConvertTo-SafeBackupName $item.profileName)+'_'+$item.profileId.Substring(0,8)
                    $course=(ConvertTo-SafeBackupName $item.courseName)+'_'+$item.courseKey.Substring(0,8)
                    $folder=Join-Path (Join-Path (Join-Path $root $profile) $course) 'Backups'
                    [void][IO.Directory]::CreateDirectory($folder)
                    $stamp=([DateTimeOffset]::Parse($item.createdAt)).UtcDateTime.ToString('yyyy-MM-dd_HH-mm-ss')
                    $target=Join-Path $folder ($stamp+'_'+$item.backupId+'.json')
                    if ([IO.File]::Exists($target)) {
                        if ((Get-BackupHash ([IO.File]::ReadAllBytes($target))) -ne $item.sha256) { throw 'EXISTING_FILE_MISMATCH' }
                        $result.existing++
                    } else {
                        $partial=$target+'.'+[Guid]::NewGuid().ToString('N')+'.partial'
                        & $WriteFile $partial $bytes
                        if ((Get-BackupHash ([IO.File]::ReadAllBytes($partial))) -ne $item.sha256) { throw 'WRITE_INTEGRITY_MISMATCH' }
                        try { [IO.File]::Move($partial,$target) }
                        catch { if (![IO.File]::Exists($target) -or (Get-BackupHash ([IO.File]::ReadAllBytes($target))) -ne $item.sha256) { throw 'COMMIT_FAILED' } }
                        if ((Get-BackupHash ([IO.File]::ReadAllBytes($target))) -ne $item.sha256) { throw 'FINAL_INTEGRITY_MISMATCH' }
                        $result.saved++
                    }
                    $result.finalVerified++
                    $ackPath=$item.downloadPath.Replace('/backup/download/','/backup/synced/')
                    [byte[]]$ackBytes=& $Request 'POST' $ackPath @{sha256=$item.sha256;size=$bytes.Length}
                    $ack=[Text.Encoding]::UTF8.GetString($ackBytes)|ConvertFrom-Json
                    if (!$ack.ok) { throw 'ACK_FAILED' };$result.acknowledged++
                } catch { $result.ok=$false;$result.failed++;$result.error='BACKUP_NOT_CONFIRMED' }
                finally { if ($partial -and [IO.File]::Exists($partial)) { [IO.File]::Delete($partial) } }
            }
            $cursor=$page.cursor
            if ($cursor -and !$visited.Add($cursor)) { throw 'CURSOR_REPEATED' }
        } while ($cursor -and $count -lt $Maximum)
    } catch { $result.ok=$false;$result.error='SYNC_UNAVAILABLE' }
    return [pscustomobject]$result
}
Export-ModuleMember -Function Invoke-BackupSync,Invoke-BackupHttp,Get-BackupHash
