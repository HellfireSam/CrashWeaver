#!/usr/bin/env bash
# vscode-web.sh — bring up VS Code web (code-server) for this checkout, idempotently.
#
# Usage:
#   ./scripts/vscode-web.sh              start (or report already-running) VS Code web
#   ./scripts/vscode-web.sh --restart    restart the server
#   ./scripts/vscode-web.sh --stop       stop the server
#   ./scripts/vscode-web.sh --status     report state, do not change anything
#   ./scripts/vscode-web.sh --sidecar    print the Windows command that publishes
#                                        this port without recreating the container
#
# Environment overrides:
#   VSCODE_WEB_PORT   port to listen on             (default 8080)
#   VSCODE_WEB_DIR    folder to open in the editor  (default: git repo root)
#   VSCODE_WEB_HOST   address to bind               (default 0.0.0.0, see NOTE below)
#
# NOTE: this binds 0.0.0.0 with password auth over plain HTTP (code-server's own
# default). Anyone who can reach the port and knows the password gets a root shell.
# Prefer a single-hole-forward from the socat container (see README note at bottom)
# and/or set VSCODE_WEB_HOST=127.0.0.1.
#
# Written for the Debian-based dev container this repo runs in (dash/bash, no
# ss/netstat/fuser/pgrep). Long-lived server processes must be detached with
# setsid+nohup: a child of this shell gets reaped when the shell exits.

set -uo pipefail   # deliberately not -e: we handle failures explicitly

# ----------------------------------------------------------------------------
# config
# ----------------------------------------------------------------------------
PORT="${VSCODE_WEB_PORT:-8080}"
HOST="${VSCODE_WEB_HOST:-0.0.0.0}"
CONFIG_YAML="/root/.config/code-server/config.yaml"
LOG="/var/log/code-server.log"

# Resolve the repo root from this script's location so it works from any cwd.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
# The folder to open: explicit override wins; otherwise the git repo this
# script lives in; otherwise the conventional checkout path. The last fallback
# matters when the script is backed up outside the repo (e.g. on the mounted
# volume), where REPO_ROOT would otherwise point at the mount, not the code.
if [ -n "${VSCODE_WEB_DIR:-}" ]; then
    DIR="$VSCODE_WEB_DIR"
elif [ -d "$REPO_ROOT/.git" ]; then
    DIR="$REPO_ROOT"
else
    DIR="/root/CrashWeaver"
fi

# ----------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------

# Print the PID listening on a TCP port, using /proc (no ss/lsof/fuser here).
# Matches state 0A (LISTEN) on the exact port across IPv4 tables.
port_pid() {
    local want_hex
    want_hex="$(printf '%04X' "$1")"
    local inode
    inode="$(
        { cat /proc/net/tcp /proc/net/tcp6 2>/dev/null || true; } |
        awk -v hex=":$want_hex" '$4 == "0A" && substr($2, length($2)-4) == hex { print $10; exit }'
    )"
    [ -n "$inode" ] || return 1
    local fd dir
    for dir in /proc/[0-9]*/fd; do
        if ls -l "$dir" 2>/dev/null | grep -q "socket:\[$inode\]"; then
            basename "$(dirname "$dir")"
            return 0
        fi
    done
    return 1
}

# PID of the code-server main process, if any (excludes child extension hosts).
# The launched tree looks like:
#   <node> /usr/lib/code-server                     <- launcher: flags + folder
#   <node> /usr/lib/code-server/out/node/entry      <- real server, owns the port
# Match on the install path, not a specific entry-script name, so this survives
# code-server layout changes (4.141.0 uses "entry", older builds used "entry.js").
server_pid() {
    local pid dir cmd
    for dir in /proc/[0-9]*; do
        pid="${dir#/proc/}"
        [ "$pid" = "$$" ] && continue
        cmd="$(tr '\0' ' ' < "$dir/cmdline" 2>/dev/null)" || continue
        case "$cmd" in
            *"/usr/lib/code-server"*|*"code-server"*)
                # Skip this script itself and the extension-host children.
                case "$cmd" in
                    *vscode-web.sh*|*extensionHost*|*extension-host*) continue ;;
                esac
                printf '%s\n' "$pid"
                return 0
                ;;
        esac
    done
    return 1
}

# Is the HTTP endpoint up and answering like code-server?
http_up() {
    local code
    code="$(curl -s -o /dev/null -m 3 -w '%{http_code}' "http://127.0.0.1:$PORT/" 2>/dev/null || echo 000)"
    # code-server answers 200 (login page) or 302. A 401 means something else is
    # there (e.g. the DSH proxy) — that is NOT code-server.
    case "$code" in
        200|302) return 0 ;;
        *) return 1 ;;
    esac
}

password() {
    sed -n 's/^password:[[:space:]]*//p' "$CONFIG_YAML" 2>/dev/null | head -1
}

