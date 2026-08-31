#!/bin/bash

# Pi Cloud Stop Script
# Stops both backend (Fastify) and frontend (Vite) servers

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$PROJECT_DIR/server"
CLIENT_DIR="$PROJECT_DIR/client"
PID_DIR="$PROJECT_DIR/.pids"
ENV_PORT=$(grep -E '^PORT=' "$PROJECT_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
ENV_FRONTEND_PORT=$(grep -E '^FRONTEND_PORT=' "$PROJECT_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
SERVER_PORT="${PORT:-${ENV_PORT:-3000}}"
CLIENT_PORT="${FRONTEND_PORT:-${ENV_FRONTEND_PORT:-5173}}"

process_cwd() {
    local pid=$1
    if [ -L "/proc/$pid/cwd" ]; then
        readlink "/proc/$pid/cwd" 2>/dev/null
        return
    fi
    if command -v lsof >/dev/null 2>&1; then
        lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1
    fi
}

process_start_time() {
    local pid=$1
    ps -p "$pid" -o lstart= 2>/dev/null | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

process_belongs_to_project() {
    local pid=$1
    local name=$2
    local identity_file="$PID_DIR/$name.start"
    local expected_dir command cwd recorded_start current_start
    command=$(ps -p "$pid" -o command= 2>/dev/null || true)
    cwd=$(process_cwd "$pid")

    if [ "$name" = "server" ]; then
        expected_dir=$(cd "$SERVER_DIR" && pwd -P)
        [[ "$command" == *"src/index.ts"* || "$command" == *"dist/index.js"* ]] || return 1
    elif [ "$name" = "client" ]; then
        expected_dir=$(cd "$CLIENT_DIR" && pwd -P)
        [[ "$command" == *"vite"* ]] || return 1
    else
        return 1
    fi

    [ -n "$cwd" ] && [ "$cwd" = "$expected_dir" ] || return 1

    current_start=$(process_start_time "$pid")
    [ -n "$current_start" ] || return 1
    if [ ! -f "$identity_file" ]; then
        printf '%s\n' "$current_start" > "$identity_file"
        return 0
    fi
    recorded_start=$(cat "$identity_file")
    [ "$current_start" = "$recorded_start" ]
}

# Function to stop a process
stop_process() {
    local name=$1
    local pid_file="$PID_DIR/$name.pid"
    local identity_file="$PID_DIR/$name.start"
    
    if [ ! -f "$pid_file" ]; then
        echo -e "${YELLOW}No $name PID file found${NC}"
        rm -f "$identity_file"
        return 0
    fi
    
    local pid=$(cat "$pid_file")
    if ! [[ "$pid" =~ ^[0-9]+$ ]]; then
        echo -e "${YELLOW}Refusing to stop $name: invalid PID file${NC}"
        rm -f "$pid_file" "$identity_file"
        return 0
    fi
    
    if kill -0 "$pid" 2>/dev/null; then
        if ! process_belongs_to_project "$pid" "$name"; then
            echo -e "${YELLOW}Refusing to stop $name (PID: $pid): process does not belong to this Pi Cloud checkout${NC}"
            rm -f "$pid_file" "$identity_file"
            return 0
        fi

        echo -e "${YELLOW}Stopping $name (PID: $pid)...${NC}"
        kill "$pid" 2>/dev/null || true
        
        # Wait for process to stop
        local count=0
        while kill -0 "$pid" 2>/dev/null; do
            if [ $count -ge 10 ]; then
                if process_belongs_to_project "$pid" "$name"; then
                    echo -e "${YELLOW}Force killing $name...${NC}"
                    kill -9 "$pid" 2>/dev/null || true
                else
                    echo -e "${YELLOW}PID $pid changed ownership while stopping; refusing to force kill it${NC}"
                fi
                break
            fi
            sleep 0.5
            count=$((count + 1))
        done
        
        echo -e "${GREEN}✓ $name stopped${NC}"
    else
        echo -e "${YELLOW}$name not running${NC}"
    fi
    
    # Remove PID file
    rm -f "$pid_file" "$identity_file"
}

# Function to check if a port is in use
port_in_use() {
    if command -v lsof >/dev/null 2>&1; then
        lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
    elif command -v ss >/dev/null 2>&1; then
        ss -tlnH "sport = :$1" 2>/dev/null | grep -q .
    else
        echo -e "${RED}Error: Neither 'lsof' nor 'ss' is available. Please install one:${NC}" >&2
        echo "  Debian/Ubuntu: sudo apt install lsof" >&2
        echo "  RHEL/Fedora:   sudo dnf install lsof" >&2
        echo "  Alpine:        apk add iproute2" >&2
        exit 1
    fi
}

# Check .env exists
if [ ! -f "$PROJECT_DIR/.env" ]; then
    echo -e "${RED}Error: .env file not found${NC}"
    echo "Copy .env.example to .env and configure it:"
    echo "  cp .env.example .env"
    exit 1
fi

# Main
echo "=========================================="
echo "       Pi Cloud - Stopping Servers"
echo "=========================================="
echo ""

# Stop by PID files
stop_process "server"
stop_process "client"

# Report remaining listeners without terminating processes that are not owned by this checkout.
echo ""
if port_in_use "$SERVER_PORT"; then
    echo -e "${YELLOW}Port $SERVER_PORT is still in use by a process not stopped by this script${NC}"
fi
if port_in_use "$CLIENT_PORT"; then
    echo -e "${YELLOW}Port $CLIENT_PORT is still in use by a process not stopped by this script${NC}"
fi

echo ""
echo "=========================================="
echo -e "${GREEN}Pi Cloud stop request completed${NC}"
echo ""
echo "  Only verified Pi Cloud processes were signaled"
echo ""
echo "  Start again with: ./start.sh"
echo "=========================================="
