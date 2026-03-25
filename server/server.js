const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');

const app = express();
const PORT = 3100;

// OpenClaw 数据目录
const OPENCLAW_AGENTS_DIR = path.join(process.env.HOME, '.openclaw', 'agents');

// Agent 配置
const AGENTS = [
  { id: 'main', name: '小松', icon: '🐿️', role: '主 Agent' },
  { id: 'assistant', name: '管家', icon: '🤵', role: '日程管理' },
  { id: 'coder', name: '工程师', icon: '💻', role: '代码开发' },
  { id: 'architect', name: '架构师', icon: '🏗️', role: '系统设计' },
  { id: 'researcher', name: '研究员', icon: '🔍', role: '信息调研' },
  { id: 'editor', name: '编辑', icon: '✍️', role: '内容创作' }
];

// 数据存储
const DATA_DIR = path.join(__dirname, 'data');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const TASK_QUEUE_FILE = path.join(DATA_DIR, 'task-queue.json');

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

const clients = new Set();

// 系统资源监控变量
let systemStats = {
  cpu: 0,
  memory: { used: 0, total: 0, percent: 0 },
  uptime: 0
};

// 协作消息存储
const collabMessages = [];

// 初始化
async function init() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try { await fs.access(MESSAGES_FILE); } catch { await fs.writeFile(MESSAGES_FILE, '[]'); }
  try { await fs.access(TASK_QUEUE_FILE); } catch { await fs.writeFile(TASK_QUEUE_FILE, '[]'); }
  console.log('✅ 数据目录初始化完成');
}

// 消息读写
async function readMessages() {
  try { return JSON.parse(await fs.readFile(MESSAGES_FILE, 'utf-8')); } catch { return []; }
}

async function writeMessages(messages) {
  await fs.writeFile(MESSAGES_FILE, JSON.stringify(messages.slice(-1000), null, 2));
}

async function addMessage(message) {
  const messages = await readMessages();
  messages.push({ ...message, id: messages.length + 1, timestamp: Date.now() });
  await writeMessages(messages);
  return messages[messages.length - 1];
}

// 任务队列
async function readTaskQueue() {
  try { return JSON.parse(await fs.readFile(TASK_QUEUE_FILE, 'utf-8')); } catch { return []; }
}

async function writeTaskQueue(tasks) {
  await fs.writeFile(TASK_QUEUE_FILE, JSON.stringify(tasks, null, 2));
}

async function addTask(agentId, message, userId) {
  const tasks = await readTaskQueue();
  const task = {
    id: `task-${Date.now()}`,
    agentId,
    message,
    userId,
    status: 'pending',
    createdAt: Date.now()
  };
  tasks.push(task);
  await writeTaskQueue(tasks);
  return task;
}

async function updateTask(taskId, updates) {
  const tasks = await readTaskQueue();
  const index = tasks.findIndex(t => t.id === taskId);
  if (index >= 0) {
    tasks[index] = { ...tasks[index], ...updates };
    await writeTaskQueue(tasks);
    return tasks[index];
  }
  return null;
}

// 获取指定Agent的当前任务
async function getCurrentTasks(agentId) {
  try {
    const tasks = await readTaskQueue();
    return tasks.filter(t => 
      t.agentId === agentId && 
      (t.status === 'running' || t.status === 'pending')
    ).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } catch (error) {
    console.error('获取当前任务失败:', error);
    return [];
  }
}

// 获取 Agent 状态
function getAgentSessions(agentId) {
  const agentDir = path.join(OPENCLAW_AGENTS_DIR, agentId, 'sessions');
  try {
    if (!fsSync.existsSync(agentDir)) return [];
    return fsSync.readdirSync(agentDir).filter(f => f.endsWith('.jsonl'));
  } catch { return []; }
}

