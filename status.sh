#!/bin/bash

# Pi Cloud Status Script
# Check current status of backend and frontend servers

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Configuration
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_DIR="$PROJECT_DIR/.pids"
LOG_DIR="$PROJECT_DIR/.logs"
ENV_PORT=$(grep -E '^PORT=' "$PROJECT_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
ENV_FRONTEND_PORT=$(grep -E '^FRONTEND_PORT=' "$PROJECT_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
SERVER_PORT="${PORT:-${ENV_PORT:-3000}}"
CLIENT_PORT="${FRONTEND_PORT:-${ENV_FRONTEND_PORT:-5173}}"

# Function to check if process is running
is_running() {
    local pid=$1
    kill -0 "$pid" 2>/dev/null
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

# Function to get process info on port
get_port_process() {
    local port=$1
    if command -v lsof >/dev/null 2>&1; then
        lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1
    elif command -v ss >/dev/null 2>&1; then
        ss -tlnp "sport = :$port" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1
    fi
}

# Function to check server health
check_health() {
    local url=$1
    local response=$(curl -s --noproxy localhost --max-time 3 "$url" 2>/dev/null)
    if [ $? -eq 0 ] && [ -n "$response" ]; then
        echo "$response"
        return 0
    fi
    return 1
}

# Function to get file age in human readable format
file_age() {
    local file=$1
    if [ -f "$file" ]; then
        local mod_time=$(stat -c %Y "$file" 2>/dev/null || stat -f %m "$file" 2>/dev/null)
        local now=$(date +%s)
        local age=$((now - mod_time))
        
        if [ $age -lt 60 ]; then
            echo "${age}s ago"
        elif [ $age -lt 3600 ]; then
            echo "$((age / 60))m ago"
        elif [ $age -lt 86400 ]; then
            echo "$((age / 3600))h ago"
        else
            echo "$((age / 86400))d ago"
        fi
    fi
}

# Function to get log file size
log_size() {
    local file=$1
    if [ -f "$file" ]; then
        local size=$(wc -c < "$file" 2>/dev/null | tr -d ' ')
        if [ $size -lt 1024 ]; then
            echo "${size}B"
        elif [ $size -lt 1048576 ]; then
            echo "$((size / 1024))KB"
        else
            echo "$((size / 1048576))MB"
        fi
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
echo ""
echo -e "${BOLD}=========================================="
echo "       Pi Cloud - Status Report"
echo -e "==========================================${NC}"
echo ""

# Current time
echo -e "${BLUE}Current Time:${NC} $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# Backend Server Status
echo -e "${BOLD}Backend Server (Fastify)${NC}"
echo -e "  Port: ${CYAN}$SERVER_PORT${NC}"

# Check PID file
if [ -f "$PID_DIR/server.pid" ]; then
    server_pid=$(cat "$PID_DIR/server.pid")
    if is_running "$server_pid"; then
        echo -e "  Status: ${GREEN}● Running${NC}"
        echo -e "  PID: ${CYAN}$server_pid${NC}"
        
        # Check port
        if port_in_use "$SERVER_PORT"; then
            port_pid=$(get_port_process "$SERVER_PORT")
            echo -e "  Port PID: ${CYAN}$port_pid${NC}"
        fi
        
        # Health check
        health=$(check_health "http://localhost:$SERVER_PORT/api/health")
        if [ -n "$health" ]; then
            echo -e "  Health: ${GREEN}✓ OK${NC}"
            timestamp=$(echo "$health" | grep -o '"timestamp":"[^"]*"' | cut -d'"' -f4)
            if [ -n "$timestamp" ]; then
                echo -e "  Timestamp: ${CYAN}$timestamp${NC}"
            fi
        else
            echo -e "  Health: ${YELLOW}⚠ Not responding${NC}"
        fi
    else
        echo -e "  Status: ${RED}● Not Running${NC} (stale PID file)"
        echo -e "  Stale PID: ${CYAN}$server_pid${NC}"
    fi
else
    echo -e "  Status: ${RED}● Not Running${NC} (no PID file)"
fi

# Check port independently
if port_in_use "$SERVER_PORT" && ! [ -f "$PID_DIR/server.pid" ]; then
    port_pid=$(get_port_process "$SERVER_PORT")
    echo -e "  ${YELLOW}⚠ Port $SERVER_PORT in use by PID: $port_pid${NC}"
fi

echo ""

# Frontend Client Status
echo -e "${BOLD}Frontend Client (Vite)${NC}"
echo -e "  Port: ${CYAN}$CLIENT_PORT${NC}"

# Check PID file
if [ -f "$PID_DIR/client.pid" ]; then
    client_pid=$(cat "$PID_DIR/client.pid")
    if is_running "$client_pid"; then
        echo -e "  Status: ${GREEN}● Running${NC}"
        echo -e "  PID: ${CYAN}$client_pid${NC}"
        
        # Check port
        if port_in_use "$CLIENT_PORT"; then
            port_pid=$(get_port_process "$CLIENT_PORT")
            echo -e "  Port PID: ${CYAN}$port_pid${NC}"
        fi
        
        # Check if accessible
        if curl -s --noproxy localhost --max-time 3 "http://localhost:$CLIENT_PORT" >/dev/null 2>&1; then
            echo -e "  Health: ${GREEN}✓ Accessible${NC}"
        else
            echo -e "  Health: ${YELLOW}⚠ Not responding${NC}"
        fi
    else
        echo -e "  Status: ${RED}● Not Running${NC} (stale PID file)"
        echo -e "  Stale PID: ${CYAN}$client_pid${NC}"
    fi
else
    echo -e "  Status: ${RED}● Not Running${NC} (no PID file)"
fi

# Check port independently
if port_in_use "$CLIENT_PORT" && ! [ -f "$PID_DIR/client.pid" ]; then
    port_pid=$(get_port_process "$CLIENT_PORT")
    echo -e "  ${YELLOW}⚠ Port $CLIENT_PORT in use by PID: $port_pid${NC}"
fi

echo ""

# Logs Status
echo -e "${BOLD}Logs${NC}"
if [ -d "$LOG_DIR" ]; then
    if [ -f "$LOG_DIR/server.log" ]; then
        echo -e "  Server: ${CYAN}$LOG_DIR/server.log${NC} $(log_size "$LOG_DIR/server.log") - $(file_age "$LOG_DIR/server.log")"
    else
        echo -e "  Server: ${YELLOW}No log file${NC}"
    fi
    
    if [ -f "$LOG_DIR/client.log" ]; then
        echo -e "  Client: ${CYAN}$LOG_DIR/client.log${NC} $(log_size "$LOG_DIR/client.log") - $(file_age "$LOG_DIR/client.log")"
    else
        echo -e "  Client: ${YELLOW}No log file${NC}"
    fi
else
    echo -e "  ${YELLOW}No logs directory${NC}"
fi

echo ""

# PID Files Status
echo -e "${BOLD}PID Files${NC}"
if [ -d "$PID_DIR" ]; then
    if [ -f "$PID_DIR/server.pid" ]; then
        echo -e "  Server: ${CYAN}$PID_DIR/server.pid${NC} - $(file_age "$PID_DIR/server.pid")"
    else
        echo -e "  Server: ${YELLOW}No PID file${NC}"
    fi
    
    if [ -f "$PID_DIR/client.pid" ]; then
        echo -e "  Client: ${CYAN}$PID_DIR/client.pid${NC} - $(file_age "$PID_DIR/client.pid")"
    else
        echo -e "  Client: ${YELLOW}No PID file${NC}"
    fi
else
    echo -e "  ${YELLOW}No PID directory${NC}"
fi

echo ""

# Connection Summary
echo -e "${BOLD}Connection Summary${NC}"
echo -e "  Frontend URL: ${CYAN}http://localhost:$CLIENT_PORT${NC}"
echo -e "  Backend URL:  ${CYAN}http://localhost:$SERVER_PORT${NC}"
echo -e "  Health Check: ${CYAN}http://localhost:$SERVER_PORT/api/health${NC}"

# Quick actions
echo ""
echo -e "${BOLD}Quick Actions${NC}"
echo -e "  Start:  ${CYAN}./start.sh${NC}"
echo -e "  Stop:   ${CYAN}./stop.sh${NC}"
echo -e "  Logs:   ${CYAN}tail -f .logs/server.log${NC}"
echo -e "          ${CYAN}tail -f .logs/client.log${NC}"

echo ""
echo -e "${BOLD}==========================================${NC}"