is_our_port() {
    # True when whatever holds $PORT is code-server.
    local pid
    pid="$(port_pid "$PORT")" || return 1
    local cmd
    cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null)"
    case "$cmd" in
        *entry.js*|*code-server*) return 0 ;;
        *) return 1 ;;
    esac
}

wait_for_http() {
    local i=0
    while [ "$i" -lt 30 ]; do
        http_up && return 0
        sleep 1
        i=$((i + 1))
    done
    return 1
}

die() { printf '%s: error: %s\n' "${0##*/}" "$*" >&2; exit 1; }

# ----------------------------------------------------------------------------
# actions
# ----------------------------------------------------------------------------
do_status() {
    local pid port_is_ours=0
    if pid="$(server_pid)" && [ -n "${pid:-}" ]; then
        printf 'process:  running (pid %s)\n' "$pid"
    else
        printf 'process:  not running\n'
    fi

    if pid="$(port_pid "$PORT")"; then
        local cmd
        cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | cut -c1-100)"
        printf 'port %s: in use by pid %s: %s\n' "$PORT" "$pid" "$cmd"
        if is_our_port; then
            port_is_ours=1
        else
            printf '          ^ that is NOT code-server; this port is unavailable\n'
        fi
    else
        printf 'port %s: free\n' "$PORT"
    fi

    if [ "$port_is_ours" = "1" ] && http_up; then
        printf 'http:     answering on http://127.0.0.1:%s/\n' "$PORT"
    else
        printf 'http:     no answer on http://127.0.0.1:%s/\n' "$PORT"
    fi

    printf 'folder:   %s\n' "$DIR"
    if [ -f "$CONFIG_YAML" ]; then
        printf 'auth:     password (%s)\n' "$CONFIG_YAML"
    else
        printf 'auth:     no config file at %s\n' "$CONFIG_YAML"
    fi
}

do_stop() {
    local pid
    if pid="$(server_pid)" && [ -n "${pid:-}" ]; then
        printf 'stopping code-server (pid %s) ...\n' "$pid"
        kill "$pid" 2>/dev/null || true
        local i=0
        while [ "$i" -lt 15 ] && kill -0 "$pid" 2>/dev/null; do
            sleep 1
            i=$((i + 1))
        done
        if kill -0 "$pid" 2>/dev/null; then
            printf '  did not exit, sending SIGKILL\n'
            kill -9 "$pid" 2>/dev/null || true
        fi
        printf 'stopped.\n'
    else
        printf 'not running.\n'
    fi
    # Reap stale session socket from a previous run so the next start is clean.
    rm -f /root/.local/share/code-server/code-server-ipc.sock 2>/dev/null || true
}

do_start() {
    # Preflight: binary present.
    command -v code-server >/dev/null 2>&1 \
        || die "code-server not found in PATH (expected /usr/local/bin/code-server)"

    # Preflight: folder exists.
    [ -d "$DIR" ] || die "target folder does not exist: $DIR"

    # Already running and healthy? Report and stop — this is the idempotent path.
    if is_our_port && http_up; then
        printf 'already running on port %s — nothing to do.\n\n' "$PORT"
        do_status
        print_access_hint
        return 0
    fi

    # Port taken by something that is NOT code-server (e.g. the DSH proxy on 3079).
    if pid="$(port_pid "$PORT")"; then
        local cmd
        cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | cut -c1-80)"
        die "port $PORT is already in use by pid $pid ($cmd) — pick another with VSCODE_WEB_PORT=<port>"
    fi

    # A code-server process that is alive but not answering: clean it up first.
    if pid="$(server_pid)" && [ -n "${pid:-}" ]; then
        printf 'found unhealthy code-server (pid %s already running), killing it\n' "$pid"
        kill -9 "$pid" 2>/dev/null || true
        sleep 1
    fi
    rm -f /root/.local/share/code-server/code-server-ipc.sock 2>/dev/null || true

    printf 'starting code-server on %s:%s\n' "$HOST" "$PORT"
    printf '  folder: %s\n' "$DIR"
    printf '  log:    %s\n' "$LOG"

    # setsid: new session so it survives this shell / the invoking SSH session.
    # nohup: ignore SIGHUP. Redirect: never write into this script's own stdout,
    # otherwise a caller capturing output would hang waiting for EOF.
    : > "$LOG" 2>/dev/null || true
    nohup setsid code-server \
        --bind-addr "$HOST:$PORT" \
        --auth password \
        --disable-telemetry \
        --disable-update-check \
        "$DIR" \
        >> "$LOG" 2>&1 < /dev/null &
    local bg=$!

    # Detached with setsid, so wait on readiness rather than on the process.
    if wait_for_http; then
        printf 'up.\n\n'
        do_status
        print_access_hint
        return 0
    fi

    printf '\nfailed to come up within 30s. last log lines:\n' >&2
    tail -n 20 "$LOG" >&2 2>/dev/null || true
    return 1
}

