const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const QRCode = require('qrcode');
const crypto = require('crypto');
const path = require('path');

const app = express();

// 设置 EJS 为模板引擎
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 中间件设置
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
    secret: 'lutupinpin-secret',
    resave: false,
    saveUninitialized: true
}));

// 存储数据（实际项目中应该使用数据库）
const activities = [];
const activityQRCodes = {};
const usedQRCodes = new Set();
const verificationRecords = []; // 存储核销记录
// 添加商家账号（实际项目中应该使用数据库）
const merchants = [
    { id: 'merchant001', password: 'merchant888', name: '测试商家' }
];

// 加密密钥
const ENCRYPTION_KEY = 'lutupinpin-qr-security-key-2024';

// 生成加密签名
function generateSignature(data) {
    return crypto
        .createHmac('sha256', ENCRYPTION_KEY)
        .update(JSON.stringify(data))
        .digest('hex');
}

// 验证签名
function verifySignature(data, signature) {
    const expectedSignature = generateSignature(data);
    return expectedSignature === signature;
}

// 商家认证中间件
function requireMerchantAuth(req, res, next) {
    if (!req.session.merchantLoggedIn) {
        return res.redirect('/merchant/login');
    }
    next();
}

// 管理员认证中间件
function requireAdminAuth(req, res, next) {
    if (!req.session.adminLoggedIn) {
        return res.redirect('/admin');
    }
    next();
}

// 基础路由
app.get('/', (req, res) => {
    res.redirect('/admin');
});

// 管理员路由
app.get('/admin', (req, res) => {
    res.render('admin-login', { error: null });
});

app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'lutupinpin' && password === 'lutupinpin888') {
        req.session.adminLoggedIn = true;
        res.redirect('/admin/dashboard');
    } else {
        res.render('admin-login', { error: '用户名或密码错误' });
    }
});

app.get('/admin/dashboard', requireAdminAuth, (req, res) => {
    // 按创建时间倒序排序
    const sortedActivities = [...activities].sort((a, b) => b.createdAt - 
a.createdAt);
    res.render('admin-dashboard', { 
        activities: sortedActivities,
        moment: require('moment')
    });
});

app.get('/admin/logout', (req, res) => {
    req.session.adminLoggedIn = false;
    res.redirect('/admin');
});

// 在文件顶部添加活动类型常量
const ACTIVITY_TYPES = {
    BUY_ONE_GET_ONE: 'buy_one_get_one',
    FREE: 'free',
    DISCOUNT: 'discount'
};

// 活动类型显示名称
const ACTIVITY_TYPE_NAMES = {
    [ACTIVITY_TYPES.BUY_ONE_GET_ONE]: '买一送一',
    [ACTIVITY_TYPES.FREE]: '免费',
    [ACTIVITY_TYPES.DISCOUNT]: '折扣'
};

// 修改活动创建路由
app.get('/admin/create-activity', requireAdminAuth, (req, res) => {
    res.render('create-activity', { 
        activityTypes: ACTIVITY_TYPES,
        activityTypeNames: ACTIVITY_TYPE_NAMES
    });
});

app.post('/admin/create-activity', requireAdminAuth, (req, res) => {
    const { name, rules, quota, startDate, endDate, type } = req.body;
    const activity = {
        id: Date.now().toString(),
        name,
        rules,
        quota: parseInt(quota),
        type: type || ACTIVITY_TYPES.FREE, // 默认为免费类型
        createdAt: new Date(),
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        usedQuota: 0,
        status: 'active'
    };
    activities.push(activity);
    res.redirect('/admin/dashboard');
});

// 新增：切换活动状态
app.post('/admin/toggle-activity/:activityId', requireAdminAuth, (req, res) => {
    const activity = activities.find(a => a.id === req.params.activityId);
    if (!activity) {
        return res.status(404).json({ success: false, message: '活动不存在' 
});
    }
    
    activity.status = activity.status === 'active' ? 'ended' : 'active';
    res.json({ success: true, status: activity.status });
});

// 商家路由
app.get('/merchant/login', (req, res) => {
    res.render('merchant-login', { error: null });
});

app.post('/merchant/login', (req, res) => {
    const { merchantId, password } = req.body;
    const merchant = merchants.find(m => m.id === merchantId && m.password 
=== password);
    
    if (merchant) {
        req.session.merchantLoggedIn = true;
        req.session.merchantId = merchant.id;
        req.session.merchantName = merchant.name;
        res.redirect('/merchant/verify');
    } else {
        res.render('merchant-login', { error: '商家ID或密码错误' });
    }
});

app.get('/merchant/verify', requireMerchantAuth, (req, res) => {
    res.render('merchant-verify', { 
        merchantName: req.session.merchantName 
    });
});

app.get('/merchant/records', requireMerchantAuth, (req, res) => {
    const merchantId = req.session.merchantId;
    // 获取商家的核销记录
    const records = verificationRecords
        .filter(record => record.merchantId === merchantId)
        .sort((a, b) => b.verifiedAt - a.verifiedAt);
    
    res.render('merchant-records', { 
        records,
        merchantName: req.session.merchantName,
        moment: require('moment')
    });
});

