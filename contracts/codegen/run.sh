#!/usr/bin/env bash
# The three API clients, generated from contracts/openapi.json and compiled.
# Generated sources are not committed; CI runs `check`. Usage: run.sh gen|check
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
contracts="$(dirname "$here")"
OPENAPI_GENERATOR=openapitools/openapi-generator-cli:v7.25.0
KIOTA=mcr.microsoft.com/openapi/kiota:1.35.0
DOTNET=mcr.microsoft.com/dotnet/sdk:10.0
user="$(id -u):$(id -g)"

gen() {
  rm -rf "$here"/kotlin/generated "$here"/csharp/generated "$here"/ts/generated
  docker run --rm -u "$user" -v "$contracts":/local "$OPENAPI_GENERATOR" generate -q \
    -i /local/openapi.json -g kotlin -o /local/codegen/kotlin/generated \
    -c /local/codegen/kotlin/config.yaml
  docker run --rm -u "$user" -e HOME=/tmp -v "$contracts":/work "$KIOTA" generate \
    -l CSharp -d /work/openapi.json -o /work/codegen/csharp/generated \
    -n Musix.Api.Client -c MusixClient --clean-output --log-level Warning
  (cd "$here/ts" && npm ci --silent --no-audit --no-fund && npm run --silent gen)
}

compile() {
  # Kotlin: JDK 21 + Gradle 8.14 — on the home box the Android toolchain's, in CI the PATH's
  (if [ -f /mnt/data/android/env.sh ]; then
     source /mnt/data/android/env.sh
     gradle="$(ls -d "$GRADLE_USER_HOME"/wrapper/dists/gradle-8.14.3-all/*/gradle-8.14.3 | head -1)/bin/gradle"
   else gradle=gradle; fi
   "$gradle" -p "$here/kotlin" --no-daemon -q compileKotlin)
  nuget="${NUGET_CACHE:-/mnt/data/.cache/nuget}"
  mkdir -p "$nuget"  # before docker would create it as root
  docker run --rm -u "$user" -e HOME=/tmp -e DOTNET_CLI_TELEMETRY_OPTOUT=1 -e NUGET_PACKAGES=/nuget \
    -v "$nuget":/nuget -v "$here/csharp":/src -w /src "$DOTNET" \
    dotnet build -nologo -v quiet -clp:ErrorsOnly
  (cd "$here/ts" && npm run --silent check)
  echo "codegen: kotlin, csharp, ts compile"
}

case "${1:-check}" in
  gen) gen ;;
  check) gen && compile ;;
  *) echo "usage: $0 gen|check" >&2; exit 2 ;;
esac
