require('dotenv').config();

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const QRCodeGenerator = require('qrcode');
const crypto = require('crypto');
const path = require('path');
const moment = require('moment');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const MongoStore = require('connect-mongo');
const { User, Activity, VerificationRecord, QRCodeModel } = require('./models');
const https = require('https');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const winston = require('winston');

const app = express();

// 创建日志记录器
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ 
            filename: 'logs/error.log', 
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5
        }),
        new winston.transports.File({ 
            filename: 'logs/combined.log',
            maxsize: 5242880,
            maxFiles: 5
        })
    ]
});

// 开发环境下同时输出到控制台
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.simple()
    }));
}

// 替换现有的日志记录
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

console.log = (...args) => {
    logger.info(args.join(' '));
    originalConsoleLog.apply(console, args);
};

console.error = (...args) => {
    logger.error(args.join(' '));
    originalConsoleError.apply(console, args);
};

// 安全中间件配置
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "unpkg.com", "cdnjs.cloudflare.com"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: ["'self'"]
        }
    }
}));

// 速率限制
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15分钟
    max: 100, // 限制每个IP 100次请求
    message: '请求过于频繁，请稍后再试',
    standardHeaders: true,
    legacyHeaders: false
});

// 应用速率限制到所有路由
app.use(limiter);

// 启用 CORS
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? process.env.ALLOWED_ORIGINS?.split(',') 
        : '*'
}));

// 启用压缩
app.use(compression());

// 环境变量检查
const requiredEnvVars = [
    'MONGODB_URI',
    'SESSION_SECRET',
    'QR_SECRET'
];

requiredEnvVars.forEach(varName => {
    if (!process.env[varName]) {
        logger.error(`Missing required environment variable: ${varName}`);
        process.exit(1);
    }
});

// 在文件顶部确保环境变量
if (!process.env.QR_SECRET) {
    process.env.QR_SECRET = 'lutupinpin-qr-secret'; // 默认值
}

// 设置视图引擎
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 在其他中间件之前添加
app.use('/shared', express.static(path.join(__dirname, 'views/shared'), {
    maxAge: '1d',
    etag: true,
    lastModified: true
}));

// 确保这些路由都在静态文件服务之后
app.use(express.static(path.join(__dirname, 'public')));

// 基础中间件
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// 使用内存存储的 session
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI,
        ttl: 24 * 60 * 60,
        autoRemove: 'native',
        touchAfter: 24 * 3600 // 24小时内只更新一次会话
    }),
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000
    },
    name: 'sessionId' // 更改默认的 connect.sid
}));

// 添加在其他中间件之后，路由之前
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// 活动类型
const activityTypes = {
    NORMAL: 'normal',           // 普通活动
    BUY_ONE_GET_ONE: 'buy_one_get_one',  // 买一送一
    FREE: 'free',               // 免费
    DISCOUNT: 'discount',        // 折扣
    TIME_LIMITED: 'time_limited'  // 新增类型
};

const activityTypeNames = {
    [activityTypes.NORMAL]: '普通活动',
    [activityTypes.BUY_ONE_GET_ONE]: '买一送一',
    [activityTypes.FREE]: '免费',
    [activityTypes.DISCOUNT]: '折扣',
    [activityTypes.TIME_LIMITED]: '限时特惠'  // 新增类型名称
};

// 获取服务器 IP 地址的函数
function getServerAddresses() {
    const networkInterfaces = require('os').networkInterfaces();
    const addresses = [];
    
    for (const k in networkInterfaces) {
        for (const k2 in networkInterfaces[k]) {
            const address = networkInterfaces[k][k2];
            if (address.family === 'IPv4' && !address.internal) {
                addresses.push(address.address);
            }
        }
    }
    
    return addresses || [];
}

// 修改活动状态的函数
function updateActivityStatus(activity) {
    if (activity.forceStopped) {
        return '已停止';
    }
    
    const now = new Date().getTime();
    if (now < new Date(activity.startDate).getTime()) {
        return '未开始';
    } else if (now > new Date(activity.endDate).getTime()) {
        return '已结束';
    } else {
        return '进行中';
    }
}

// 添加二维码验证函数
function verifyQRData(qrData) {
    try {
        // 验证必要字段
        if (!qrData || !qrData.activityId || !qrData.codeId || !qrData.timestamp || !qrData.signature) {
            return { valid: false, reason: 'INVALID_FORMAT' };
        }

        const { activityId, codeId, timestamp, signature } = qrData;

        // 验证时效性（5分钟有效期）
        const validityPeriod = 5 * 60 * 1000;
        if (Date.now() - timestamp > validityPeriod) {
            return { valid: false, reason: 'EXPIRED' };
        }

        // 验证签名
        const expectedSignature = crypto
            .createHmac('sha256', process.env.QR_SECRET)
            .update(`${activityId}:${codeId}:${timestamp}`)
            .digest('hex');

        if (signature !== expectedSignature) {
            return { valid: false, reason: 'INVALID_SIGNATURE' };
        }

        return { 
            valid: true, 
            data: { 
                activityId, 
                codeId 
            } 
        };
    } catch (error) {
        console.error('QR verification error:', error);
        return { valid: false, reason: 'VERIFICATION_ERROR' };
    }
}

