using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Musix.Core.Api;

namespace Musix.Core.Session;

/// <summary>
/// Where the refresh token lives between runs. On Windows: the Credential Locker
/// (PasswordVault, spec §1) — never a file, never a log line.
/// </summary>
public interface ITokenVault
{
    string? Read(string server);
    void Write(string server, string refreshToken);
    void Clear(string server);
}

public sealed class MemoryVault : ITokenVault
{
    private readonly Dictionary<string, string> tokens = new();
    public string? Read(string server) => tokens.GetValueOrDefault(server);
    public void Write(string server, string refreshToken) => tokens[server] = refreshToken;
    public void Clear(string server) => tokens.Remove(server);
}

/// <summary>
/// The signed-in account on one server: the access token in memory, the refresh token in the
/// vault. A refresh rotates both; concurrent 401s share one refresh (a second one would
/// present a spent token and the server would revoke the whole family as a theft).
/// </summary>
public sealed class Session(HttpClient http, Uri server, ITokenVault vault, string deviceName, string appVersion) : IAccessTokens
{
    private readonly SemaphoreSlim gate = new(1, 1);
    private string? access;

    public Uri Server { get; } = server;
    public string? Current => access;
    public bool SignedIn => vault.Read(Key) is not null;
    private string Key => Server.GetLeftPart(UriPartial.Authority);

    public Task LoginAsync(string email, string password, CancellationToken ct = default) =>
        TokensFrom("api/v2/auth/login", new { email, password, device = Device }, ct);

    public Task RegisterAsync(string email, string password, string? invite, CancellationToken ct = default) =>
        TokensFrom("api/v2/auth/register", new { email, password, invite, device = Device }, ct);

    public async Task<string?> RenewAsync(string? stale, CancellationToken ct)
    {
        await gate.WaitAsync(ct);
        try
        {
            if (access is not null && access != stale) return access;  // someone else already renewed it
            var refresh = vault.Read(Key);
            if (refresh is null) return null;
            var r = await http.PostAsJsonAsync(new Uri(Server, "api/v2/auth/refresh"), new { refreshToken = refresh }, Json.Options, ct);
            if ((int)r.StatusCode == 401)
            {
                vault.Clear(Key);  // revoked or replayed: this device signs in again
                access = null;
                return null;
            }
            if (!r.IsSuccessStatusCode) throw new ApiError((int)r.StatusCode, $"refresh: HTTP {(int)r.StatusCode}");
            Store(await r.Content.ReadFromJsonAsync<JsonObject>(Json.Options, ct));
            return access;
        }
        finally { gate.Release(); }
    }

    public async Task LogoutAsync(CancellationToken ct = default)
    {
        var refresh = vault.Read(Key);
        vault.Clear(Key);
        access = null;
        if (refresh is null) return;
        try { await http.PostAsJsonAsync(new Uri(Server, "api/v2/auth/logout"), new { refreshToken = refresh }, Json.Options, ct); }
        catch (HttpRequestException) { /* signed out locally either way */ }
    }

    private object Device => new { name = deviceName, platform = "windows", appVersion };

    private async Task TokensFrom(string path, object body, CancellationToken ct)
    {
        var r = await http.PostAsJsonAsync(new Uri(Server, path), body, Json.Options, ct);
        if (!r.IsSuccessStatusCode) throw new ApiError((int)r.StatusCode, $"{path}: HTTP {(int)r.StatusCode}");
        Store(await r.Content.ReadFromJsonAsync<JsonObject>(Json.Options, ct));
    }

    private void Store(JsonObject? t)
    {
        access = t?["accessToken"]?.GetValue<string>() ?? throw new ApiError(500, "no access token in the answer");
        if (t["refreshToken"]?.GetValue<string>() is { } refresh) vault.Write(Key, refresh);
    }
}
