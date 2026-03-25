#!/bin/bash

echo "🤖 启动 Agent 协作 UI..."
echo ""

# 启动后端服务
cd "$(dirname "$0")/server"
node server.js &
SERVER_PID=$!

echo "后端服务已启动 (PID: $SERVER_PID)"
echo ""

# 等待服务启动
sleep 2

# 打开前端页面
echo "打开前端页面..."
open ../realtime.html

echo ""
echo "✅ 启动完成！"
echo ""
echo "服务地址："
echo "  HTTP:  http://localhost:3100"
echo "  WS:    ws://localhost:3101"
echo ""
echo "按 Ctrl+C 停止服务"

# 等待中断信号
trap "kill $SERVER_PID; exit" INT TERM
wait $SERVER_PID