// 在现有路由后面添加
app.get('/merchant/stats', requireMerchantAuth, (req, res) => {
    const merchantId = req.session.merchantId;
    
    // 获取统计数据
    const stats = {
        today: verificationRecords.filter(record => {
            const today = new Date();
            const recordDate = new Date(record.verifiedAt);
            return record.merchantId === merchantId && 
                recordDate.getDate() === today.getDate() &&
                recordDate.getMonth() === today.getMonth() &&
                recordDate.getFullYear() === today.getFullYear();
        }).length,
        
        total: verificationRecords.filter(record => 
            record.merchantId === merchantId
        ).length,
        
        // 按活动统计
        byActivity: verificationRecords
            .filter(record => record.merchantId === merchantId)
            .reduce((acc, record) => {
                const key = `${record.activityName} (${record.activityTypeName})`;
                acc[key] = (acc[key] || 0) + 1;
                return acc;
            }, {}),
            
        // 按类型统计
        byType: verificationRecords
            .filter(record => record.merchantId === merchantId)
            .reduce((acc, record) => {
                acc[record.activityTypeName] = (acc[record.activityTypeName] || 0) + 1;
                return acc;
            }, {})
    };
    
    res.render('merchant-stats', { 
        stats,
        merchantName: req.session.merchantName,
        moment: require('moment')
    });
});

app.get('/merchant/logout', (req, res) => {
    req.session.merchantLoggedIn = false;
    req.session.merchantId = null;
    req.session.merchantName = null;
    res.redirect('/merchant/login');
});

// 二维码生成和验证
app.get('/admin/generate-qr/:activityId', requireAdminAuth, async (req, res) => {
    const activity = activities.find(a => a.id === req.params.activityId);
    if (!activity) {
        return res.status(404).send('活动不存在');
    }
    
    // 检查活动状态
    if (activity.status === 'ended') {
        return res.status(400).send('活动已结束，无法生成新的二维码');
    }
    
    try {
        const qrCodes = [];
        for (let i = 0; i < activity.quota; i++) {
            const qrData = {
                activityId: activity.id,
                codeId: `${activity.id}-${i+1}`,
                timestamp: Date.now()
            };
            
            const signature = generateSignature(qrData);
            const secureQRData = {
                ...qrData,
                signature
            };
            
            const qrCode = await 
QRCode.toDataURL(JSON.stringify(secureQRData));
            qrCodes.push({
                id: i + 1,
                url: qrCode
            });
        }
        
        activityQRCodes[activity.id] = qrCodes;
        res.render('qr-code', { activity, qrCodes });
    } catch (error) {
        res.status(500).send('生成二维码失败');
    }
});

// 核销接口
app.post('/api/verify-qr', requireMerchantAuth, (req, res) => {
    try {
        const { qrData } = req.body;
        const data = JSON.parse(qrData);
        
        // 验证签名
        if (!verifySignature(
            {
                activityId: data.activityId,
                codeId: data.codeId,
                timestamp: data.timestamp
            },
            data.signature
        )) {
            return res.json({ 
                success: false, 
                message: '无效的二维码' 
            });
        }
        
        // 查找活动
        const activity = activities.find(a => a.id === data.activityId);
        if (!activity) {
            return res.json({ 
                success: false, 
                message: '活动不存在' 
            });
        }

        // 检查活动状态
        if (activity.status === 'ended') {
            return res.json({ 
                success: false, 
                message: '活动已结束' 
            });
        }
        
        // 检查是否已使用
        if (usedQRCodes.has(data.codeId)) {
            return res.json({ 
                success: false, 
                message: '此二维码已被使用' 
            });
        }
        
        // 检查活动时间
        const now = new Date();
        if (activity.startDate && now < activity.startDate) {
            return res.json({ 
                success: false, 
                message: '活动尚未开始' 
            });
        }
        if (activity.endDate && now > activity.endDate) {
            return res.json({ 
                success: false, 
                message: '活动已过期' 
            });
        }
        
        // 记录核销信息
        usedQRCodes.add(data.codeId);
        activity.usedQuota++;
        
        // 记录核销记录
        const verificationRecord = {
            id: Date.now().toString(),
            codeId: data.codeId,
            activityId: data.activityId,
            merchantId: req.session.merchantId,
            merchantName: req.session.merchantName,
            verifiedAt: new Date(),
            activityName: activity.name,
            activityType: activity.type,
            activityTypeName: ACTIVITY_TYPE_NAMES[activity.type]
        };
        verificationRecords.push(verificationRecord);
        
        // 检查是否需要自动结束活动
        if (activity.usedQuota >= activity.quota) {
            activity.status = 'ended';
        }
        
        res.json({ 
            success: true, 
            message: '核销成功',
            activity: {
                name: activity.name,
                rules: activity.rules
            }
        });
        
    } catch (error) {
        res.json({ 
            success: false, 
            message: '验证过程出错' 
        });
    }
});

// 统计路由
app.get('/admin/stats/:activityId', requireAdminAuth, (req, res) => {
    const activity = activities.find(a => a.id === req.params.activityId);
    if (!activity) {
        return res.status(404).send('活动不存在');
    }
    res.render('activity-stats', { activity });
});

// 启动服务器
const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
    const interfaces = require('os').networkInterfaces();
    const addresses = [];
    for (let k in interfaces) {
        for (let k2 in interfaces[k]) {
            let address = interfaces[k][k2];
            if (address.family === 'IPv4' && !address.internal) {
                addresses.push(address.address);
            }
        }
    }
    
    console.log(`服务器运行在:`);
    console.log(`本地访问: http://localhost:${PORT}`);
    addresses.forEach(addr => {
        console.log(`局域网访问: http://${addr}:${PORT}`);
    });
    console.log(`\n管理员后台: /admin`);
    console.log(`商家登录: /merchant/login`);
});
