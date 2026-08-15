#!/bin/bash

# Pi WebUI Start Script
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
        if is_running "$pid"; then
            echo -e "${YELLOW}Server already running (PID: $pid)${NC}"
            return 0
        fi
        rm "$PID_DIR/server.pid"
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
        if is_running "$pid"; then
            echo -e "${YELLOW}Client already running (PID: $pid)${NC}"
            return 0
        fi
        rm "$PID_DIR/client.pid"
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
echo "       Pi WebUI - Starting Servers"
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
