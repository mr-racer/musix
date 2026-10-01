# MusiX для Windows

- `src/Musix.Core` — ядро без UI (net10.0): сессия, зеркало `/sync`, outbox, очередь, локальная библиотека, загрузка. Собирается и тестируется где угодно, на Linux тоже: `dotnet test tests/Musix.Core.Tests`.
- `src/Musix.App` — оболочка на WinUI 3 (Windows App SDK 1.8), без XAML-страниц, весь UI в коде. На Linux она только компилируется (`dotnet build src/Musix.App`). Запускается и пакуется только на Windows.

## Запуск на ПК (Windows 10 1809+ / 11)

```powershell
winget install Microsoft.DotNet.SDK.10
dotnet run --project src\Musix.App -r win-x64
```

При первом запуске укажи адрес сервера (по умолчанию `https://musixai.ru/`) и войди. Библиотека синхронизируется в `%LOCALAPPDATA%\MusiX`, и после этого приложение открывается сразу, в том числе без сети.

Установщик и автообновление (Velopack) собирает `tools/windows/pack.ps1`.