// 认证中间件
function requireAdminAuth(req, res, next) {
    console.log('Admin Auth Check:', {
        session: req.session,
        isAdmin: req.session.isAdmin
    });
    
    if (!req.session.isAdmin) {
        console.log('Admin auth failed - redirecting to login');
        return res.redirect('/admin/login');
    }
    next();
}

// 认证中间件
function requireMerchantAuth(req, res, next) {
    if (!req.session.merchantId) {
        return res.redirect('/merchant/login');
    }
    next();
}

// 错误消息获取函数
function getErrorMessage(reason) {
    const errorMessages = {
        'INVALID_FORMAT': '无效的二维码格式',
        'EXPIRED': '二维码已过期',
        'INVALID_SIGNATURE': '二维码验证失败',
        'VERIFICATION_ERROR': '验证过程出错'
    };
    return errorMessages[reason] || '未知错误';
}

// 路由
app.get('/', (req, res) => {
    res.redirect('/merchant/login');
});

// 商家登录
app.get('/merchant/login', (req, res) => {
    res.render('merchant-login', { 
        error: null,
        serverAddresses: getServerAddresses(),
        port: process.env.PORT || 3000
    });
});

app.post('/merchant/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        console.log('Merchant login attempt:', { username });
        
        const merchant = await User.findOne({ 
            username, 
            role: 'merchant'
        });
        
        console.log('Found merchant:', merchant);
        
        if (!merchant) {
            console.log('Merchant not found');
            return res.render('merchant-login', { 
                error: '账号或密码错误',
                serverAddresses: getServerAddresses(),
                port: process.env.PORT || 3000
            });
        }

        const isValid = await bcrypt.compare(password, merchant.password);
        console.log('Password validation:', { isValid });
        
        if (isValid) {
            console.log('Merchant login successful');
            req.session.isMerchant = true;
            req.session.merchantId = merchant.id;
            res.redirect('/merchant/dashboard');
        } else {
            console.log('Invalid password');
            res.render('merchant-login', { 
                error: '账号或密码错误',
                serverAddresses: getServerAddresses(),
                port: process.env.PORT || 3000
            });
        }
    } catch (error) {
        console.error('Merchant login error:', error);
        res.render('merchant-login', { 
            error: '登录失败，请重试',
            serverAddresses: getServerAddresses(),
            port: process.env.PORT || 3000
        });
    }
});

// 商家核销页面
app.get('/merchant/verify', requireMerchantAuth, async (req, res) => {
    try {
        const merchantId = req.session.merchantId;
        const records = await VerificationRecord.find({ merchantId });
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const stats = {
            today: records.filter(r => new Date(r.verifiedAt) >= today).length,
            total: records.length
        };
        
        res.render('merchant-verify', {
            merchantName: req.session.merchantName,
            stats
        });
    } catch (error) {
        console.error('Error loading merchant verify page:', error);
        res.status(500).send('加载页面失败');
    }
});

// 商家核销记录
app.get('/merchant/records', requireMerchantAuth, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const pageSize = 20; // 每页显示数量
        
        // 获取查询参数
        const query = {
            startDate: req.query.startDate || '',
            endDate: req.query.endDate || '',
            activityType: req.query.activityType || ''
        };

        // 构建查询条件
        let conditions = { merchantId: req.session.merchantId };
        if (query.startDate && query.endDate) {
            conditions.verifiedAt = {
                $gte: new Date(query.startDate),
                $lte: new Date(query.endDate)
            };
        }
        if (query.activityType) {
            conditions.activityType = query.activityType;
        }

        // 获取记录总数
        const totalRecords = await VerificationRecord.countDocuments(conditions);
        const totalPages = Math.ceil(totalRecords / pageSize);

        // 获取分页数据
        const records = await VerificationRecord.find(conditions)
            .sort({ verifiedAt: -1 })
            .skip((page - 1) * pageSize)
            .limit(pageSize);

        // 获取统计数据
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayCount = await VerificationRecord.countDocuments({
            merchantId: req.session.merchantId,
            verifiedAt: { $gte: today }
        });

        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);
        const weekCount = await VerificationRecord.countDocuments({
            merchantId: req.session.merchantId,
            verifiedAt: { $gte: weekAgo }
        });

        const monthAgo = new Date(today);
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        const monthCount = await VerificationRecord.countDocuments({
            merchantId: req.session.merchantId,
            verifiedAt: { $gte: monthAgo }
        });

        res.render('merchant-records', {
            records,
            moment,
            activityTypeNames,
            currentPage: page,
            totalPages,
            todayCount,
            weekCount,
            monthCount,
            totalCount: totalRecords,
            query,
            pageSize  // 确保传递 pageSize
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).send('获取核销记录失败');
    }
});

