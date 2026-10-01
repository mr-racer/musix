using Musix.Core.Session;
using Windows.Security.Credentials;

namespace Musix.App.Services;

/// <summary>The refresh token in the Windows Credential Locker (spec §1): per user, per server.</summary>
public sealed class WinTokenVault : ITokenVault
{
    private const string Resource = "MusiX";
    private readonly PasswordVault vault = new();

    public string? Read(string server)
    {
        try
        {
            var c = vault.Retrieve(Resource, server);
            c.RetrievePassword();
            return c.Password;
        }
        catch (Exception) { return null; }  // not found throws
    }

    public void Write(string server, string refreshToken)
    {
        Clear(server);
        vault.Add(new PasswordCredential(Resource, server, refreshToken));
    }

    public void Clear(string server)
    {
        try { vault.Remove(vault.Retrieve(Resource, server)); } catch (Exception) { }
    }
}
