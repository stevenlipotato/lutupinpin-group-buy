const { body, validationResult } = require('express-validator');

const activityValidation = [
    body('name').trim().notEmpty().withMessage('活动名称不能为空'),
    body('quota').isInt({ min: 1 }).withMessage('配额必须大于0'),
    body('startDate').isISO8601().withMessage('开始日期格式不正确'),
    body('endDate').isISO8601().withMessage('结束日期格式不正确'),
    body('merchants').isArray().withMessage('商家列表格式不正确'),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ 
                success: false, 
                errors: errors.array() 
            });
        }
        next();
    }
];

module.exports = {
    activityValidation
}; 