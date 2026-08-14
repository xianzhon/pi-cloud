#!/bin/bash

# Pi WebUI Stop Script
# Stops both backend (Fastify) and frontend (Vite) servers

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_DIR="$PROJECT_DIR/.pids"
ENV_PORT=$(grep -E '^PORT=' "$PROJECT_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
ENV_FRONTEND_PORT=$(grep -E '^FRONTEND_PORT=' "$PROJECT_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
SERVER_PORT="${PORT:-${ENV_PORT:-3000}}"
CLIENT_PORT="${FRONTEND_PORT:-${ENV_FRONTEND_PORT:-5173}}"

# Function to stop a process
stop_process() {
    local name=$1
    local pid_file="$PID_DIR/$name.pid"
    
    if [ ! -f "$pid_file" ]; then
        echo -e "${YELLOW}No $name PID file found${NC}"
        return 0
    fi
    
    local pid=$(cat "$pid_file")
    
    if kill -0 "$pid" 2>/dev/null; then
        echo -e "${YELLOW}Stopping $name (PID: $pid)...${NC}"
        kill "$pid" 2>/dev/null || true
        
        # Wait for process to stop
        local count=0
        while kill -0 "$pid" 2>/dev/null; do
            if [ $count -ge 10 ]; then
                echo -e "${YELLOW}Force killing $name...${NC}"
                kill -9 "$pid" 2>/dev/null || true
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
    rm -f "$pid_file"
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

# Function to kill processes on specific ports
kill_port() {
    local port=$1
    local pids=""

    if command -v lsof >/dev/null 2>&1; then
        pids=$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
    elif command -v ss >/dev/null 2>&1; then
        pids=$(ss -tlnp "sport = :$port" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u | tr '\n' ' ')
    fi
    
    if [ -n "$pids" ]; then
        echo -e "${YELLOW}Killing processes listening on port $port...${NC}"
        echo "$pids" | xargs kill -9 2>/dev/null || true

        # Verify the port was actually freed.
        sleep 0.5
        if port_in_use "$port"; then
            echo -e "${RED}✗ Port $port is still in use${NC}"
            return 1
        fi

        echo -e "${GREEN}✓ Processes on port $port killed${NC}"
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
echo "       Pi WebUI - Stopping Servers"
echo "=========================================="
echo ""

# Stop by PID files
stop_process "server"
stop_process "client"

# Also kill any remaining processes on the ports
echo ""
echo -e "${YELLOW}Cleaning up any remaining processes...${NC}"
kill_port "$SERVER_PORT"
kill_port "$CLIENT_PORT"

# Clean up any tsx/vite processes related to this project
echo ""
echo -e "${YELLOW}Cleaning up related processes...${NC}"
pkill -f "tsx.*pi-webui" 2>/dev/null || true
pkill -f "vite.*pi-webui" 2>/dev/null || true

echo ""
echo "=========================================="
echo -e "${GREEN}All servers stopped!${NC}"
echo ""
echo "  PID files cleaned up"
echo "  Ports $SERVER_PORT and $CLIENT_PORT freed"
echo ""
echo "  Start again with: ./start.sh"
echo "=========================================="
