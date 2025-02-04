const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

// 中间件
app.use(cors());
app.use(express.json());

// 配置静态文件
app.use('/public', express.static(path.join(__dirname, 'public')));

// 配置视图引擎
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');  // 如果您使用 EJS

// 数据库连接
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.error('MongoDB connection error:', err));

// 基础路由测试
app.get('/', (req, res) => {
  res.json({ message: 'API is working' });
});

// 添加健康检查路由
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// 添加更详细的错误日志
app.use((err, req, res, next) => {
  console.error('Error details:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    body: req.body,
    query: req.query
  });
  res.status(500).json({ 
    message: 'Something went wrong!',
    error: process.env.NODE_ENV !== 'production' ? err.message : 'Internal Server Error'
  });
});

// 添加未找到路由的处理
app.use((req, res) => {
  console.log('404 Not Found:', req.path);
  res.status(404).json({ message: `Route ${req.path} not found` });
});

// Vercel 需要导出 app
module.exports = app;

// 本地开发时使用
if (process.env.NODE_ENV !== 'production') {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
} 