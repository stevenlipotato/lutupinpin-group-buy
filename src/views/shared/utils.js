// 加载动画
const showLoading = () => {
    const overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    overlay.innerHTML = `
        <div class="loading-logo">🦌</div>
        <div class="loading-text">鹿途拼拼</div>
    `;
    document.body.appendChild(overlay);
    return overlay;
};

const hideLoading = (overlay) => {
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 300);
};

// 确认弹窗
const showConfirm = (title, message) => {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <span class="modal-logo">🦌</span>
                    <div class="modal-title">${title}</div>
                </div>
                <div class="modal-message">${message}</div>
                <div class="modal-buttons">
                    <button class="btn btn-primary confirm-btn">确认</button>
                    <button class="btn btn-secondary cancel-btn">取消</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const confirmBtn = overlay.querySelector('.confirm-btn');
        const cancelBtn = overlay.querySelector('.cancel-btn');

        confirmBtn.onclick = () => {
            overlay.remove();
            resolve(true);
        };
        cancelBtn.onclick = () => {
            overlay.remove();
            resolve(false);
        };
    });
};

// 提示消息
const showToast = (message, type = 'info') => {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('show');
    }, 100);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            document.body.removeChild(toast);
        }, 300);
    }, 3000);
};

// 随机祝福语
const congratsMessages = [
    "祝您今天开开心心！🌟",
    "奶茶喝得开心，心情美美哒！🥤",
    "今天也要元气满满哦！✨",
    "和小鹿一起享受美好时光！🦌",
    "祝您天天都有好心情！🌈",
    "记得给自己一些小确幸！💝",
    "愿您的生活甜甜蜜蜜！🍯",
    "今天也要继续加油呀！💪",
    "和小鹿一起创造美好回忆！🎈",
    "祝您快乐每一天！🌞"
];

// 根据活动类型的祝福语
const activityTypeMessages = {
    normal: [
        "祝您购物愉快！🛍️",
        "感谢您的惠顾！💝",
        "欢迎下次再来！🌟"
    ],
    buy_one_get_one: [
        "双倍的快乐送给您！🎁",
        "买一送一更划算！💫",
        "希望您喜欢我们的优惠！✨"
    ],
    free: [
        "免费的快乐送给您！🎈",
        "希望您享受这份小惊喜！🎉",
        "记得给朋友分享好消息哦！💌"
    ],
    discount: [
        "超值优惠享不停！💰",
        "省钱又开心！🌟",
        "聪明的选择！👏"
    ]
};

// 根据时间段的问候语
const getTimeGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 6) return "夜深了，要注意休息哦！🌙";
    if (hour < 11) return "早上好，元气满满的一天！🌅";
    if (hour < 14) return "中午好，享受美好时光！☀️";
    if (hour < 17) return "下午好，记得补充能量哦！🍵";
    if (hour < 19) return "傍晚好，放松一下吧！🌆";
    return "晚上好，度过愉快的夜晚！🌟";
};

// 更新核销成功动画函数
const showVerifySuccess = (activityName, activityType) => {
    // 获取对应活动类型的祝福语
    const typeMessages = activityTypeMessages[activityType] || activityTypeMessages.normal;
    const typeMessage = typeMessages[Math.floor(Math.random() * typeMessages.length)];
    
    // 创建弹窗
    const modal = document.createElement('div');
    modal.className = 'verify-success-modal';
    modal.innerHTML = `
        <div class="verify-success-decoration"></div>
        <div class="verify-success-deer">🦌</div>
        <div class="verify-success-title">核销成功</div>
        <div class="verify-success-message">
            <div class="activity-name">${activityName}</div>
            <div class="time-greeting">${getTimeGreeting()}</div>
            <div class="type-message">${typeMessage}</div>
            <div class="brand-message">鹿途拼拼祝您${congratsMessages[Math.floor(Math.random() * congratsMessages.length)]}</div>
        </div>
    `;
    document.body.appendChild(modal);

    // 创建更丰富的彩带效果
    createConfettiShower();

    // 播放成功音效（可选）
    playSuccessSound();

    // 自动移除
    setTimeout(() => {
        modal.remove();
    }, 2000);
};

// 创建更丰富的彩带效果
const createConfettiShower = () => {
    const colors = [
        'var(--primary-color)',
        'var(--primary-light)',
        'var(--secondary-color)',
        'var(--secondary-light)',
        'var(--accent-color)',
        'var(--accent-light)'
    ];

    // 创建多层彩带
    for (let i = 0; i < 100; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        
        // 随机大小
        const size = 5 + Math.random() * 10;
        confetti.style.width = `${size}px`;
        confetti.style.height = `${size}px`;
        
        // 随机位置和旋转
        confetti.style.left = Math.random() * 100 + 'vw';
        confetti.style.transform = `rotate(${Math.random() * 360}deg)`;
        
        // 随机颜色和形状
        confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        confetti.style.borderRadius = Math.random() > 0.5 ? '50%' : '0';
        
        // 随机动画时间和延迟
        const duration = 1 + Math.random() * 2;
        const delay = Math.random() * 0.5;
        confetti.style.animation = `confettiFall ${duration}s ${delay}s linear forwards`;
        
        document.body.appendChild(confetti);
        setTimeout(() => confetti.remove(), (duration + delay) * 1000);
    }
};

// 播放成功音效（可选）
const playSuccessSound = () => {
    const audio = new Audio('data:audio/mp3;base64,...'); // 这里可以添加一个简短的成功音效
    audio.volume = 0.3;
    try {
        audio.play();
    } catch (e) {
        console.log('Auto-play prevented');
    }
};

// 格式化日期
function formatDate(date) {
    return new Date(date).toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
}

// 格式化时间
function formatDateTime(date) {
    return new Date(date).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
} 