# 贡献指南

感谢您对 Pixel Office 的兴趣！

## 项目状态

⚠️ **重要提示**：本项目目前仅作展示用途，不再接受功能更新或 PR。

如果您有兴趣自行维护，欢迎 fork 本项目。

## Fork 后维护建议

### 1. 代码结构

```
agent-collab-ui/
├── index.html          # 主页面（像素办公室）
├── workspace.html      # 工作台布局
├── realtime.html       # 实时连接版本
├── server/             # Node.js 后端
│   ├── server.js
│   └── data/
└── public/             # 静态资源
```

### 2. 开发环境

```bash
# 1. Fork 并克隆仓库
git clone https://github.com/YOUR_USERNAME/pixel-office.git
cd pixel-office

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env 填入您的配置

# 3. 启动后端（可选）
cd server
npm install
node server.js

# 4. 打开前端页面
# 直接用浏览器打开 index.html
# 或启动本地服务器
python -m http.server 8080
```

### 3. 主要修改点

如果您想扩展功能，可以关注以下模块：

- **Agent 可视化**: `index.html` 中的 Canvas 绘制逻辑
- **消息系统**: `realtime.html` 中的 WebSocket 连接
- **任务看板**: `updateTaskList()` 函数
- **飞书集成**: `server/routes/feishu.js`

### 4. 提交规范

如果维护 fork 版本，建议遵循：

```
feat: 新增功能
tix: 修复问题
docs: 文档更新
refactor: 重构代码
```

## 许可证

本项目采用 MIT 许可证，fork 后可自由使用。

## 联系方式

如有问题，可以通过 GitHub Issues 讨论。

---

**感谢支持！** 🎉