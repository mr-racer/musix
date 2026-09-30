#!/usr/bin/env bash
# The Android emulator, headless in Docker with /dev/kvm passed through: the dev user can
# reach Docker but not /dev/kvm directly (the kvm group came after the session started).
# The SDK and AVD are bind-mounted at their host paths; adb on the host sees the emulator
# over the host network. Usage: emu.sh up|down|shot <file.png>|reverse
set -euo pipefail
. /mnt/data/android/env.sh
NAME=musix-emu
IMAGE=musix-emu:1
PORTS=(18080 18000 18010)   # the dev nginx, api, api-snap → 127.0.0.1 inside the emulator

case "${1:-up}" in
  up)
    docker image inspect $IMAGE >/dev/null 2>&1 || docker build -q -t $IMAGE /mnt/data/android/emu-docker
    if ! docker ps --format '{{.Names}}' | grep -qx $NAME; then
      docker rm -f $NAME >/dev/null 2>&1 || true
      docker run -d --name $NAME --device /dev/kvm --network host \
        --user "$(id -u):$(id -g)" --group-add "$(getent group kvm | cut -d: -f3)" \
        -e HOME=/tmp -e ANDROID_HOME -e ANDROID_SDK_ROOT -e ANDROID_AVD_HOME \
        -v /mnt/data/android:/mnt/data/android \
        $IMAGE "$ANDROID_HOME/emulator/emulator" -avd musix_phone -no-window -no-audio -no-boot-anim \
          -gpu swiftshader_indirect -no-snapshot -port 5554 -memory 4096 >/dev/null
    fi
    adb start-server >/dev/null
    for _ in $(seq 1 90); do
      adb connect 127.0.0.1:5555 >/dev/null 2>&1 || true
      [ "$(adb -s emulator-5554 shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && break
      sleep 2
    done
    adb -s emulator-5554 shell getprop sys.boot_completed | grep -q 1 || { docker logs --tail 30 $NAME; exit 1; }
    "$0" reverse
    echo "emulator-5554 up"
    ;;
  reverse)
    for p in "${PORTS[@]}"; do adb -s emulator-5554 reverse tcp:$p tcp:$p >/dev/null; done ;;
  down) docker rm -f $NAME >/dev/null && echo down ;;
  shot) adb -s emulator-5554 exec-out screencap -p > "${2:?file}" && echo "$2" ;;
  *) echo "usage: $0 up|down|shot <file>|reverse" >&2; exit 2 ;;
esac