// 商家统计页面
app.get('/merchant/stats', requireMerchantAuth, async (req, res) => {
    try {
        const merchantId = req.session.merchantId;
        
        // 获取时间范围
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        
        const weekStart = new Date(today);
        weekStart.setDate(weekStart.getDate() - 7);
        
        const monthStart = new Date(today);
        monthStart.setMonth(monthStart.getMonth() - 1);

        // 获取各时间段的统计数据
        const todayStats = await VerificationRecord.countDocuments({
            merchantId,
            verifiedAt: { $gte: today }
        });

        const yesterdayStats = await VerificationRecord.countDocuments({
            merchantId,
            verifiedAt: { $gte: yesterday, $lt: today }
        });

        const weekStats = await VerificationRecord.countDocuments({
            merchantId,
            verifiedAt: { $gte: weekStart }
        });

        const monthStats = await VerificationRecord.countDocuments({
            merchantId,
            verifiedAt: { $gte: monthStart }
        });

        const totalStats = await VerificationRecord.countDocuments({ merchantId });

        // 计算趋势
        const todayTrend = yesterdayStats ? ((todayStats - yesterdayStats) / yesterdayStats * 100).toFixed(1) : 0;

        // 获取周趋势数据
        const weeklyData = [];
        const weeklyLabels = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const nextDate = new Date(date);
            nextDate.setDate(nextDate.getDate() + 1);
            
            const count = await VerificationRecord.countDocuments({
                merchantId,
                verifiedAt: { $gte: date, $lt: nextDate }
            });
            
            weeklyData.push(count);
            weeklyLabels.push(date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }));
        }

        // 获取进行中的活动
        const activeActivities = await Activity.find({
            merchants: merchantId,
            status: '进行中',
            startDate: { $lte: now },
            endDate: { $gt: now }
        }).lean(); // 使用 lean() 获取普通 JavaScript 对象

        // 计算上周和上月的数据用于趋势计算
        const lastWeekStart = new Date(weekStart);
        lastWeekStart.setDate(lastWeekStart.getDate() - 7);
        const lastWeekStats = await VerificationRecord.countDocuments({
            merchantId,
            verifiedAt: { $gte: lastWeekStart, $lt: weekStart }
        });

        const lastMonthStart = new Date(monthStart);
        lastMonthStart.setMonth(lastMonthStart.getMonth() - 1);
        const lastMonthStats = await VerificationRecord.countDocuments({
            merchantId,
            verifiedAt: { $gte: lastMonthStart, $lt: monthStart }
        });

        // 计算周环比和月环比
        const weekTrend = lastWeekStats ? ((weekStats - lastWeekStats) / lastWeekStats * 100).toFixed(1) : 0;
        const monthTrend = lastMonthStats ? ((monthStats - lastMonthStats) / lastMonthStats * 100).toFixed(1) : 0;

        res.render('merchant-stats', {
            stats: {
                today: todayStats,
                week: weekStats,
                month: monthStats,
                total: totalStats,
                todayTrend,
                weekTrend,
                monthTrend,
                weeklyData,
                weeklyLabels
            },
            activeActivities: activeActivities || [], // 确保即使没有活动也传递空数组
            getActivityTypeName: (type) => activityTypeNames[type] || type
        });

    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).send('获取统计数据失败');
    }
});

// 获取商家统计数据
app.get('/merchant/stats-data', requireMerchantAuth, (req, res) => {
    const merchantId = req.session.merchantId;
    const merchantRecords = verificationRecords.filter(r => r.merchantId === merchantId);
    
    const stats = {
        today: merchantRecords.filter(r => {
            const today = new Date();
            const recordDate = new Date(r.verifiedAt);
            return recordDate.toDateString() === today.toDateString();
        }).length,
        total: merchantRecords.length
    };
    
    res.json(stats);
});

// 商家退出登录
app.get('/merchant/logout', (req, res) => {
    // 清除商家会话
    req.session.merchantId = null;
    req.session.isMerchant = false;
    
    // 重定向到登录页面
    res.redirect('/merchant/login');
});

// 修改管理员登录相关的路由
app.get('/admin', (req, res) => {
    // 重定向到登录页面
    res.redirect('/admin/login');
});

app.get('/admin/login', (req, res) => {
    // 简化登录页面渲染
    res.render('admin-login', { 
        error: null,
        registered: false
    });
});

