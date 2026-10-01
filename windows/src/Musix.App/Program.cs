using Microsoft.UI.Xaml;
using Velopack;

namespace Musix.App;

public static class Program
{
    [STAThread]
    public static void Main(string[] args)
    {
        // Velopack's install/update hooks run first and may exit (spec §5)
        VelopackApp.Build().Run();
        WinRT.ComWrappersSupport.InitializeComWrappers();
        Application.Start(p =>
        {
            var ctx = new Microsoft.UI.Dispatching.DispatcherQueueSynchronizationContext(Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread());
            SynchronizationContext.SetSynchronizationContext(ctx);
            _ = new App();
        });
    }
}
