const mongoose = require('mongoose');

// 用户模型（包括管理员和商家）
const userSchema = new mongoose.Schema({
    id: String,
    username: String,
    password: String,
    merchantName: String,
    role: String,  // 'admin' 或 'merchant'
    status: String,  // 'active' 或 'disabled'
    createdAt: Date
});

// 活动模型
const activitySchema = new mongoose.Schema({
    id: String,
    name: String,
    type: String,
    rules: String,
    quota: Number,
    usedQuota: Number,
    startDate: Date,
    endDate: Date,
    merchants: [String],
    status: String,
    forceStopped: Boolean,
    stoppedAt: Date,
    stoppedBy: String,
    stopReason: String,
    createdAt: Date,
    createdBy: String
});

// 核销记录模型
const verificationRecordSchema = new mongoose.Schema({
    id: String,
    activityId: String,
    activityName: String,
    activityType: String,
    merchantId: String,
    merchantName: String,
    codeId: String,
    verifiedAt: Date,
    deviceInfo: String
});

// 二维码模型
const qrCodeSchema = new mongoose.Schema({
    activityId: String,
    codes: [{
        id: String,
        qrCode: String,
        data: String,
        used: Boolean,
        usedAt: Date,
        usedBy: String
    }]
});

// 创建模型
const User = mongoose.model('User', userSchema);
const Activity = mongoose.model('Activity', activitySchema);
const VerificationRecord = mongoose.model('VerificationRecord', verificationRecordSchema);
const QRCodeModel = mongoose.model('QRCode', qrCodeSchema);

module.exports = {
    User,
    Activity,
    VerificationRecord,
    QRCodeModel
}; 