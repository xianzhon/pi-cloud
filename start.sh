#!/bin/bash

# Pi Cloud Start Script
# Starts both backend (Fastify) and frontend (Vite) servers

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
LOG_DIR="$PROJECT_DIR/.logs"
ENV_PORT=$(grep -E '^PORT=' "$PROJECT_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
ENV_FRONTEND_PORT=$(grep -E '^FRONTEND_PORT=' "$PROJECT_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
SERVER_PORT="${PORT:-${ENV_PORT:-3000}}"
CLIENT_PORT="${FRONTEND_PORT:-${ENV_FRONTEND_PORT:-5173}}"

# Check .env exists
if [ ! -f "$PROJECT_DIR/.env" ]; then
    echo -e "${RED}Error: .env file not found${NC}"
    echo "Copy .env.example to .env and configure it:"
    echo "  cp .env.example .env"
    exit 1
fi

# Create directories if they don't exist
mkdir -p "$PID_DIR" "$LOG_DIR"

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

# Function to check if process is running
is_running() {
    local pid=$1
    kill -0 "$pid" 2>/dev/null
}

process_start_time() {
    local pid=$1
    ps -p "$pid" -o lstart= 2>/dev/null | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

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

process_matches_project() {
    local pid=$1
    local name=$2
    local expected_dir command cwd
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

    [ -n "$cwd" ] && [ "$cwd" = "$expected_dir" ]
}

validate_or_migrate_process_identity() {
    local name=$1
    local pid=$2
    local identity_file="$PID_DIR/$name.start"
    local recorded_start current_start
    process_matches_project "$pid" "$name" || return 1
    current_start=$(process_start_time "$pid")
    [ -n "$current_start" ] || return 1

    if [ -f "$identity_file" ]; then
        recorded_start=$(cat "$identity_file")
        [ "$recorded_start" = "$current_start" ]
        return
    fi

    printf '%s\n' "$current_start" > "$identity_file"
}

record_process_identity() {
    local name=$1
    local pid=$2
    local started
    started=$(process_start_time "$pid")
    if [ -z "$started" ]; then
        echo -e "${RED}Unable to record $name process identity${NC}"
        return 1
    fi
    printf '%s\n' "$started" > "$PID_DIR/$name.start"
}

# Function to ensure native Node modules match the current Node.js runtime
check_native_modules() {
    echo -e "${YELLOW}Checking native Node modules...${NC}"

    cd "$SERVER_DIR"
    if node -e "require('better-sqlite3'); require('@lydell/node-pty')" >/dev/null 2>"$LOG_DIR/native-check.log"; then
        return 0
    fi

    echo -e "${YELLOW}Native modules need rebuilding for current Node.js ($(node -v))...${NC}"
    echo "See $LOG_DIR/native-check.log for the original load error."

    cd "$PROJECT_DIR"
    pnpm rebuild better-sqlite3
    
    # Fix node-pty spawn-helper execute permissions (pnpm install strips them)
    find "$PROJECT_DIR/node_modules" -path "*/node-pty/prebuilds/*/spawn-helper" -exec chmod +x {} + 2>/dev/null || true

    cd "$SERVER_DIR"
    if ! node -e "require('better-sqlite3'); require('@lydell/node-pty')" >/dev/null 2>>"$LOG_DIR/native-check.log"; then
        echo -e "${RED}Failed to load native modules after rebuild. Check $LOG_DIR/native-check.log${NC}"
        return 1
    fi
}

# Function to start server
start_server() {
    echo -e "${YELLOW}Starting backend server...${NC}"
    
    # Check if already running
    if [ -f "$PID_DIR/server.pid" ]; then
        local pid=$(cat "$PID_DIR/server.pid")
        if is_running "$pid" && validate_or_migrate_process_identity "server" "$pid"; then
            echo -e "${YELLOW}Server already running (PID: $pid)${NC}"
            return 0
        fi
        rm -f "$PID_DIR/server.pid" "$PID_DIR/server.start"
    fi
    
    # Check if server port is in use
    if port_in_use "$SERVER_PORT"; then
        echo -e "${RED}Port $SERVER_PORT is already in use${NC}"
        echo "Run './stop.sh' first or kill the process using port $SERVER_PORT"
        return 1
    fi
    
    # Start server
    check_native_modules
    cd "$SERVER_DIR"
    nohup pnpm exec tsx src/index.ts > "$LOG_DIR/server.log" 2>&1 &
    local pid=$!
    echo $pid > "$PID_DIR/server.pid"
    if ! record_process_identity "server" "$pid"; then
        kill "$pid" 2>/dev/null || true
        rm -f "$PID_DIR/server.pid" "$PID_DIR/server.start"
        return 1
    fi
    
    # Wait for server to start
    echo -n "Waiting for server to start"
    for i in {1..30}; do
        if port_in_use "$SERVER_PORT"; then
            echo ""
            echo -e "${GREEN}✓ Backend server started (PID: $pid)${NC}"
            echo -e "  ${GREEN}http://localhost:$SERVER_PORT${NC}"
            return 0
        fi
        echo -n "."
        sleep 0.5
    done
    
    echo ""
    echo -e "${RED}✗ Server failed to start. Check $LOG_DIR/server.log${NC}"
    return 1
}

# Function to start client
start_client() {
    echo -e "${YELLOW}Starting frontend client...${NC}"
    
    # Check if already running
    if [ -f "$PID_DIR/client.pid" ]; then
        local pid=$(cat "$PID_DIR/client.pid")
        if is_running "$pid" && validate_or_migrate_process_identity "client" "$pid"; then
            echo -e "${YELLOW}Client already running (PID: $pid)${NC}"
            return 0
        fi
        rm -f "$PID_DIR/client.pid" "$PID_DIR/client.start"
    fi
    
    # Check if client port is in use
    if port_in_use "$CLIENT_PORT"; then
        echo -e "${RED}Port $CLIENT_PORT is already in use${NC}"
        echo "Run './stop.sh' first or kill the process using port $CLIENT_PORT"
        return 1
    fi
    
    # Start client
    cd "$CLIENT_DIR"
    nohup pnpm exec vite --port "$CLIENT_PORT" --strictPort > "$LOG_DIR/client.log" 2>&1 &
    local pid=$!
    echo $pid > "$PID_DIR/client.pid"
    if ! record_process_identity "client" "$pid"; then
        kill "$pid" 2>/dev/null || true
        rm -f "$PID_DIR/client.pid" "$PID_DIR/client.start"
        return 1
    fi
    
    # Wait for client to start
    echo -n "Waiting for client to start"
    for i in {1..30}; do
        if port_in_use "$CLIENT_PORT"; then
            echo ""
            echo -e "${GREEN}✓ Frontend client started (PID: $pid)${NC}"
            echo -e "  ${GREEN}http://localhost:$CLIENT_PORT${NC}"
            return 0
        fi
        echo -n "."
        sleep 0.5
    done
    
    echo ""
    echo -e "${RED}✗ Client failed to start. Check $LOG_DIR/client.log${NC}"
    return 1
}

# Main
echo "=========================================="
echo "       Pi Cloud - Starting Servers"
echo "=========================================="
echo ""

# Check dependencies
if [ ! -d "$SERVER_DIR/node_modules" ] || [ ! -d "$CLIENT_DIR/node_modules" ]; then
    echo -e "${YELLOW}Installing dependencies first...${NC}"
    cd "$PROJECT_DIR"
    pnpm install
fi

# Start servers
start_server
echo ""
start_client

echo ""
echo "=========================================="
echo -e "${GREEN}Both servers started successfully!${NC}"
echo ""
echo "  Frontend: http://localhost:$CLIENT_PORT"
echo "  Backend:  http://localhost:$SERVER_PORT"
echo ""
echo "  Logs: $LOG_DIR/"
echo "  PIDs: $PID_DIR/"
echo ""
echo "  Stop with: ./stop.sh"
echo "=========================================="
