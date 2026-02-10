// /Users/minghan/Desktop/Project/UnboundBoard/globals.js

// --- 狀態變數 ---
let peer = null;
let conn = null; // 用於 Guest 存 Host 的連線
let connections = []; // 用於 Host 存所有 Guest 的連線
let isHost = false;
let isSyncing = false; // 防止迴圈更新
let myPeerId = null;
let knownPeers = [];
let isTempHost = false;
let lastHeartbeat = Date.now();
let lastModified = 0;
let pendingAcks = new Map();
let retryCount = 0;
let reconnectInterval = null;
let myNickname = "Guest";
let nicknames = {};
let raisedHands = new Set();
let failedCandidates = new Set();
let roomSettings = { allowRaiseHand: true, allowChat: true, allowEditing: true };
let toastTimeout = null;
let updateTimer = null; // 用於 sendFullSync 的防抖動計時器

// --- PDF 變數 ---
let pdfImages = [];
let pdfCanvasStates = [];
let currentPdfPage = -1;
let pdfDoc = null; // PDF 文件物件 (Lazy Loading 用)
let lastPdfSrc = null;
let currentPdfFile = null; // 暫存 PDF 原始檔案，供新訪客同步使用
let hostPdfPage = 0;
let isPrivateView = false;

// --- YouTube 變數 ---
let ytPlayer = null;
let isYoutubeActive = false;
let currentYoutubeId = null;

// --- UI 狀態 ---
let currentMode = 'pencil';
let isMouseDown = false;
let activeTab = 'chat';

// --- URL 參數 ---
const urlParams = new URLSearchParams(window.location.search);
let targetHostId = urlParams.get('id');
const lastHostId = localStorage.getItem('unbound_host_id');

// --- 工具函式 ---

function setOverlay(show, msg = "") {
    const overlay = document.getElementById('overlay');
    const msgDiv = document.getElementById('overlay-msg');
    if (msg) msgDiv.innerText = msg;
    if (show) overlay.classList.remove('hidden');
    else overlay.classList.add('hidden');
}

function showToast(msg, type = 'normal') {
    const container = document.getElementById('toast-container');

    // 清除舊的計時器
    if (toastTimeout) {
        clearTimeout(toastTimeout);
        toastTimeout = null;
    }

    // 清空容器，確保只顯示一則 (共用氣泡)
    container.innerHTML = '';

    const div = document.createElement('div');
    div.className = 'toast';
    div.innerText = msg;

    // 根據類型設定樣式
    if (type === 'chat') {
        div.style.backgroundColor = 'rgba(0, 123, 255, 0.9)';
    }

    container.appendChild(div);

    // 設定新的計時器 (配合 CSS 動畫時間 3s)
    toastTimeout = setTimeout(() => {
        if (div.parentNode) div.remove();
    }, 3000);
}

function generateId() {
    return 'board-' + Math.random().toString(36).substr(2, 9);
}

function generateNickname() {
    const adjectives = ['迅敏', '閃電', '快樂', '幸運', '夢幻', '陽光', '活力', '溫柔', '勇敢', '聰明', '活潑', '可愛', '神奇', '優雅', '熱情'];
    const animals = ['貓咪', '狗狗', '兔子', '狐狸', '熊貓', '老鷹', '獅子', '老虎', '企鵝', '海豚', '無尾熊', '袋鼠', '小鹿', '松鼠'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const animal = animals[Math.floor(Math.random() * animals.length)];
    return `${adj}${animal}`;
}
