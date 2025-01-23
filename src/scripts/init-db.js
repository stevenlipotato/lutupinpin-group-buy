const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function initializeDB() {
    try {
        // 连接数据库并等待连接完成
        console.log('正在连接数据库...');
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('数据库连接成功！');

        // 删除所有集合
        const collections = await mongoose.connection.db.collections();
        for (let collection of collections) {
            await collection.drop().catch(err => {
                if (err.code !== 26) { // 忽略集合不存在的错误
                    console.warn(`删除集合 ${collection.collectionName} 失败:`, err);
                }
            });
        }
        console.log('已清除所有数据');

        // 创建管理员账户
        const adminPassword = await bcrypt.hash('lutupinpin', 10);
        await mongoose.connection.db.collection('users').insertOne({
            id: 'admin',
            username: 'lutupinpin',
            password: adminPassword,
            role: 'admin',
            status: 'active',
            createdAt: new Date()
        });

        console.log('初始化完成！');
        console.log('管理员账户：');
        console.log('用户名：lutupinpin');
        console.log('密码：lutupinpin');

    } catch (error) {
        console.error('初始化失败:', error);
    } finally {
        // 关闭数据库连接
        await mongoose.connection.close();
        process.exit();
    }
}

// 处理未捕获的错误
process.on('unhandledRejection', (error) => {
    console.error('未捕获的 Promise 错误:', error);
    process.exit(1);
});

// 运行初始化
initializeDB(); 