app.post('/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        console.log('Admin login attempt:', { username });
        
        // 查找管理员用户
        const admin = await User.findOne({ 
            username: username,
            role: 'admin'
        });

        if (!admin) {
            return res.render('admin-login', { 
                error: '账号或密码错误',
                registered: false
            });
        }

        // 验证密码
        const isValid = await bcrypt.compare(password, admin.password);
        if (!isValid) {
            return res.render('admin-login', { 
                error: '账号或密码错误',
                registered: false
            });
        }

        // 设置会话
        req.session.isAdmin = true;
        req.session.adminId = admin.id;
        
        // 重定向到仪表板
        res.redirect('/admin/dashboard');

    } catch (error) {
        console.error('Admin login error:', error);
        res.render('admin-login', { 
            error: '登录失败，请重试',
            registered: false
        });
    }
});

// 管理员仪表板
app.get('/admin/dashboard', requireAdminAuth, async (req, res) => {
    try {
        // 获取所有活动
        const activities = await Activity.find().sort({ createdAt: -1 });
        
        // 获取所有商家
        const merchants = await User.find({ role: 'merchant' });
        
        // 获取今日核销数据
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayVerifications = await VerificationRecord.countDocuments({
            verifiedAt: { $gte: today }
        });
        
        // 获取总核销数据
        const totalVerifications = await VerificationRecord.countDocuments();
        
        res.render('admin-dashboard', {
            activities,
            merchants,
            stats: {
                todayVerifications,
                totalVerifications,
                merchantCount: merchants.length,
                activityCount: activities.length
            },
            moment,
            activityTypeNames
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).send('加载仪表板失败');
    }
});

// 管理员退出登录
app.get('/admin/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
});

// 创建活动页面路由
app.get('/admin/create-activity', requireAdminAuth, async (req, res) => {
    try {
        // 获取商家列表
        const merchants = await User.find({ role: 'merchant' });
        // 获取核销记录
        const verificationRecords = await VerificationRecord.find();
        
        res.render('create-activity', {
            activityTypes,
            activityTypeNames,
            defaultStart: moment().format('YYYY-MM-DD'),
            defaultEnd: moment().add(7, 'days').format('YYYY-MM-DD'),
            users: merchants,  // 传递商家列表
            verificationRecords  // 添加核销记录数据
        });
    } catch (error) {
        console.error('Error loading create activity page:', error);
        res.status(500).send('加载页面失败');
    }
});

// 创建活动提交路由
app.post('/admin/create-activity', requireAdminAuth, async (req, res) => {
    try {
        const { name, type, rules, quota, startDate, endDate, merchants } = req.body;
        
        console.log('Creating activity with data:', {
            name,
            type,
            merchants: merchants || [] // 调试日志
        });

        // 确保 merchants 是数组
        const merchantArray = Array.isArray(merchants) ? merchants : 
                            merchants ? [merchants] : [];

        const activity = new Activity({
            id: crypto.randomBytes(16).toString('hex'),
            name,
            type,
            rules,
            quota: parseInt(quota),
            startDate: new Date(startDate),
            endDate: new Date(endDate),
            merchants: merchantArray, // 使用处理后的商家数组
            usedQuota: 0,
            status: '进行中',
            createdAt: new Date(),
            createdBy: req.session.adminId
        });

        await activity.save();
        
        console.log('Activity created:', {
            id: activity.id,
            merchants: activity.merchants // 调试日志
        });

        res.json({
            success: true,
            message: '活动创建成功',
            activity: {
                id: activity.id,
                name: activity.name,
                type: activity.type
            }
        });
    } catch (error) {
        console.error('Create activity error:', error);
        res.status(500).json({
            success: false,
            message: '创建活动失败，请重试'
        });
    }
});

// 活动统计
app.get('/admin/activity/:id/stats', requireAdminAuth, async (req, res) => {
    try {
        const activity = await Activity.findOne({ id: req.params.id });
        if (!activity) {
            return res.redirect('/admin/dashboard');
        }
        
        // 获取所有商家
        const allMerchants = await User.find({ role: 'merchant' });
        
        // 获取核销记录
        const records = await VerificationRecord.find({ 
            activityId: activity.id 
        });
        
        // 获取活动商家信息
        const activityMerchants = allMerchants.filter(m => 
            activity.merchants.includes(m.id)
        );
        
        res.render('activity-stats', {
            activity,
            records,
            activityTypeNames,
            moment,
            merchants: activityMerchants,
            allMerchants // 添加所有商家列表，用于商家管理
        });
    } catch (error) {
        console.error('Activity stats error:', error);
        res.status(500).send('获取活动统计失败');
    }
});

// 添加内存锁机制
const verificationLocks = new Map();