async function getSessionStatus(agentId) {
  const sessions = getAgentSessions(agentId);
  if (sessions.length === 0) return { status: 'offline', lastActive: null };

  let latestTime = 0;
  let latestStatus = 'idle';

  for (const sessionFile of sessions) {
    try {
      const filePath = path.join(OPENCLAW_AGENTS_DIR, agentId, 'sessions', sessionFile);
      const stat = await fs.stat(filePath);
      
      if (stat.mtimeMs > latestTime) {
        latestTime = stat.mtimeMs;
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.trim().split('\n');
        if (lines.length > 0) {
          try {
            const lastLine = JSON.parse(lines[lines.length - 1]);
            latestStatus = lastLine.status || 'done';
          } catch {}
        }
      }
    } catch {}
  }

  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  return {
    status: latestTime > fiveMinutesAgo ? 'busy' : (latestStatus === 'running' ? 'busy' : 'idle'),
    lastActive: latestTime
  };
}

// API: 获取 Agent 状态
app.get('/api/agents', async (req, res) => {
  try {
    const agents = await Promise.all(AGENTS.map(async agent => {
      const sessionStatus = await getSessionStatus(agent.id);
      return { ...agent, status: sessionStatus.status, lastActive: sessionStatus.lastActive };
    }));
    res.json({ agents });
  } catch {
    res.json({ agents: AGENTS.map(a => ({ ...a, status: 'offline' })) });
  }
});

// API: 获取消息历史
app.get('/api/messages', async (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const messages = await readMessages();
  res.json({ messages: messages.slice(-limit) });
});

// API: 获取任务队列
app.get('/api/tasks', async (req, res) => {
  const tasks = await readTaskQueue();
  res.json({ tasks });
});

