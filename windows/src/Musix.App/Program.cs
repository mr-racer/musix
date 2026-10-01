using Microsoft.UI.Xaml;
using Velopack;

namespace Musix.App;

public static class Program
{
    /// <summary>
    /// Where a crash leaves its trace (%LOCALAPPDATA%\MusiX\crash.log). An unpackaged WinUI app
    /// that dies at start shows nothing at all, so the log is the only report there is.
    /// </summary>
    public static string CrashLog => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MusiX", "crash.log");

    public static void Crash(string where, Exception? e)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(CrashLog)!);
            File.AppendAllText(CrashLog, $"{DateTime.Now:O} {where}: {e}\n\n");
        }
        catch (Exception) { /* nothing left to report to */ }
    }

    [STAThread]
    public static void Main(string[] args)
    {
        AppDomain.CurrentDomain.UnhandledException += (_, e) => Crash("domain", e.ExceptionObject as Exception);
        TaskScheduler.UnobservedTaskException += (_, e) => { Crash("task", e.Exception); e.SetObserved(); };
        try
        {
            // Velopack's install/update hooks run first and may exit (spec §5)
            VelopackApp.Build().Run();
            var smoke = Array.IndexOf(args, "--smoke");
            if (smoke >= 0 && smoke + 1 < args.Length) Services.Smoke.Dir = Path.GetFullPath(args[smoke + 1]);
            WinRT.ComWrappersSupport.InitializeComWrappers();
            Application.Start(p =>
            {
                var ctx = new Microsoft.UI.Dispatching.DispatcherQueueSynchronizationContext(Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread());
                SynchronizationContext.SetSynchronizationContext(ctx);
                var app = new App();
                app.UnhandledException += (_, e) =>
                {
                    Crash("xaml", e.Exception);
                    // the tour records the page that threw and goes on to the next one
                    if (Services.Smoke.Dir is not null) { Services.Smoke.Failed("xaml", e.Exception); e.Handled = true; }
                };
            });
        }
        catch (Exception e)
        {
            Crash("start", e);
            throw;
        }
    }
}
