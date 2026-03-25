# 🚀 快速启动指南

## 一键启动

```bash
cd ~/.openclaw/workspace/projects/agent-collab-ui
./start.sh
```

## 手动启动

### 1. 启动后端服务

```bash
cd ~/.openclaw/workspace/projects/agent-collab-ui/server
node server.js
```

### 2. 打开前端页面

```bash
open ~/.openclaw/workspace/projects/agent-collab-ui/realtime.html
```

## 📱 访问地址

| 服务 | 地址 |
|------|------|
| **前端页面** | file:///Users/yuanlifeng/.openclaw/workspace/projects/agent-collab-ui/realtime.html |
| **HTTP API** | http://localhost:3100 |
| **WebSocket** | ws://localhost:3101 |
| **OpenClaw** | http://localhost:18789 |

## 🎮 功能说明

### Agent 状态监控
- ✅ 实时显示 Agent 在线/忙碌/离线状态
- ✅ 自动更新（每 3 秒）
- ✅ 显示当前任务

### 消息交互
- ✅ 点击 Agent 查看详情
- ✅ 输入框发送消息
- ✅ 快速操作按钮（分配任务、查看进度、征求意见）

### 数据持久化
- ✅ 自动保存聊天记录到浏览器本地存储
- ✅ 后端数据存储（最多 1000 条消息）
- ✅ 页面刷新不丢失数据

### 数据管理
- 📥 **导出记录** - 导出聊天记录为 JSON 文件
- 🗑️ **清除记录** - 清除所有聊天记录

## 📁 项目结构

```
agent-collab-ui/
├── index.html          # 基础版（离线演示）
├── workspace.html      # 增强版（模拟数据）
├── realtime.html       # 实时版（真实 API）⭐
├── server/             # 后端服务
│   ├── server.js       # 主服务文件
│   ├── package.json    # 依赖配置
│   └── data/           # 数据存储
│       ├── messages.json  # 消息记录
│       └── tasks.json     # 任务记录
├── start.sh            # 一键启动脚本
└── README.md           # 项目文档
```

## 🔧 常见问题

### Q: 页面显示"连接中..."
A: 后端服务未启动，请先运行 `node server.js`

### Q: Agent 状态显示"离线"
A: OpenClaw Gateway 未启动或未检测到活跃会话

### Q: 消息发送失败
A: 检查 OpenClaw Gateway 是否运行在 `localhost:18789`

### Q: 如何清除所有数据
A: 点击页面右上角的 🗑️ 按钮，或手动删除 `server/data/` 目录

## 🎯 下一步

1. **测试消息发送** - 选择一个 Agent，输入消息
2. **查看历史记录** - 刷新页面，消息不会丢失
3. **导出数据** - 点击 📥 按钮导出聊天记录
4. **连接真实 Agent** - 启动 OpenClaw，查看真实状态

---

**创建时间**: 2026-03-24
**最后更新**: 2026-03-24 22:31 GMT+8