print_access_hint() {
    local pw
    pw="$(password)"
    cat <<EOF

  login password : ${pw:-(not set in $CONFIG_YAML)}
  listening on   : ${HOST}:${PORT}

Reaching it from Windows (Docker Desktop)
----------------------------------------
Only ports published with '-p' are visible to Windows. THIS container publishes
just 3080 (the DSH proxy), so don't recreate it. Instead run a throwaway sidecar
that publishes ${PORT} and forwards to this container's bridge IP.

Generate the exact command with:  ${0##*/} --sidecar

  docker rm -f vscode-forward
  docker run -d --rm --name vscode-forward \\
    -p ${PORT}:${PORT} \\
    --entrypoint /usr/bin/socat \\
    alpine/socat \\
    TCP-LISTEN:${PORT},fork,reuseaddr TCP:<bridge-ip>:${PORT}

Then browse http://localhost:${PORT}/

Notes:
  * '-p' CANNOT be combined with '--network container:<id>' — Docker rejects it
    ("conflicting options: port publishing and the container type network mode").
    So the sidecar uses the default bridge and targets this container's eth0 IP.
  * That means code-server must bind 0.0.0.0 (the default here), not 127.0.0.1.
  * '--entrypoint /usr/bin/socat' is REQUIRED: the image's ENTRYPOINT+CMD yield
    "socat socat", which socat rejects.
EOF
}

# Print the exact `docker run` to paste on Windows to publish the port.
#
# IMPORTANT: `-p` cannot be combined with `--network container:<id>` — Docker
# rejects it ("conflicting options: port publishing and the container type
# network mode") because publishing a port requires the container to own its
# netns. So the sidecar runs on the default bridge instead and forwards to this
# container's bridge IP, which requires code-server to bind 0.0.0.0.
do_sidecar() {
    local self bridge_ip host_port
    self="$(cat /etc/hostname 2>/dev/null)"
    [ -n "$self" ] || die "cannot determine this container's id (/etc/hostname unreadable)"

    bridge_ip="$(ip -4 -o addr show eth0 2>/dev/null | awk '{print $4}' | cut -d/ -f1)"
    [ -n "$bridge_ip" ] || die "cannot determine this container's bridge IP"

    # Host side port is independent of the container side port; override with
    # SIDECAR_HOST_PORT if 8080 is already taken on the Windows host.
    host_port="${SIDECAR_HOST_PORT:-$PORT}"

    # The sidecar reaches the bridge IP, so a loopback-only bind will not work.
    if [ "$HOST" = "127.0.0.1" ]; then
        printf 'WARNING: code-server is bound to 127.0.0.1, which the sidecar cannot reach.\n'
        printf '         Start it bound to all interfaces first:\n'
        printf '           %s --restart\n\n' "${0##*/}"
    fi

    printf 'Run this on Windows (PowerShell):\n\n'
    printf 'docker rm -f vscode-forward 2>$null\n'
    printf 'docker run -d --rm --name vscode-forward `\n'
    printf '  -p %s:%s `\n' "$host_port" "$PORT"
    printf '  --entrypoint /usr/bin/socat `\n'
    printf '  alpine/socat `\n'
    printf '  TCP-LISTEN:%s,fork,reuseaddr TCP:%s:%s\n\n' "$PORT" "$bridge_ip" "$PORT"
    printf 'Then open http://localhost:%s/\n\n' "$host_port"
    if [ "$host_port" != "$PORT" ]; then
        printf 'NOTE: host port %s -> container port %s.\n\n' "$host_port" "$PORT"
    fi
    printf 'NOTE: backtick is PowerShell line continuation; in CMD use ^ instead.\n'
    printf 'NOTE: the sidecar targets %s:%s (this container on the bridge network),\n' "$bridge_ip" "$PORT"
    printf '      so it does NOT use --network container: — Docker forbids -p there.\n'
}

# ----------------------------------------------------------------------------
# main
# ----------------------------------------------------------------------------
ACTION="start"
case "${1:-}" in
    ""|start|--start) ACTION="start" ;;
    --stop|stop)      ACTION="stop" ;;
    --restart|restart) ACTION="restart" ;;
    --status|status)  ACTION="status" ;;
    --sidecar)        ACTION="sidecar" ;;
    -h|--help|help)
        sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
        exit 0
        ;;
    *) die "unknown argument '$1' (try --help)" ;;
esac

case "$ACTION" in
    status)  do_status ;;
    stop)    do_stop ;;
    restart) do_stop; echo; do_start ;;
    start)   do_start ;;
    sidecar) do_sidecar ;;
esac
