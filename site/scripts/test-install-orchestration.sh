#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
home="$work/home"
assets="$work/assets"
log="$work/commands.log"
mkdir -p "$home" "$assets"

cat > "$work/base-install.sh" <<'EOF'
#!/bin/sh
set -eu
printf 'base' > "$TEST_LOG"
for argument in "$@"; do printf ' <%s>' "$argument" >> "$TEST_LOG"; done
printf '\n' >> "$TEST_LOG"
mkdir -p "$AOS_HOME/bin"
printf '#!/bin/sh\nexit 0\n' > "$AOS_HOME/bin/aos"
chmod 755 "$AOS_HOME/bin/aos"
printf 'Installed Unicity AOS 2026.1.1.\n'
printf 'Run: aos init\n'
printf 'Run: %s/bin/aos init\n' "$AOS_HOME"
EOF

cat > "$work/oracle-install.sh" <<'EOF'
#!/bin/sh
set -eu
[ -x "$AOS_HOME/bin/aos" ]
[ "$AOS_ORACLE_ASSETS" = "$TEST_ASSETS" ]
printf 'oracle' >> "$TEST_LOG"
for argument in "$@"; do printf ' <%s>' "$argument" >> "$TEST_LOG"; done
printf '\n' >> "$TEST_LOG"
EOF
chmod 755 "$work/base-install.sh" "$work/oracle-install.sh"

output=$(HOME="$home" AOS_HOME="$home/.aos" TEST_LOG="$log" TEST_ASSETS="$assets" \
  "$root/public/install.sh" \
    --base-installer "$work/base-install.sh" \
    --oracle-installer "$work/oracle-install.sh" \
    --oracle-assets "$assets" \
    --host codex --yes)

grep -Fq 'base <--no-migrate-prompt> <--yes>' "$log"
grep -Fq 'oracle <--plugins-only> <--no-install-aos> <--host> <codex> <--yes>' "$log"
grep -Fq 'Installed Unicity AOS 2026.1.1.' <<<"$output"
grep -Fq 'Unicity AOS is installed.' <<<"$output"
if grep -Fq 'aos init' <<<"$output"; then
  echo "public installer exposed the unrelated init path" >&2
  exit 1
fi
test ! -e "$home/.astrid"

: > "$log"
HOME="$home" AOS_HOME="$home/.aos" TEST_LOG="$log" TEST_ASSETS="$assets" \
  "$root/public/install.sh" \
    --base-installer "$work/base-install.sh" \
    --oracle-installer "$work/oracle-install.sh" \
    --oracle-assets "$assets" \
    --all --channel dev >/dev/null
grep -Fq 'base <--no-migrate-prompt> <--channel> <dev>' "$log"
grep -Fq 'oracle <--plugins-only> <--no-install-aos> <--yes>' "$log"
if grep -Fq -- '<--all>' "$log"; then
  echo "public --all bypassed detected-host selection" >&2
  exit 1
fi

echo "public installer composes base and host plugins without migration or init"
