#!/bin/sh
# Install Unicity AOS and the plugins for detected coding-agent hosts.
set -eu
umask 077

BASE_INSTALLER_SOURCE="${AOS_BASE_INSTALLER:-https://aos.unicity.ai/base-install.sh}"
ORACLE_INSTALLER_SOURCE="${AOS_ORACLE_INSTALLER:-https://aos.unicity.ai/oracle-install.sh}"
ORACLE_ASSETS="${AOS_ORACLE_ASSETS:-}"
ASSUME_YES=0
ALL_HOSTS=0
HOSTS=""
AOS_CHANNEL=""
AOS_VERSION=""
WORK=""

say() { printf '%s\n' "$*"; }
die() { say "aos-install: $*" >&2; exit 1; }

cleanup() {
  [ -z "$WORK" ] || rm -rf "$WORK"
}
trap cleanup EXIT HUP INT TERM

usage() {
  cat <<'EOF'
Install Unicity AOS and its coding-agent plugins.

Usage: install.sh [options]

  --host HOST            install claude, codex, or grok (repeatable)
  --all                  install every detected supported host
  --yes, -y              select every detected host without prompting
  --channel CHANNEL      install AOS from stable, dev, or nightly
  --version VERSION      install an exact AOS release
  --base-installer SRC   use a local path or HTTPS URL for the AOS installer
  --oracle-installer SRC use a local path or HTTPS URL for the plugin installer
  --oracle-assets DIR    use local signed-asset fixtures for installer testing
  -h, --help             show this help
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --host)
      shift
      case "${1:-}" in
        claude|codex|grok) HOSTS="$HOSTS ${1}" ;;
        *) die "unknown host '${1:-}'" ;;
      esac
      ;;
    --all) ALL_HOSTS=1 ;;
    -y|--yes) ASSUME_YES=1 ;;
    --channel)
      shift
      AOS_CHANNEL="${1:-}"
      case "$AOS_CHANNEL" in
        stable|dev|nightly) ;;
        *) die "--channel requires stable, dev, or nightly" ;;
      esac
      ;;
    --version)
      shift
      AOS_VERSION="${1:-}"
      printf '%s\n' "$AOS_VERSION" \
        | grep -Eq '^(202[6-9]|20[3-9][0-9])\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' \
        || die "--version requires YYYY.MINOR.PATCH"
      ;;
    --base-installer)
      shift
      BASE_INSTALLER_SOURCE="${1:-}"
      [ -n "$BASE_INSTALLER_SOURCE" ] || die "--base-installer requires a source"
      ;;
    --oracle-installer)
      shift
      ORACLE_INSTALLER_SOURCE="${1:-}"
      [ -n "$ORACLE_INSTALLER_SOURCE" ] || die "--oracle-installer requires a source"
      ;;
    --oracle-assets)
      shift
      ORACLE_ASSETS="${1:-}"
      [ -n "$ORACLE_ASSETS" ] || die "--oracle-assets requires a directory"
      ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option '$1'" ;;
  esac
  shift
done

[ -z "$AOS_CHANNEL" ] || [ -z "$AOS_VERSION" ] \
  || die "--channel and --version are mutually exclusive"

fetch_installer() {
  source=$1
  destination=$2
  case "$source" in
    /*)
      [ -f "$source" ] && [ ! -L "$source" ] \
        || die "local installer is not a regular file: $source"
      cp "$source" "$destination"
      ;;
    file://*)
      source=${source#file://}
      [ -f "$source" ] && [ ! -L "$source" ] \
        || die "local installer is not a regular file: $source"
      cp "$source" "$destination"
      ;;
    https://*)
      command -v curl >/dev/null 2>&1 || die "curl is required"
      curl --proto '=https' --proto-redir '=https' --tlsv1.2 \
        -fsSL --max-time 120 "$source" -o "$destination" \
        || die "could not download $source"
      ;;
    *) die "installer source must be an absolute path, file URL, or HTTPS URL: $source" ;;
  esac
  chmod 700 "$destination"
  sh -n "$destination" || die "installer has invalid shell syntax: $source"
}

WORK=$(mktemp -d 2>/dev/null || mktemp -d -t aos-install)
base_installer="$WORK/base-install.sh"
oracle_installer="$WORK/oracle-install.sh"
base_output="$WORK/base-output"

fetch_installer "$BASE_INSTALLER_SOURCE" "$base_installer"
fetch_installer "$ORACLE_INSTALLER_SOURCE" "$oracle_installer"

set -- "$base_installer" --no-migrate-prompt
[ "$ASSUME_YES" -eq 0 ] || set -- "$@" --yes
[ -z "$AOS_CHANNEL" ] || set -- "$@" --channel "$AOS_CHANNEL"
[ -z "$AOS_VERSION" ] || set -- "$@" --version "$AOS_VERSION"
mkfifo "$base_output"
sed -e '/^Run: aos init$/d' -e '/^Run: .*[/]aos init$/d' <"$base_output" &
filter_pid=$!
status=0
sh "$@" >"$base_output" || status=$?
wait "$filter_pid"
[ "$status" -eq 0 ] || exit "$status"

set -- "$oracle_installer" --plugins-only --no-install-aos
for host in $HOSTS; do
  set -- "$@" --host "$host"
done
if [ "$ALL_HOSTS" -eq 1 ] || [ "$ASSUME_YES" -eq 1 ]; then
  set -- "$@" --yes
fi

if [ -n "$ORACLE_ASSETS" ]; then
  [ -d "$ORACLE_ASSETS" ] || die "oracle asset directory not found: $ORACLE_ASSETS"
  AOS_ORACLE_ASSETS="$ORACLE_ASSETS" sh "$@"
else
  sh "$@"
fi

say "Unicity AOS is installed. Start a new selected host session to finish plugin provisioning."