// 获取锁的函数
async function acquireVerificationLock(key, timeout = 5000) {
    if (verificationLocks.has(key)) {
        return false;
    }
    
    verificationLocks.set(key, true);
    
    // 设置自动释放锁的超时
    setTimeout(() => {
        verificationLocks.delete(key);
    }, timeout);
    
    return true;
}

// 修改核销 API 路由
app.post('/api/verify-qr', requireMerchantAuth, async (req, res) => {
    try {
        // 解析二维码数据
        const qrData = JSON.parse(req.body.qrData);
        
        // 验证二维码
        const verification = verifyQRData(qrData);
        if (!verification.valid) {
            return res.json({
                success: false,
                message: getErrorMessage(verification.reason)
            });
        }

        // 获取活动信息
        const activity = await Activity.findOne({ id: verification.data.activityId });
        if (!activity) {
            return res.json({
                success: false,
                message: '活动不存在'
            });
        }

        // 检查活动状态
        if (activity.forceStopped) {
            return res.json({
                success: false,
                message: '活动已停止'
            });
        }

        const now = new Date();
        if (now < activity.startDate) {
            return res.json({
                success: false,
                message: '活动未开始'
            });
        }
        if (now > activity.endDate) {
            return res.json({
                success: false,
                message: '活动已结束'
            });
        }

        // 检查商家是否有权限核销
        if (!activity.merchants.includes(req.session.merchantId)) {
            return res.json({
                success: false,
                message: '无权核销此活动'
            });
        }

        // 检查二维码是否已被使用
        const qrCode = await QRCodeModel.findOne({
            activityId: activity.id,
            'codes.id': verification.data.codeId
        });

        if (!qrCode) {
            return res.json({
                success: false,
                message: '无效的二维码'
            });
        }

        const codeIndex = qrCode.codes.findIndex(code => code.id === verification.data.codeId);
        if (qrCode.codes[codeIndex].used) {
            return res.json({
                success: false,
                message: '此二维码已被使用'
            });
        }

        // 检查活动配额
        if (activity.usedQuota >= activity.quota) {
            return res.json({
                success: false,
                message: '活动配额已用完',
                endReason: 'QUOTA_EXCEEDED',
                activity: {
                    name: activity.name,
                    type: activity.type,
                    usedQuota: activity.usedQuota,
                    totalQuota: activity.quota
                }
            });
        }

        // 标记二维码为已使用
        qrCode.codes[codeIndex].used = true;
        qrCode.codes[codeIndex].usedAt = now;
        await qrCode.save();

        // 更新活动配额
        activity.usedQuota += 1;
        await activity.save();

        // 创建核销记录
        const record = new VerificationRecord({
            id: crypto.randomBytes(16).toString('hex'),
            activityId: activity.id,
            activityName: activity.name,
            activityType: activity.type,
            merchantId: req.session.merchantId,
            codeId: verification.data.codeId,
            verifiedAt: now,
            deviceInfo: req.headers['user-agent']
        });
        await record.save();

        // 返回成功响应
        res.json({
            success: true,
            message: '核销成功',
            activity: {
                name: activity.name,
                type: activity.type,
                usedQuota: activity.usedQuota,
                totalQuota: activity.quota,
                remainingQuota: activity.quota - activity.usedQuota
            }
        });

    } catch (error) {
        console.error('Verification error:', error);
        res.json({
            success: false,
            message: '核销失败，请重试'
        });
    }
});

// 商家注册
app.get('/merchant/register', (req, res) => {
    res.render('merchant-register');
});

app.post('/merchant/register', async (req, res) => {
    try {
        const { username, password, merchantName } = req.body;
        
        // 验证用户名是否已存在
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.render('merchant-register', { error: '用户名已存在' });
        }

        // 创建新商家
        const merchant = new User({
            id: crypto.randomBytes(16).toString('hex'),
            username,
            password: await bcrypt.hash(password, 10),
            merchantName,
            role: 'merchant',
            status: 'active',
            createdAt: new Date()
        });
        
        await merchant.save();
        res.redirect('/merchant/login?registered=true');
    } catch (error) {
        console.error('Registration error:', error);
        res.render('merchant-register', { error: '注册失败，请重试' });
    }
});

// 管理员注册（可选，或者只允许通过后台添加）
app.get('/admin/register', (req, res) => {
    res.render('admin-register');
});

