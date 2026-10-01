using System.Net.Http.Headers;
using System.Text.Json.Nodes;
using Musix.Core.Api;
using Musix.Core.Local;

namespace Musix.Core.Uploads;

public enum UploadOutcome { AlreadyThere, Sent }

public sealed record UploadProgress(long Sent, long Total);

/// <summary>
/// «Загрузить на сервер» (spec §3): the local sha256 first — a file the server already has is
/// never sent, whatever its name — then the bytes in chunks at the server's offset
/// (`PATCH /uploads/{id}` with `Upload-Offset`). A failed chunk asks the server where it
/// stands and resumes there; the server verifies the hash and registers the track itself.
/// </summary>
public sealed class Uploader(MusixHttp api, LocalLibrary library, int chunkBytes = 8 * 1024 * 1024)
{
    public async Task<UploadOutcome> UploadAsync(long localId, IProgress<UploadProgress>? progress = null, CancellationToken ct = default)
    {
        var t = library.Get(localId) ?? throw new FileNotFoundException("not in the index", localId.ToString());
        var sha = await library.HashAsync(localId, ct);
        var start = await api.SendJsonAsync(HttpMethod.Post, "api/v2/uploads",
            new { sha256 = sha, size = t.Size, filename = Path.GetFileName(t.Path) }, ct);
        if (start?["exists"]?.GetValue<bool>() == true)
        {
            progress?.Report(new UploadProgress(t.Size, t.Size));
            return UploadOutcome.AlreadyThere;
        }
        var id = start?["id"]?.GetValue<string>() ?? throw new ApiError(500, "upload: no id");
        long offset = start["offset"]?.GetValue<long>() ?? 0;
        var buf = new byte[chunkBytes];
        await using var fs = File.OpenRead(t.Path);
        var failures = 0;
        while (offset < t.Size)
        {
            fs.Seek(offset, SeekOrigin.Begin);
            var n = await fs.ReadAtLeastAsync(buf, (int)Math.Min(chunkBytes, t.Size - offset), throwOnEndOfStream: false, ct);
            try
            {
                var at = offset;
                var r = await api.SendRawAsync(() =>
                {
                    var m = new HttpRequestMessage(HttpMethod.Patch, api.Url($"api/v2/uploads/{id}"))
                    {
                        Content = new ByteArrayContent(buf, 0, n),
                    };
                    m.Content.Headers.ContentType = new MediaTypeHeaderValue("application/offset+octet-stream");
                    m.Headers.Add("Upload-Offset", at.ToString());
                    return m;
                }, "upload chunk", ct);
                offset = r?["offset"]?.GetValue<long>() ?? offset + n;
                failures = 0;
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException || e is ApiError { Transient: true } || e is ApiError { Status: 409 })
            {
                if (ct.IsCancellationRequested || ++failures > 5) throw;
                await Task.Delay(TimeSpan.FromSeconds(Math.Min(30, Math.Pow(2, failures))), ct);
                // where does the server stand? (a chunk may have landed before the error)
                offset = (await api.GetJsonAsync($"api/v2/uploads/{id}", ct))?["offset"]?.GetValue<long>() ?? offset;
            }
            progress?.Report(new UploadProgress(offset, t.Size));
        }
        return UploadOutcome.Sent;
    }

    /// <summary>
    /// Links indexed files to the server's tracks with the same content (`GET /tracks/by-hash`),
    /// so a local file gets the knowledge badges, facts and recommendations; playback keeps
    /// preferring the file on disk.
    /// </summary>
    public async Task<int> LinkAsync(CancellationToken ct = default)
    {
        var hashed = library.All().Where(f => f.Sha256 is not null && f.ServerTrackId is null).ToList();
        var linked = 0;
        foreach (var page in hashed.Chunk(200))
        {
            var map = await api.GetJsonAsync($"api/v2/tracks/by-hash?h={string.Join(',', page.Select(f => f.Sha256))}", ct) as JsonObject;
            foreach (var f in page)
            {
                if (map?[f.Sha256!]?.GetValue<string>() is { } trackId) { library.Link(f.Id, trackId); linked++; }
            }
        }
        return linked;
    }
}
