# . windows/env.sh — the .NET SDK and every cache on /mnt/data (the system disk is nearly full)
export DOTNET_ROOT=/mnt/data/.dotnet
export PATH=/mnt/data/.dotnet:$PATH
export NUGET_PACKAGES=/mnt/data/.nuget/packages
export DOTNET_CLI_HOME=/mnt/data/.dotnet-home
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1