app.post('/admin/register', async (req, res) => {
    const { username, password, adminCode } = req.body;
    
    // 验证管理员注册码
    if (adminCode !== process.env.ADMIN_REGISTER_CODE) {
        return res.render('admin-register', { error: '无效的管理员注册码' });
    }

    if (await User.findOne({ username })) {
        return res.render('admin-register', { error: '用户名已存在' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({
            id: crypto.randomBytes(16).toString('hex'),
            username,
            password: hashedPassword,
            role: 'admin',
            status: 'active',
            createdAt: new Date().toISOString()
        });
        
        await newUser.save();
        
        res.redirect('/admin/login?registered=true');
    } catch (error) {
        res.render('admin-register', { error: '注册失败，请重试' });
    }
});

// 添加商家关联活动的路由
app.post('/admin/activity/:id/add-merchant', requireAdminAuth, async (req, res) => {
    const { id } = req.params;
    const { merchantId } = req.body;
    
    const activity = await Activity.findOne({ id });
    if (!activity) {
        return res.status(404).json({ error: '活动不存在' });
    }
    
    if (!activity.merchants.includes(merchantId)) {
        activity.merchants.push(merchantId);
        await activity.save();
    }
    
    res.json({ success: true });
});

// 商家登录后的主页面
app.get('/merchant/dashboard', requireMerchantAuth, async (req, res) => {
    try {
        const merchant = await User.findOne({ id: req.session.merchantId });
        // 获取商家参与的活动
        const activities = await Activity.find({
            merchants: merchant.id,
            status: '进行中'
        });
        
        res.render('merchant-dashboard', {
            merchant,
            activities,
            activityTypeNames,
            moment
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).send('加载商家仪表板失败');
    }
});

// 修改活动商家的路由
app.post('/admin/activity/:id/merchants', requireAdminAuth, async (req, res) => {
    try {
        const { merchants } = req.body;
        const activity = await Activity.findOne({ id: req.params.id });
        
        if (!activity) {
            return res.status(404).json({
                success: false,
                message: '活动不存在'
            });
        }

        // 更新活动的商家列表
        activity.merchants = merchants || [];
        await activity.save();

        res.json({
            success: true,
            message: '商家更新成功'
        });
    } catch (error) {
        console.error('Error updating merchants:', error);
        res.status(500).json({
            success: false,
            message: '更新失败，请重试'
        });
    }
});

// 添加设备检测中间件
app.use((req, res, next) => {
    const userAgent = req.headers['user-agent'];
    res.locals.isMobile = /mobile|android|iphone|ipad/i.test(userAgent);
    next();
});

// 获取商家活动提醒
app.get('/merchant/notifications', requireMerchantAuth, async (req, res) => {
    const merchantId = req.session.merchantId;
    const now = new Date();
    
    // 获取相关活动
    const merchantActivities = await Activity.find({
        merchants: merchantId,
        status: 'active'
    });
    
    const notifications = {
        upcoming: merchantActivities.filter(activity => {
            const start = new Date(activity.startDate);
            const diff = start.getTime() - now.getTime();
            return diff > 0 && diff < 24 * 60 * 60 * 1000; // 24小时内开始
        }),
        ending: merchantActivities.filter(activity => {
            const end = new Date(activity.endDate);
            const diff = end.getTime() - now.getTime();
            return diff > 0 && diff < 24 * 60 * 60 * 1000; // 24小时内结束
        })
    };
    
    res.json(notifications);
});

// 添加数据导出路由
app.get('/merchant/export-records', requireMerchantAuth, async (req, res) => {
    const merchantId = req.session.merchantId;
    const records = await VerificationRecord.find({ merchantId });
    
    // 生成CSV数据
    const csvData = records.map(record => [
        record.verifiedAt,
        record.activityName,
        record.activityTypeName,
        record.codeId
    ].join(',')).join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=records.csv');
    res.send(csvData);
});

// 商家个人信息页面
app.get('/merchant/profile', requireMerchantAuth, async (req, res) => {
    try {
        const merchant = await User.findOne({ id: req.session.merchantId });
        res.render('merchant-profile', { merchant });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).send('加载个人信息失败');
    }
});

// 商家修改个人信息页面
app.get('/merchant/profile/edit', requireMerchantAuth, async (req, res) => {
    try {
        const merchant = await User.findOne({ id: req.session.merchantId });
        res.render('merchant-profile-edit', { merchant });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).send('加载编辑页面失败');
    }
});

// 商家更新个人信息
app.post('/merchant/profile/update', requireMerchantAuth, async (req, res) => {
    try {
        const { merchantName, currentPassword, newPassword } = req.body;
        const merchant = await User.findOne({ id: req.session.merchantId });
        
        // 如果要修改密码，先验证当前密码
        if (newPassword) {
            const isValid = await bcrypt.compare(currentPassword, merchant.password);
            if (!isValid) {
                return res.status(400).json({ error: '当前密码错误' });
            }
            merchant.password = await bcrypt.hash(newPassword, 10);
        }
        
        // 更新商家名称
        if (merchantName) {
            merchant.merchantName = merchantName;
        }
        
        await merchant.save();
        res.json({ success: true });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: '更新失败' });
    }
});

