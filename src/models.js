const mongoose = require('mongoose');

const QRCodeSchema = new mongoose.Schema({
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

// 用户模型
const userSchema = new mongoose.Schema({
    id: String,
    username: String,
    password: String,
    merchantName: String,
    role: String,
    status: String,
    createdAt: Date
});

// 添加索引
userSchema.index({ username: 1 }, { unique: true });
userSchema.index({ id: 1 }, { unique: true });
userSchema.index({ role: 1 });
userSchema.index({ status: 1 });

// 活动模型
const activitySchema = new mongoose.Schema({
    id: String,
    name: String,
    type: String,
    description: String,
    startDate: Date,
    endDate: Date,
    quota: Number,
    usedQuota: {
        type: Number,
        default: 0
    },
    merchants: [String],
    status: String,
    createdAt: Date,
    forceStopped: {
        type: Boolean,
        default: false
    }
});

// 添加索引
activitySchema.index({ id: 1 });
activitySchema.index({ status: 1 });
activitySchema.index({ merchants: 1 });
activitySchema.index({ createdAt: -1 });

// 核销记录模型
const verificationRecordSchema = new mongoose.Schema({
    id: String,
    activityId: String,
    activityName: String,
    activityType: String,
    merchantId: String,
    codeId: String,
    verifiedAt: Date,
    deviceInfo: String
});

// 添加索引
verificationRecordSchema.index({ activityId: 1 });
verificationRecordSchema.index({ merchantId: 1 });
verificationRecordSchema.index({ verifiedAt: -1 });
verificationRecordSchema.index({ codeId: 1 });

const User = mongoose.model('User', userSchema);
const Activity = mongoose.model('Activity', activitySchema);
const VerificationRecord = mongoose.model('VerificationRecord', verificationRecordSchema);
const QRCodeModel = mongoose.model('QRCode', QRCodeSchema);

module.exports = {
    User,
    Activity,
    VerificationRecord,
    QRCodeModel
}; 