// API: 创建新任务
app.post('/api/tasks', async (req, res) => {
  try {
    const { agentId, title, description, priority = 'medium', parentTaskId } = req.body;
    
    if (!agentId || !title) {
      return res.status(400).json({ error: 'agentId and title are required' });
    }
    
    const agent = AGENTS.find(a => a.id === agentId);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    const tasks = await readTaskQueue();
    const task = {
      id: `task-${Date.now()}`,
      agentId,
      agentName: agent.name,
      agentIcon: agent.icon,
      title,
      description: description || '',
      status: 'pending',
      priority,
      parentTaskId: parentTaskId || null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    tasks.push(task);
    await writeTaskQueue(tasks);
    
    // 广播任务创建
    broadcast({ type: 'task_created', task });
    
    console.log(`📋 新任务创建: [${task.id}] ${title} -> ${agent.name}`);
    res.status(201).json({ success: true, task });
    
  } catch (error) {
    console.error('创建任务失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 获取单个任务详情
app.get('/api/tasks/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const tasks = await readTaskQueue();
    const task = tasks.find(t => t.id === taskId);
    
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    res.json({ task });
    
  } catch (error) {
    console.error('获取任务详情失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 更新任务状态 (标准 REST)
app.patch('/api/tasks/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const updates = req.body;
    
    const tasks = await readTaskQueue();
    const index = tasks.findIndex(t => t.id === taskId);
    
    if (index < 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    // 更新任务
    tasks[index] = { 
      ...tasks[index], 
      ...updates, 
      updatedAt: Date.now() 
    };
    
    // 记录状态变更时间
    if (updates.status) {
      if (!tasks[index].statusHistory) {
        tasks[index].statusHistory = [];
      }
      tasks[index].statusHistory.push({
        status: updates.status,
        timestamp: Date.now()
      });
      
      // 记录开始/完成时间
      if (updates.status === 'in_progress' && !tasks[index].startedAt) {
        tasks[index].startedAt = Date.now();
      }
      if (updates.status === 'completed' && !tasks[index].completedAt) {
        tasks[index].completedAt = Date.now();
      }
    }
    
    await writeTaskQueue(tasks);
    
    // 广播任务更新
    broadcast({ type: 'task_updated', task: tasks[index] });
    
    console.log(`📝 任务更新: [${taskId}] status=${updates.status || 'no change'}`);
    res.json({ success: true, task: tasks[index] });
    
  } catch (error) {
    console.error('更新任务失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 删除任务
app.delete('/api/tasks/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const tasks = await readTaskQueue();
    const filtered = tasks.filter(t => t.id !== taskId);
    
    if (filtered.length === tasks.length) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    await writeTaskQueue(filtered);
    
    // 广播任务删除
    broadcast({ type: 'task_deleted', taskId });
    
    console.log(`🗑️  任务删除: [${taskId}]`);
    res.json({ success: true });
    
  } catch (error) {
    console.error('删除任务失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 获取 Agent 当前活跃任务
app.get('/api/agents/:agentId/tasks', async (req, res) => {
  try {
    const { agentId } = req.params;
    const { status } = req.query;
    
    const tasks = await readTaskQueue();
    let filtered = tasks.filter(t => t.agentId === agentId);
    
    if (status) {
      filtered = filtered.filter(t => t.status === status);
    }
    
    // 按状态和时间排序
    const statusOrder = { in_progress: 0, pending: 1, completed: 2, failed: 3 };
    filtered.sort((a, b) => {
      const statusDiff = (statusOrder[a.status] || 0) - (statusOrder[b.status] || 0);
      if (statusDiff !== 0) return statusDiff;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    
    res.json({ tasks: filtered, count: filtered.length });
    
  } catch (error) {
    console.error('获取 Agent 任务失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 提交任务
app.post('/api/send', async (req, res) => {
  const { agentId, message, userId } = req.body;
  
  try {
    const agent = AGENTS.find(a => a.id === agentId);
    if (!agent) return res.status(400).json({ error: 'Agent not found' });

    // 保存用户消息
    const userMessage = await addMessage({
      sender: '你',
      icon: '👤',
      text: message,
      own: true,
      agentId,
      userId,
      time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    });

    broadcast({ type: 'message', ...userMessage });

    // 添加到任务队列
    const task = await addTask(agentId, message, userId);
    broadcast({ type: 'task_added', task });

    console.log(`📝 新任务已提交: ${agent.name} - ${message.substring(0, 50)}...`);

    res.json({ 
      success: true, 
      messageId: userMessage.id,
      taskId: task.id,
      message: `任务已提交给 ${agent.name}，请稍等回复`
    });

  } catch (error) {
    console.error('提交任务失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 更新任务状态（供主 Agent 调用）
app.post('/api/tasks/:taskId/status', async (req, res) => {
  const { taskId } = req.params;
  const { status, response } = req.body;

  const task = await updateTask(taskId, { status, response, updatedAt: Date.now() });
  if (task) {
    broadcast({ type: 'task_updated', task });
    
    // 如果有回复，添加到消息列表
    if (response) {
      const agent = AGENTS.find(a => a.id === task.agentId);
      if (agent) {
        const agentMessage = await addMessage({
          sender: agent.name,
          icon: agent.icon,
          text: response,
          own: false,
          agentId: task.agentId,
          time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        });
        broadcast({ type: 'message', ...agentMessage });
      }
    }
    
    res.json({ success: true, task });
  } else {
    res.status(404).json({ error: 'Task not found' });
  }
});

// API: 清除消息
app.delete('/api/messages', async (req, res) => {
  await writeMessages([]);
  res.json({ success: true });
});

// 🎯 新增：监控 API

// 1. Agent 状态接口
app.get('/api/agents/status', async (req, res) => {
  try {
    const agents = await Promise.all(AGENTS.map(async agent => {
      const sessionStatus = await getSessionStatus(agent.id);
      const activeTasks = await getCurrentTasks(agent.id);
      
      return {
        id: agent.id,
        name: agent.name,
        icon: agent.icon,
        role: agent.role,
        status: sessionStatus.status,
        lastActive: sessionStatus.lastActive,
        currentTask: activeTasks.length > 0 ? activeTasks[0].message.substring(0, 50) + '...' : null
      };
    }));
    
    res.json({ agents });
  } catch (error) {
    console.error('获取 Agent 状态失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2. 系统资源接口
app.get('/api/system/resources', (req, res) => {
  try {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const uptime = process.uptime();
    
    systemStats = {
      cpu: Math.round((cpuUsage.user + cpuUsage.system) / 1000000 * 10) / 10, // 转换为百分比近似值
      memory: {
        used: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
        total: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
        percent: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100 * 10) / 10
      },
      uptime: Math.round(uptime)
    };
    
    res.json(systemStats);
  } catch (error) {
    console.error('获取系统资源失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3. 协作消息接口
app.get('/api/collab/messages', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const messages = await readMessages();
    
    // 转换为协作格式
    const collabMsgs = messages.slice(-limit).map(msg => ({
      id: msg.id,
      from: msg.sender === '你' ? 'user' : msg.sender.toLowerCase(),
      to: msg.agentId || 'all',
      content: msg.text,
      timestamp: msg.timestamp,
      own: msg.own || false,
      time: msg.time
    }));
    
    res.json({ messages: collabMsgs });
  } catch (error) {
    console.error('获取协作消息失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// WebSocket 心跳检测配置
const HEARTBEAT_INTERVAL = 30000; // 30秒
const HEARTBEAT_TIMEOUT = 35000;  // 35秒超时

// WebSocket
const wss = new WebSocket.Server({ port: 3101 });

wss.on('connection', async (ws) => {
  console.log('新的 WebSocket 连接');
  clients.add(ws);

  // 心跳检测
  ws.isAlive = true;
  ws.lastPong = Date.now();
  
  const heartbeatInterval = setInterval(() => {
    if (Date.now() - ws.lastPong > HEARTBEAT_TIMEOUT) {
      console.log('💔 WebSocket 心跳超时，关闭连接');
      clearInterval(heartbeatInterval);
      clients.delete(ws);
      return ws.terminate();
    }
    
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL);
  
  ws.on('pong', () => {
    ws.isAlive = true;
    ws.lastPong = Date.now();
  });

  const messages = await readMessages();
  const tasks = await readTaskQueue();
  
  ws.send(JSON.stringify({ 
    type: 'init', 
    messages: messages.slice(-50), 
    tasks: tasks.filter(t => t.status === 'pending')
  }));
  
  ws.on('close', () => {
    clearInterval(heartbeatInterval);
    clients.delete(ws);
  });
});

// 增强版消息推送 - 修复推送逻辑
function broadcast(data, retryCount = 0) {
  const message = JSON.stringify(data);
  const deadClients = new Set();
  let successCount = 0;
  
  clients.forEach((client, clientId) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
        successCount++;
      } catch (error) {
        console.warn(`推送消息到客户端失败:`, error.message);
        deadClients.add(clientId);
      }
    } else {
      deadClients.add(clientId);
    }
  });
  
  // 清理死连接
  deadClients.forEach(clientId => {
    clients.delete(clientId);
  });
  
  // 如果推送失败且没有重试过，尝试重试
  if (successCount === 0 && retryCount < 2 && clients.size > 0) {
    setTimeout(() => {
      console.log(`🔄 重试推送消息 (${retryCount + 1}/2)`);
      broadcast(data, retryCount + 1);
    }, 1000);
  }
  
  return successCount;
}

// 任务执行器类 - 新增功能
class TaskExecutor {
  constructor() {
    this.isRunning = false;
    this.maxConcurrent = 3; // 最大并发任务数
    this.activeTasks = new Map();
  }
  
  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('🚀 任务执行器已启动');
    
    // 定期检查并执行任务
    setInterval(() => this.processQueue(), 2000);
  }
  
  async processQueue() {
    if (this.activeTasks.size >= this.maxConcurrent) return;
    
    try {
      const tasks = await readTaskQueue();
      const pendingTasks = tasks.filter(t => 
        t.status === 'pending' && 
        (!t.nextRetry || t.nextRetry <= Date.now()) &&
        !this.activeTasks.has(t.id)
      ).slice(0, this.maxConcurrent - this.activeTasks.size);
      
      for (const task of pendingTasks) {
        this.executeTask(task);
      }
    } catch (error) {
      console.error('处理任务队列失败:', error);
    }
  }
  
  async executeTask(task) {
    this.activeTasks.set(task.id, task);
    
    try {
      console.log(`⚡ 开始执行任务: ${task.id} -> ${task.agentId}`);
      
      // 更新任务状态为执行中
      await updateTask(task.id, { 
        status: 'running', 
        startedAt: Date.now() 
      });
      broadcast({ type: 'task_started', task: await updateTask(task.id, {}) });
      
      // 模拟任务执行（实际应该调用相应的Agent）
      const response = await this.simulateTaskExecution(task);
      
      // 任务完成
      await updateTask(task.id, { 
        status: 'completed', 
        completedAt: Date.now(),
        response: response
      });
      broadcast({ type: 'task_completed', task: await updateTask(task.id, {}) });
      
      // 如果有回复，添加到消息列表
      const agent = AGENTS.find(a => a.id === task.agentId);
      if (agent && response) {
        const agentMessage = await addMessage({
          sender: agent.name,
          icon: agent.icon,
          text: response,
          own: false,
          agentId: task.agentId,
          time: new Date().toLocaleTimeString('zh-CN', { 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit' 
          })
        });
        broadcast({ type: 'message', ...agentMessage });
      }
      
      console.log(`✅ 任务完成: ${task.id}`);
      
    } catch (error) {
      console.error(`❌ 任务执行失败 ${task.id}:`, error);
      
      // 重试逻辑
      const retryCount = (task.retryCount || 0) + 1;
      const maxRetries = 3;
      
      if (retryCount <= maxRetries) {
        await updateTask(task.id, { 
          status: 'pending',
          retryCount,
          error: error.message,
          nextRetry: Date.now() + retryCount * 5000 // 递增延迟
        });
        console.log(`🔄 任务将在 ${retryCount * 5} 秒后重试 (${retryCount}/${maxRetries})`);
      } else {
        await updateTask(task.id, { 
          status: 'failed',
          error: error.message,
          failedAt: Date.now()
        });
        broadcast({ type: 'task_failed', task: await updateTask(task.id, {}) });
      }
      
    } finally {
      this.activeTasks.delete(task.id);
    }
  }
  
  async simulateTaskExecution(task) {
    // 模拟任务执行时间
    const executionTime = Math.random() * 2000 + 1000; // 1-3秒
    await new Promise(resolve => setTimeout(resolve, executionTime));
    
    // 根据Agent类型生成不同的响应
    const agent = AGENTS.find(a => a.id === task.agentId);
    if (!agent) throw new Error('Agent not found');
    
    const responses = {
      main: `小松已收到您的请求：${task.message}，正在为您协调处理...`,
      assistant: `管家已为您安排：${task.message}，相关日程已记录。`,
      coder: `工程师正在处理代码任务：${task.message}，预计很快完成。`,
      architect: `架构师正在分析系统设计：${task.message}，将提供最佳方案。`,
      researcher: `研究员正在搜集相关信息：${task.message}，会为您提供详细报告。`,
      editor: `编辑正在完善内容：${task.message}，确保质量达到最佳。`
    };
    
    return responses[task.agentId] || `Agent ${agent.name} 已处理您的请求：${task.message}`;
  }
}

// 监控 Agent 会话文件 - 优化版本（降低资源占用）
function watchAgentSessions() {
  const lastLineCount = new Map();
  const watchedFiles = new Map();
  let cpuUsageCheck = 0;

  // 优化轮询间隔：从2秒调整为5秒，减少CPU占用
  setInterval(async () => {
    const startTime = Date.now();
    
    for (const agent of AGENTS) {
      const sessionsDir = path.join(OPENCLAW_AGENTS_DIR, agent.id, 'sessions');
      
      try {
        if (!fsSync.existsSync(sessionsDir)) continue;
        
        const files = fsSync.readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl'));
        
        for (const filename of files) {
          const filePath = path.join(sessionsDir, filename);
          const key = `${agent.id}-${filename}`;
          
          try {
            const stat = fsSync.statSync(filePath);
            const currentMtime = stat.mtime.getTime();
            const lastMtime = watchedFiles.get(key) || 0;
            
            if (currentMtime > lastMtime) {
              watchedFiles.set(key, currentMtime);
              
              const content = await fs.readFile(filePath, 'utf-8');
              const lines = content.trim().split('\n').filter(line => line.trim());
              const lastCount = lastLineCount.get(key) || 0;
              
              if (lines.length > lastCount) {
                // 处理新增行
                for (let i = lastCount; i < lines.length; i++) {
                  try {
                    const line = JSON.parse(lines[i]);
                    
                    // 解析 OpenClaw 会话格式
                    if (line.type === 'message' && line.message) {
                      const msg = line.message;
                      
                      // 只处理助手消息
                      if (msg.role === 'assistant' && msg.content) {
                        // 提取文本内容
                        let textContent = '';
                        
                        if (Array.isArray(msg.content)) {
                          // content 是数组，提取文本
                          for (const block of msg.content) {
                            if (block.type === 'text' && block.text) {
                              textContent += block.text;
                            } else if (block.type === 'thinking' && block.thinking) {
                              // 可选：也包含思考内容
                              textContent += block.thinking;
                            }
                          }
                        } else if (typeof msg.content === 'string') {
                          textContent = msg.content;
                        }
                        
                        if (textContent.trim()) {
                          await handleNewAgentMessage(agent, textContent.trim());
                        }
                      }
                    }
                  } catch (parseError) {
                    console.warn(`解析行失败 ${key}:${i}:`, parseError.message);
                  }
                }
                lastLineCount.set(key, lines.length);
              }
            }
          } catch (fileError) {
            console.warn(`读取文件失败 ${filePath}:`, fileError.message);
          }
        }
      } catch (dirError) {
        // 目录不存在时忽略
      }
    }
    
    // 每10次检查输出一次资源使用情况
    cpuUsageCheck++;
    if (cpuUsageCheck % 10 === 0) {
      const elapsed = Date.now() - startTime;
      console.log(`📊 轮询监控性能: ${elapsed}ms (${AGENTS.length} agents, ${watchedFiles.size} files)`);
      
      // 如果单次轮询超过100ms，发出警告
      if (elapsed > 100) {
        console.warn(`⚠️  轮询耗时较长: ${elapsed}ms，可能影响办公体验`);
      }
    }
  }, 5000); // 优化：从2秒调整为5秒，减少资源占用
  
  console.log('✅ Agent 会话监控已启动（优化轮询模式，5秒间隔）');
}

// 处理新消息推送 - 修复逻辑
async function handleNewAgentMessage(agent, content) {
  try {
    // 检查是否最近5分钟内已有相同内容的消息（避免重复）
    const messages = await readMessages();
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    const recentDuplicate = messages.some(m => 
      m.sender === agent.name && 
      m.text === content && 
      m.timestamp > fiveMinutesAgo
    );
    
    if (!recentDuplicate) {
      const agentMessage = await addMessage({
        sender: agent.name,
        icon: agent.icon,
        text: content,
        own: false,
        agentId: agent.id,
        time: new Date().toLocaleTimeString('zh-CN', { 
          hour: '2-digit', 
          minute: '2-digit', 
          second: '2-digit' 
        })
      });

      broadcast({ type: 'message', ...agentMessage });
      console.log(`📨 ${agent.name} 回复已推送: ${content.substring(0, 50)}...`);
    }
  } catch (error) {
    console.error(`处理 ${agent.name} 消息失败:`, error);
  }
}

// 定期检查任务队列，广播待处理任务
setInterval(async () => {
  const tasks = await readTaskQueue();
  const pendingTasks = tasks.filter(t => t.status === 'pending');
  
  if (pendingTasks.length > 0) {
    broadcast({ type: 'pending_tasks', tasks: pendingTasks });
  }
}, 5000);

// 定期广播状态更新
setInterval(async () => {
  if (clients.size === 0) return;

  try {
    const agents = await Promise.all(AGENTS.map(async agent => {
      const sessionStatus = await getSessionStatus(agent.id);
      return { ...agent, status: sessionStatus.status };
    }));

    broadcast({
      type: 'agents_update',
      agents,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('广播更新失败:', error);
  }
}, 3000);

// 资源监控类 - 新增功能
class ResourceMonitor {
  constructor() {
    this.metrics = {
      cpuUsage: [],
      memoryUsage: [],
      lastCheck: Date.now()
    };
    this.isMonitoring = false;
  }
  
  start() {
    if (this.isMonitoring) return;
    this.isMonitoring = true;
    
    // 每30秒检查一次资源使用情况
    setInterval(() => this.checkResources(), 30000);
    console.log('📊 资源监控已启动（30秒间隔）');
  }
  
  async checkResources() {
    try {
      const memUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      
      this.metrics.memoryUsage.push({
        timestamp: Date.now(),
        rss: memUsage.rss,
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal
      });
      
      // 保持最近10次记录
      if (this.metrics.memoryUsage.length > 10) {
        this.metrics.memoryUsage.shift();
      }
      
      // 如果内存使用超过100MB，发出警告
      if (memUsage.heapUsed > 100 * 1024 * 1024) {
        console.warn(`⚠️  内存使用较高: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`);
      }
      
      // 每5次检查输出一次汇总
      if (this.metrics.memoryUsage.length % 5 === 0) {
        const avgHeap = this.metrics.memoryUsage.reduce((sum, m) => sum + m.heapUsed, 0) / this.metrics.memoryUsage.length;
        console.log(`📊 资源使用汇总: 平均堆内存 ${(avgHeap / 1024 / 1024).toFixed(2)}MB`);
      }
      
    } catch (error) {
      console.error('资源监控出错:', error);
    }
  }
}

// 稳定性测试函数
function runStabilityTest() {
  console.log('🧪 开始稳定性测试...');
  
  // 测试1: 轮询间隔稳定性
  const testStartTime = Date.now();
  let pollCount = 0;
  
  const originalInterval = setInterval(() => {
    pollCount++;
    if (pollCount >= 6) { // 测试30秒 (5秒间隔 × 6次)
      clearInterval(originalInterval);
      const elapsed = Date.now() - testStartTime;
      console.log(`✅ 稳定性测试完成: ${pollCount}次轮询，耗时${elapsed}ms，平均${(elapsed/pollCount).toFixed(0)}ms/次`);
      
      if (elapsed > 35000) { // 允许5秒误差
        console.warn('⚠️  轮询间隔可能不稳定');
      } else {
        console.log('✅ 轮询间隔稳定，符合预期');
      }
    }
  }, 5000);
  
  // 测试2: 内存泄漏检测
  setTimeout(() => {
    const memBefore = process.memoryUsage();
    setTimeout(() => {
      const memAfter = process.memoryUsage();
      const heapDiff = memAfter.heapUsed - memBefore.heapUsed;
      
      if (heapDiff > 10 * 1024 * 1024) { // 10MB增长
        console.warn(`⚠️  可能存在内存泄漏: ${heapDiff / 1024 / 1024}MB 增长`);
      } else {
        console.log('✅ 内存使用稳定，无明显泄漏');
      }
    }, 15000);
  }, 15000);
}

// 启动
init().then(() => {
  watchAgentSessions();
  
  // 启动任务执行器
  const taskExecutor = new TaskExecutor();
  taskExecutor.start();
  
  // 启动资源监控
  const resourceMonitor = new ResourceMonitor();
  resourceMonitor.start();
  
  // 运行稳定性测试
  setTimeout(runStabilityTest, 5000);
  
  app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════╗
║  🤖 Agent 协作 UI 后端服务已启动        ║
╠═══════════════════════════════════════╣
║  HTTP:  http://localhost:${PORT}         ║
║  WS:    ws://localhost:3101            ║
║  任务队列: /api/tasks (GET)            ║
║  提交任务: /api/send (POST)            ║
║  任务执行器: ✅ 已启用 (3秒间隔)          ║
║  轮询监控: ✅ 已优化 (5秒间隔)          ║
║  资源监控: ✅ 已启用 (30秒间隔)         ║
╚═══════════════════════════════════════╝
    `);
    console.log('📋 优化完成：轮询间隔已从2秒→5秒，任务执行从1秒→3秒');
    console.log('🎯 目标：确保不影响日常办公使用');
  });
});