// 添加重新加载用户数据的函数
async function reloadUsers() {
    try {
        const usersData = await fs.promises.readFile(path.join(dataDir, 'users.json'), 'utf8');
        users = JSON.parse(usersData);
        console.log('Users data reloaded');
    } catch (error) {
        console.error('Error reloading users data:', error);
        throw error;
    }
}

// 在所有路由的最后添加这些中间件
app.use((req, res, next) => {
    res.status(404).json({ 
        error: '页面不存在' 
    });
});

app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ 
        error: '服务器错误，请稍后重试'
    });
});

// 修改数据库连接
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000
}).then(() => {
    console.log('MongoDB connected successfully');
    createDefaultAdmin();
}).catch(err => {
    console.error('MongoDB connection error:', err);
});

// 移除 server.listen，因为 Vercel 会自动处理这个

// 替换原来的默认管理员创建代码
async function createDefaultAdmin() {
    try {
        // 检查是否已存在管理员
        const adminExists = await User.findOne({ role: 'admin' });
        if (!adminExists) {
            const defaultAdmin = new User({
                id: crypto.randomBytes(16).toString('hex'),
                username: 'lutupinpin',
                password: bcrypt.hashSync('lutupinpin888', 10),
                role: 'admin',
                status: 'active',
                createdAt: new Date()
            });
            await defaultAdmin.save();
            console.log('Created default admin account');
        }
    } catch (error) {
        console.error('Error creating default admin:', error);
    }
}

// 商家管理相关路由 - 确保这些路由在一起且顺序正确
// 1. 创建商家页面
app.get('/admin/merchants/create', requireAdminAuth, async (req, res) => {
    console.log('Accessing merchant create page');
    try {
        // 获取所有进行中的活动
        console.log('Fetching active activities...');
        const activities = await Activity.find({
            status: '进行中'
        });
        console.log(`Found ${activities.length} active activities`);
        
        console.log('Rendering create merchant page');
        res.render('admin-create-merchant', {
            activities,
            activityTypeNames,
            moment
        });
    } catch (error) {
        console.error('Error loading create merchant page:', error);
        res.status(500).send('加载页面失败');
    }
});

// 2. 创建商家请求处理
app.post('/admin/merchants/create', requireAdminAuth, async (req, res) => {
    try {
        const { username, password, merchantName, activities } = req.body;

        // 检查用户名是否已存在
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: '用户名已存在'
            });
        }

        // 创建新商家
        const merchant = new User({
            id: crypto.randomBytes(16).toString('hex'),
            username,
            password: await bcrypt.hash(password, 10),
            merchantName,
            role: 'merchant',
            status: 'active',
            createdAt: new Date()
        });
        
        await merchant.save();

        // 如果选择了活动，将商家添加到活动中
        if (activities && activities.length > 0) {
            await Activity.updateMany(
                { _id: { $in: activities } },
                { $addToSet: { merchants: merchant.id } }
            );
        }

        res.json({
            success: true,
            message: '商家创建成功'
        });
    } catch (error) {
        console.error('Error creating merchant:', error);
        res.status(500).json({
            success: false,
            message: '创建商家失败，请重试'
        });
    }
});

// 3. 商家列表页面
app.get('/admin/merchants', requireAdminAuth, async (req, res) => {
    try {
        const merchants = await User.find({ role: 'merchant' });
        const records = await VerificationRecord.find();
        const activities = await Activity.find();
        
        const merchantsWithActivities = await Promise.all(merchants.map(async merchant => {
            const currentActivities = activities.filter(activity => 
                activity.merchants.includes(merchant.id) && 
                activity.status === '进行中'
            );
            
            const merchantRecords = records.filter(r => r.merchantId === merchant.id);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const todayRecords = merchantRecords.filter(r => 
                new Date(r.verifiedAt) >= today
            );
            
            return {
                ...merchant.toObject(),
                currentActivities,
                stats: {
                    today: todayRecords.length,
                    total: merchantRecords.length
                }
            };
        }));
        
        res.render('admin-merchants', {
            merchants: merchantsWithActivities,
            activityTypeNames,
            moment
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).send('获取商家列表失败');
    }
});

// 4. 其他商家管理相关路由
app.post('/admin/merchants/:id/reset-password', requireAdminAuth, async (req, res) => {
    try {
        const merchant = await User.findOne({ id: req.params.id });
        if (!merchant) {
            return res.status(404).json({
                success: false,
                message: '商家不存在'
            });
        }

        const newPassword = 'lutupinpin123';
        merchant.password = await bcrypt.hash(newPassword, 10);
        await merchant.save();

        res.json({
            success: true,
            message: '密码已重置为: ' + newPassword
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: '重置密码失败'
        });
    }
});

app.post('/admin/merchants/:id/toggle-status', requireAdminAuth, async (req, res) => {
    try {
        const merchant = await User.findOne({ id: req.params.id });
        if (!merchant) {
            return res.status(404).json({
                success: false,
                message: '商家不存在'
            });
        }

        merchant.status = merchant.status === 'active' ? 'disabled' : 'active';
        await merchant.save();

        res.json({
            success: true,
            message: '状态已更新'
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: '更新状态失败'
        });
    }
});

// 修改商家密码
app.post('/admin/merchants/:id/change-password', requireAdminAuth, async (req, res) => {
    try {
        const { newPassword } = req.body;
        const merchant = await User.findOne({ id: req.params.id });
        
        if (!merchant) {
            return res.status(404).json({
                success: false,
                message: '商家不存在'
            });
        }

        // 验证新密码
        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: '新密码长度至少为6位'
            });
        }

        // 更新密码
        merchant.password = await bcrypt.hash(newPassword, 10);
        await merchant.save();

        res.json({
            success: true,
            message: '密码修改成功'
        });
    } catch (error) {
        console.error('Error changing merchant password:', error);
        res.status(500).json({
            success: false,
            message: '修改密码失败，请重试'
        });
    }
});

