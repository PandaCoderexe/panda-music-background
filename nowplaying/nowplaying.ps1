# Queries Windows Global System Media Transport Controls for the current track.
# Works with Spotify, browsers, most media players on Windows 10/11.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($WinRtTask, $ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    $netTask.Result
}

$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]

$result = @{ playing = $false }

try {
    $manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) `
        ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    $session = $manager.GetCurrentSession()
    if ($session) {
        $props = Await ($session.TryGetMediaPropertiesAsync()) `
            ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
        $playback = $session.GetPlaybackInfo()

        $result.playing = ($playback.PlaybackStatus -eq [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing)
        $result.title = $props.Title
        $result.artist = $props.Artist
        $result.album = $props.AlbumTitle
        $result.source = $session.SourceAppUserModelId

        if ($props.Thumbnail) {
            $stream = Await ($props.Thumbnail.OpenReadAsync()) `
                ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
            $netStream = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
            $mem = New-Object System.IO.MemoryStream
            $netStream.CopyTo($mem)
            $bytes = $mem.ToArray()
            if ($bytes.Length -gt 0) {
                $mime = if ($bytes[0] -eq 0x89) { 'image/png' } else { 'image/jpeg' }
                $result.artDataUrl = "data:$mime;base64," + [Convert]::ToBase64String($bytes)
            }
            $mem.Dispose()
            $netStream.Dispose()
        }
    }
} catch { }

$result | ConvertTo-Json -Compress
