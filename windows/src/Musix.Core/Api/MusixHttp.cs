using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Polly;
using Polly.Retry;
using Polly.Timeout;

namespace Musix.Core.Api;

/// <summary>An HTTP status the server answered with (the body is not kept: it may carry data).</summary>
public sealed class ApiError(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
    /// <summary>Worth retrying later: the network, a timeout, 401 (a refresh is pending), 429, 5xx.</summary>
    public bool Transient => Status is 401 or 408 or 429 || Status >= 500;
}

public static class Json
{
    /// <summary>v2's wire format: camelCase, nulls omitted on the way out.</summary>
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };
}

/// <summary>Supplies the access token and renews it; <see cref="Session.Session"/> implements it.</summary>
public interface IAccessTokens
{
    string? Current { get; }
    /// <summary>A fresh access token, or null when the session is gone (the refresh was refused).</summary>
    Task<string?> RenewAsync(string? stale, CancellationToken ct);
}

/// <summary>
/// The core's door to the v2 API: the base URL, the bearer token (renewed once on a 401, and
/// shared by concurrent callers), and a retry pipeline for idempotent requests only — a POST
/// is never replayed by transport, it is the outbox's job to do that with its client ids.
/// </summary>
public sealed class MusixHttp
{
    private readonly HttpClient http;
    private readonly IAccessTokens? tokens;
    private readonly ResiliencePipeline<HttpResponseMessage> idempotent;

    public MusixHttp(HttpClient http, Uri baseUrl, IAccessTokens? tokens = null)
    {
        this.http = http;
        this.tokens = tokens;
        BaseUrl = baseUrl;
        idempotent = new ResiliencePipelineBuilder<HttpResponseMessage>()
            .AddRetry(new RetryStrategyOptions<HttpResponseMessage>
            {
                MaxRetryAttempts = 3,
                BackoffType = DelayBackoffType.Exponential,
                UseJitter = true,
                Delay = TimeSpan.FromMilliseconds(300),
                ShouldHandle = new PredicateBuilder<HttpResponseMessage>()
                    .Handle<HttpRequestException>()
                    .Handle<TimeoutRejectedException>()
                    .HandleResult(r => (int)r.StatusCode is 408 or 429 or >= 500),
            })
            .AddTimeout(TimeSpan.FromSeconds(30))
            .Build();
    }

    public Uri BaseUrl { get; }

    public Uri Url(string path) => new(BaseUrl, path.TrimStart('/'));

    public async Task<JsonNode?> GetJsonAsync(string path, CancellationToken ct = default)
    {
        using var r = await SendAsync(() => new HttpRequestMessage(HttpMethod.Get, Url(path)), idempotentRequest: true, ct);
        return await ReadAsync(r, path, ct);
    }

    public async Task<JsonNode?> SendJsonAsync(HttpMethod method, string path, object? body, CancellationToken ct = default)
    {
        var json = body is null ? null : body as string ?? JsonSerializer.Serialize(body, Json.Options);
        using var r = await SendAsync(() => new HttpRequestMessage(method, Url(path))
        {
            Content = json is null ? null : new StringContent(json, Encoding.UTF8, "application/json"),
        }, idempotentRequest: method == HttpMethod.Get || method == HttpMethod.Put || method == HttpMethod.Delete, ct);
        return await ReadAsync(r, path, ct);
    }

    /// <summary>A binary GET (the energy envelope); null on 404, which means "not computed yet".</summary>
    public async Task<byte[]?> GetBytesAsync(string path, CancellationToken ct = default)
    {
        using var r = await SendAsync(() => new HttpRequestMessage(HttpMethod.Get, Url(path)), idempotentRequest: true, ct);
        if (r.StatusCode == HttpStatusCode.NotFound) return null;
        if (!r.IsSuccessStatusCode) throw new ApiError((int)r.StatusCode, $"{path}: HTTP {(int)r.StatusCode}");
        return await r.Content.ReadAsByteArrayAsync(ct);
    }

    /// <summary>A raw request (an upload chunk): the caller builds it, auth and errors are handled here.</summary>
    public async Task<JsonNode?> SendRawAsync(Func<HttpRequestMessage> build, string what, CancellationToken ct = default)
    {
        using var r = await SendAsync(build, idempotentRequest: false, ct);
        return await ReadAsync(r, what, ct);
    }

    private async Task<HttpResponseMessage> SendAsync(Func<HttpRequestMessage> build, bool idempotentRequest, CancellationToken ct)
    {
        async ValueTask<HttpResponseMessage> once(CancellationToken t)
        {
            var token = tokens?.Current;
            var r = await http.SendAsync(Authorize(build(), token), t);
            if (r.StatusCode != HttpStatusCode.Unauthorized || tokens is null) return r;
            r.Dispose();
            var fresh = await tokens.RenewAsync(token, t);  // one renewal, shared by every caller that hit it
            if (fresh is null) throw new ApiError(401, "the session ended");
            return await http.SendAsync(Authorize(build(), fresh), t);
        }
        return idempotentRequest ? await idempotent.ExecuteAsync(once, ct) : await once(ct);
    }

    private static HttpRequestMessage Authorize(HttpRequestMessage m, string? token)
    {
        if (token is not null) m.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return m;
    }

    private static async Task<JsonNode?> ReadAsync(HttpResponseMessage r, string what, CancellationToken ct)
    {
        if (!r.IsSuccessStatusCode) throw new ApiError((int)r.StatusCode, $"{what}: HTTP {(int)r.StatusCode}");
        if (r.StatusCode == HttpStatusCode.NoContent || r.Content.Headers.ContentLength == 0) return null;
        var text = await r.Content.ReadAsStringAsync(ct);
        return string.IsNullOrWhiteSpace(text) ? null : JsonNode.Parse(text);
    }
}