// 临时路由，用于调试（记得在调试完后删除）
app.get('/debug/user/:username', requireAdminAuth, async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username });
        res.json({
            exists: !!user,
            role: user?.role,
            status: user?.status,
            hasPassword: !!user?.password
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 生成二维码的路由 - 确保这个路由在其他路由之前
app.get('/admin/activity/:id/qr-code', requireAdminAuth, async (req, res) => {
    try {
        // 1. 获取活动信息
        const activity = await Activity.findOne({ id: req.params.id });
        if (!activity) {
            return res.status(404).render('error', { message: '活动不存在' });
        }

        // 2. 获取或生成二维码
        let qrCodeDoc = await QRCodeModel.findOne({ activityId: activity.id });
        
        if (!qrCodeDoc) {
            const codes = [];
            for (let i = 0; i < activity.quota; i++) {
                const codeId = crypto.randomBytes(16).toString('hex');
                const qrData = {
                    activityId: activity.id,
                    codeId: codeId,
                    timestamp: Date.now()
                };
                
                qrData.signature = crypto
                    .createHmac('sha256', process.env.QR_SECRET)
                    .update(`${activity.id}:${codeId}:${qrData.timestamp}`)
                    .digest('hex');

                const qrCode = await QRCodeGenerator.toDataURL(JSON.stringify(qrData));
                
                codes.push({
                    id: codeId,
                    qrCode: qrCode,
                    data: JSON.stringify(qrData),
                    used: false
                });
            }

            qrCodeDoc = new QRCodeModel({
                activityId: activity.id,
                codes: codes
            });
            await qrCodeDoc.save();
        }

        // 3. 获取核销记录
        const verificationRecords = await VerificationRecord.find({ activityId: activity.id });

        // 4. 获取商家信息
        const merchants = await User.find({ 
            id: { $in: activity.merchants },
            role: 'merchant'
        });

        // 5. 渲染页面
        res.render('qr-code', {
            activity,
            codes: qrCodeDoc.codes,
            verificationRecords,
            merchants,
            moment
        });

    } catch (error) {
        console.error('QR code page error:', error);
        res.status(500).render('error', { message: '加载二维码页面失败' });
    }
});

// 停止/启用活动的路由
app.post('/admin/activity/:id/toggle-status', requireAdminAuth, async (req, res) => {
    try {
        const activity = await Activity.findOne({ id: req.params.id });
        if (!activity) {
            return res.status(404).json({
                success: false,
                message: '活动不存在'
            });
        }

        // 切换状态
        activity.forceStopped = !activity.forceStopped;
        activity.status = activity.forceStopped ? '已停止' : '进行中';
        await activity.save();

        // 返回更新后的活动信息
        res.json({
            success: true,
            message: activity.forceStopped ? '活动已停止' : '活动已启用',
            activity: {
                id: activity.id,
                name: activity.name,
                status: activity.status,
                forceStopped: activity.forceStopped
            }
        });
    } catch (error) {
        console.error('Toggle activity status error:', error);
        res.status(500).json({
            success: false,
            message: '操作失败'
        });
    }
});

// 添加请求超时中间件
app.use((req, res, next) => {
    // 设置30秒超时
    req.setTimeout(30000, () => {
        res.status(408).render('error', {
            message: '请求超时，请重试'
        });
    });
    next();
});

// 动态内容缓存控制
app.use((req, res, next) => {
    if (req.method === 'GET') {
        res.set('Cache-Control', 'no-cache');
    } else {
        res.set('Cache-Control', 'no-store');
    }
    next();
});

app.get('/health', (req, res) => {
    const health = {
        uptime: process.uptime(),
        timestamp: Date.now(),
        status: 'OK',
        memory: process.memoryUsage(),
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    };
    res.json(health);
});