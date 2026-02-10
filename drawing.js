// /Users/minghan/Desktop/Project/UnboundBoard/drawing.js

// 設定 PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// 強制覆寫 getContext
const originalGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (type, attributes) {
    if (type === '2d') {
        attributes = attributes || {};
        attributes.willReadFrequently = true;
    }
    return originalGetContext.call(this, type, attributes);
};

// A4 橫向尺寸 (96 DPI: 297mm x 210mm => ~1123px x 794px)
const A4_WIDTH = 1123;
const A4_HEIGHT = 794;

// 追蹤畫布的基礎尺寸與縮放比例
let canvasBaseWidth = A4_WIDTH;
let canvasBaseHeight = A4_HEIGHT;
let canvasScale = 1;

const canvasEl = document.getElementById('c');
const canvas = new fabric.Canvas(canvasEl, {
    isDrawingMode: true,
    width: A4_WIDTH,
    height: A4_HEIGHT,
    backgroundColor: 'white',
    fireRightClick: true,
    stopContextMenu: true
});

// 畫筆設定
canvas.freeDrawingBrush.width = 5;
canvas.freeDrawingBrush.color = "black";

// 更新畫布尺寸與縮放 (核心邏輯：讓畫布 DOM 元素大小隨縮放改變)
function updateCanvasSize() {
    canvas.setWidth(canvasBaseWidth * canvasScale);
    canvas.setHeight(canvasBaseHeight * canvasScale);
    canvas.viewportTransform = [canvasScale, 0, 0, canvasScale, 0, 0];
    canvas.requestRenderAll();
}

function zoomCanvas(factor) {
    let newScale = canvasScale * factor;
    if (newScale > 5) newScale = 5;
    if (newScale < 0.1) newScale = 0.1;
    canvasScale = newScale;
    updateCanvasSize();
}

function fitCanvasToWindow() {
    const container = document.getElementById('canvas-container');
    if (!container) return;
    const padding = 100;
    const availW = container.clientWidth - padding;
    const availH = container.clientHeight - padding;
    const scaleW = availW / canvasBaseWidth;
    const scaleH = availH / canvasBaseHeight;
    canvasScale = Math.min(scaleW, scaleH); // 取較小值以完整顯示
    if (canvasScale <= 0) canvasScale = 0.1;
    updateCanvasSize();
}

function fitPdfToWindow(bgImg) {
    if (!bgImg) bgImg = canvas.getObjects().find(o => o.isPdfBackground);
    if (!bgImg) return;

    // 更新基礎尺寸為 PDF 頁面大小
    canvasBaseWidth = bgImg.width * bgImg.scaleX;
    canvasBaseHeight = bgImg.height * bgImg.scaleY;
    canvas.backgroundColor = "white"; // 確保背景為白色
    canvas.clipPath = null; // 移除裁切，因為畫布現在就是頁面大小

    fitCanvasToWindow();
}

// 設定定位點背景
window.setGridBackground = function() {
    const gridSize = 30; // 點的間距
    const dotRadius = 1; // 點的大小

    const patternCanvas = document.createElement('canvas');
    patternCanvas.width = gridSize;
    patternCanvas.height = gridSize;
    const ctx = patternCanvas.getContext('2d');

    ctx.fillStyle = '#cccccc'; // 淡灰色
    ctx.beginPath();
    ctx.arc(gridSize / 2, gridSize / 2, dotRadius, 0, Math.PI * 2);
    ctx.fill();

    const pattern = new fabric.Pattern({ source: patternCanvas, repeat: 'repeat' });
    canvas.setBackgroundColor(pattern, canvas.renderAll.bind(canvas));
}

window.setGridBackground(); // 初始化背景

// 新增：重置畫布為 A4 橫向 (供 clearCanvas 與 connection.js 使用)
window.resetToA4 = function() {
    canvasBaseWidth = A4_WIDTH;
    canvasBaseHeight = A4_HEIGHT;
    canvasScale = 1;
    updateCanvasSize();
    canvas.clipPath = null;
    window.setGridBackground();
};

// 確保物件擁有唯一 ID
function assignUid(obj) {
    if (!obj.uid) obj.uid = generateId();
}

// 平移工具變數
let isPanning = false;
let lastPosX = 0;
let lastPosY = 0;
let previousMode = null;
let isSpaceDown = false;

function setMode(mode) {
    // 允許平移模式 (pan) 在禁止編輯時使用
    if (mode !== 'pan' && !isHost && !roomSettings.allowEditing) return;
    currentMode = mode;

    document.getElementById('btn-pencil').classList.remove('active');
    document.getElementById('btn-select').classList.remove('active');
    document.getElementById('btn-eraser').classList.remove('active');
    const btnPan = document.getElementById('btn-pan');
    if (btnPan) btnPan.classList.remove('active');

    canvas.isDrawingMode = false;
    canvas.selection = false;
    canvas.defaultCursor = 'default';
    canvas.forEachObject(o => {
        if (o.isPdfBackground) {
            o.selectable = false;
            o.evented = false;
            o.lockMovementX = true;
            o.lockMovementY = true;
            o.lockRotation = true;
            o.lockScalingX = true;
            o.lockScalingY = true;
        } else {
            o.selectable = true;
            o.perPixelTargetFind = false;
            o.evented = true;
        }
    });

    if (mode === 'pencil') {
        canvas.isDrawingMode = true;
        document.getElementById('btn-pencil').classList.add('active');
    }
    else if (mode === 'select') {
        document.getElementById('btn-select').classList.add('active');
        canvas.selection = true;
    }
    else if (mode === 'pan') {
        if (btnPan) btnPan.classList.add('active');
        canvas.defaultCursor = 'grab';
        canvas.forEachObject(o => {
            o.selectable = false;
            o.evented = false;
        });
        canvas.discardActiveObject();
        canvas.requestRenderAll();
    }
    else if (mode === 'eraser') {
        document.getElementById('btn-eraser').classList.add('active');
        canvas.defaultCursor = 'crosshair';
        canvas.forEachObject(o => {
            o.selectable = false;
            if (o.type === 'path') {
                o.perPixelTargetFind = true;
                o.targetFindTolerance = 4;
            } else {
                o.evented = false;
            }
        });
        canvas.discardActiveObject();
        canvas.requestRenderAll();
    }
}

canvas.on('mouse:down', (opt) => {
    const evt = opt.e;
    if (currentMode === 'pan' || isSpaceDown) {
        isPanning = true;
        canvas.setCursor('grabbing');
        lastPosX = evt.clientX;
        lastPosY = evt.clientY;
        return;
    }
    isMouseDown = true;
    let target = opt.target;

    document.getElementById('context-menu').style.display = 'none';

    if (opt.button === 3) {
        // 右鍵點擊：嘗試尋找目標 (特別是在畫筆模式或縮放狀態下)
        if (!target) {
            target = canvas.findTarget(opt.e);
            // 雙重確認：手動檢測 (解決縮放時 findTarget 可能失準的問題)
            if (!target) {
                const pointer = canvas.getPointer(opt.e);
                const objects = canvas.getObjects();
                for (let i = objects.length - 1; i >= 0; i--) {
                    if (objects[i].containsPoint(pointer) && !objects[i].isPdfBackground && objects[i].visible) {
                        target = objects[i];
                        break;
                    }
                }
            }
        }
    }

    if (opt.button === 3 && target && !target.isPdfBackground) {
        canvas.setActiveObject(target);
        canvas.renderAll();
        const menu = document.getElementById('context-menu');
        menu.style.display = 'block';
        menu.style.left = opt.e.clientX + 'px';
        menu.style.top = opt.e.clientY + 'px';
        return;
    }
    if (currentMode === 'eraser' && opt.target && opt.target.type === 'path') {
        // 橡皮擦：移除物件
        canvas.remove(opt.target);
        canvas.requestRenderAll();
        if (typeof sendObjectUpdate === 'function') sendObjectUpdate('remove', opt.target);
    }
});
canvas.on('mouse:up', () => { 
    if (isPanning) {
        isPanning = false;
        canvas.setCursor(currentMode === 'pan' || isSpaceDown ? 'grab' : 'default');
    }
    isMouseDown = false; 
});
canvas.on('mouse:move', (opt) => {
    if (isPanning) {
        const evt = opt.e;
        const container = document.getElementById('canvas-container');
        container.scrollLeft -= (evt.clientX - lastPosX);
        container.scrollTop -= (evt.clientY - lastPosY);
        lastPosX = evt.clientX;
        lastPosY = evt.clientY;
        return;
    }
    if (currentMode === 'eraser' && isMouseDown && opt.target && opt.target.type === 'path') {
        canvas.remove(opt.target);
        canvas.requestRenderAll();
        if (typeof sendObjectUpdate === 'function') sendObjectUpdate('remove', opt.target);
    }
});

// 監聽增量更新事件
canvas.on('path:created', (e) => {
    assignUid(e.path);
    if (typeof sendObjectUpdate === 'function') sendObjectUpdate('add', e.path);
});

canvas.on('object:modified', (e) => {
    // 處理多選移動的情況
    if (e.target.type === 'activeSelection') {
        e.target.getObjects().forEach(obj => {
            if (typeof sendObjectUpdate === 'function') sendObjectUpdate('modify', obj);
        });
    } else {
        if (typeof sendObjectUpdate === 'function') sendObjectUpdate('modify', e.target);
    }
});

canvas.on('text:editing:exited', (e) => {
    if (typeof sendObjectUpdate === 'function') sendObjectUpdate('modify', e.target);
});

function addStickyNote() {
    if (!isHost && !roomSettings.allowEditing) return;
    const note = new fabric.Textbox('雙擊編輯', {
        left: Math.random() * (canvas.width - 200) + 50,
        top: Math.random() * (canvas.height - 200) + 50,
        width: 150,
        fontSize: 20,
        backgroundColor: '#ffeb3b',
        splitByGrapheme: true
    });
    assignUid(note);
    canvas.add(note);
    canvas.setActiveObject(note);
    setMode('select');
    if (typeof sendObjectUpdate === 'function') sendObjectUpdate('add', note);
}

function deleteSelectedObject() {
    if (!isHost && !roomSettings.allowEditing) return;
    const activeObjects = canvas.getActiveObjects();
    if (activeObjects.length) {
        if (activeObjects[0].isEditing) return;
        canvas.discardActiveObject();
        activeObjects.forEach(obj => {
            canvas.remove(obj);
            if (typeof sendObjectUpdate === 'function') sendObjectUpdate('remove', obj);
        });
        canvas.requestRenderAll();
    }
    document.getElementById('context-menu').style.display = 'none';
}

window.addEventListener('keydown', (e) => {
    const activeEl = document.activeElement;
    const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable);
    
    // 空白鍵切換平移模式
    if (e.code === 'Space' && !isInput) {
        e.preventDefault(); // 防止網頁捲動
        if (!isSpaceDown) {
            isSpaceDown = true;
            if (currentMode !== 'pan') {
                previousMode = currentMode;
                setMode('pan');
            }
        }
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && !isInput) {
        deleteSelectedObject();
    }
});

window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && isSpaceDown) {
        isSpaceDown = false;
        if (previousMode) {
            setMode(previousMode);
            previousMode = null;
        }
    }
});

function handleImageUpload(input) {
    if (!isHost && !roomSettings.allowEditing) return;
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
        fabric.Image.fromURL(e.target.result, function (img) {
            const maxSize = 300;
            const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
            img.set({
                left: Math.random() * (canvas.width - 200) + 50,
                top: Math.random() * (canvas.height - 200) + 50,
                scaleX: scale,
                scaleY: scale
            });
            assignUid(img);
            canvas.add(img);
            canvas.setActiveObject(img);
            setMode('select');
            if (typeof sendObjectUpdate === 'function') sendObjectUpdate('add', img);
        });
    };
    reader.readAsDataURL(file);
    input.value = '';
}

function changePdfPage(offset, isAbsolute = false, silent = false) {
    const newIndex = isAbsolute ? offset : currentPdfPage + offset;
    if (newIndex < 0 || newIndex >= pdfImages.length) return;
    
    // 訪客邏輯：檢查是否進入預覽模式
    if (!isHost) {
        // 訪客只能切換到已有影像資料的頁面 (已觀看過的頁面)
        if (!pdfImages[newIndex]) return;

        if (newIndex !== hostPdfPage) {
            isPrivateView = true;
            document.getElementById('btn-return-live').style.display = 'inline-block';
            // 不更新狀態文字，避免覆蓋連線狀態，或可顯示提示
        } else {
            // 如果手動切回房主頁面，視為回到同步
            isPrivateView = false;
            document.getElementById('btn-return-live').style.display = 'none';
            // 請求最新畫布狀態以確保同步
            if (!silent && conn && conn.open) conn.send({ type: 'REQUEST_INIT' });
        }
    }

    // 只有在同步狀態下（或房主）才保存編輯狀態，避免預覽時覆蓋資料
    if (currentPdfPage >= 0 && !isPrivateView) {
        pdfCanvasStates[currentPdfPage] = JSON.stringify(canvas.toJSON(['isPdfBackground', 'uid']));
    }
    currentPdfPage = newIndex;
    
    if (isHost) {
        hostPdfPage = currentPdfPage;
        if (typeof broadcast === 'function') broadcast({ type: 'PDF_PAGE_SYNC', pageIndex: currentPdfPage });
    }
    
    loadPdfPage();
}

window.returnToLive = function() {
    isPrivateView = false;
    document.getElementById('btn-return-live').style.display = 'none';
    changePdfPage(hostPdfPage, true);
};

window.updatePdfButtons = function() {
    const btnPrev = document.getElementById('btn-pdf-prev');
    const btnNext = document.getElementById('btn-pdf-next');
    if (!btnPrev || !btnNext) return;

    // 上一頁：第一頁時鎖定
    // 訪客：如果上一頁沒有資料 (pdfImages[currentPdfPage - 1] 為空)，則鎖定
    let isPrevDisabled = currentPdfPage <= 0;
    if (!isHost && !isPrevDisabled) {
        isPrevDisabled = !pdfImages[currentPdfPage - 1];
    }
    btnPrev.disabled = isPrevDisabled;
    btnPrev.style.opacity = btnPrev.disabled ? 0.5 : 1;
    btnPrev.style.cursor = btnPrev.disabled ? 'not-allowed' : 'pointer';

    // 下一頁：
    // 房主：最後一頁時鎖定
    // 訪客：到達房主當前頁面時鎖定 (不可超前)
    // 訪客：如果下一頁沒有資料 (pdfImages[currentPdfPage + 1] 為空)，則鎖定
    let isNextDisabled = currentPdfPage >= pdfImages.length - 1;
    if (!isHost) {
        // 訪客如果下一頁沒有資料 (尚未觀看過)，則不能前往
        isNextDisabled = isNextDisabled || !pdfImages[currentPdfPage + 1];
    }
    
    btnNext.disabled = isNextDisabled;
    btnNext.style.opacity = btnNext.disabled ? 0.5 : 1;
    btnNext.style.cursor = btnNext.disabled ? 'not-allowed' : 'pointer';
};

async function loadPdfPage() {
    updatePdfButtons();
    document.getElementById('pdf-page-indicator').innerText = `${currentPdfPage + 1} / ${pdfImages.length}`;
    
    // Host Logic: Lazy Loading & Broadcast
    if (isHost) {
        if (!pdfImages[currentPdfPage]) {
            setOverlay(true, "載入頁面中...");
            try {
                await renderPdfPage(currentPdfPage);
            } catch (e) {
                console.error("Render Error:", e);
                setOverlay(false);
                return;
            }
            setOverlay(false);
        }
        // 廣播當前頁面影像給訪客
        if (typeof broadcast === 'function') {
            broadcast({
                type: 'PDF_PAGE_DATA',
                pageIndex: currentPdfPage,
                totalPages: pdfImages.length,
                image: pdfImages[currentPdfPage]
            });
        }
    }

    // 防護機制：若在渲染期間收到了全量更新 (CANVAS_UPDATE)，且該更新已包含正確的背景圖，則不重複載入
    const currentBg = canvas.getObjects().find(o => o.isPdfBackground);
    if (currentBg && currentBg.getSrc() === pdfImages[currentPdfPage]) {
        return;
    }

    // 預覽模式：只載入背景圖，不載入畫筆內容（因為沒有該頁的最新數據）
    if (isPrivateView) {
        canvas.clear();
        canvas.backgroundColor = "#f8f9fa";
        fabric.Image.fromURL(pdfImages[currentPdfPage], function (img) {
            img.set({
                left: 0, top: 0, originX: 'left', originY: 'top',
                scaleX: 1, scaleY: 1, selectable: false, evented: false,
                isPdfBackground: true,
                lockMovementX: true, lockMovementY: true,
                lockRotation: true, lockScalingX: true, lockScalingY: true
            });
            canvas.add(img);
            canvas.sendToBack(img);
            fitPdfToWindow(img);
        });
        return;
    }

    isSyncing = true;
    const onLoaded = () => {
        isSyncing = false;
        // 切換頁面屬於大幅變動，使用全量更新較安全
        if (isHost && typeof sendFullSync === 'function') sendFullSync();
    };
    if (pdfCanvasStates[currentPdfPage]) {
        canvas.loadFromJSON(pdfCanvasStates[currentPdfPage], () => {
            const bg = canvas.getObjects().find(o => o.isPdfBackground);
            if (bg) {
                bg.set({
                    selectable: false, evented: false,
                    lockMovementX: true, lockMovementY: true,
                    lockRotation: true, lockScalingX: true, lockScalingY: true
                });
            }
            // 載入後自動適應視窗 (若需要保持縮放可改用 updateCanvasSize)
            fitPdfToWindow();
            onLoaded();
        });
    } else {
        canvas.clear();
        canvas.backgroundColor = "#f8f9fa";
        canvas.setZoom(1);
        canvas.viewportTransform = [1, 0, 0, 1, 0, 0];
        fabric.Image.fromURL(pdfImages[currentPdfPage], function (img) {
            img.set({
                left: 0, top: 0, originX: 'left', originY: 'top',
                scaleX: 1, scaleY: 1, selectable: false, evented: false,
                isPdfBackground: true,
                lockMovementX: true, lockMovementY: true,
                lockRotation: true, lockScalingX: true, lockScalingY: true
            });
            assignUid(img);
            canvas.add(img);
            canvas.sendToBack(img);
            fitPdfToWindow(img);
            onLoaded();
        });
    }
}

function closePdfMode() {
    if (!confirm("確定要結束 PDF 簡報模式嗎？這將會清空目前的畫布。")) return;
    pdfImages = [];
    pdfCanvasStates = [];
    currentPdfPage = -1;
    pdfDoc = null;
    currentPdfFile = null;
    document.getElementById('pdf-controls').style.display = 'none';
    document.getElementById('btn-pdf').style.display = 'inline-block';
    document.getElementById('btn-img').style.display = 'inline-block';

    // 使用 clearCanvas(true) 來執行強制全清空與重置 A4
    clearCanvas(true);
}

window.startPdfUpload = function () {
    if (!isHost) {
        alert("只有房主可以上傳 PDF");
        return;
    }
    document.getElementById('pdf-upload').click();
};

// 輔助函式：渲染單一 PDF 頁面
async function renderPdfPage(index) {
    if (pdfImages[index]) return pdfImages[index];
    if (!pdfDoc) return null;
    
    const page = await pdfDoc.getPage(index + 1);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvasTmp = document.createElement('canvas');
    const context = canvasTmp.getContext('2d');
    canvasTmp.height = viewport.height;
    canvasTmp.width = viewport.width;
    await page.render({ canvasContext: context, viewport: viewport }).promise;
    const dataUrl = canvasTmp.toDataURL('image/jpeg', 0.8);
    pdfImages[index] = dataUrl;
    return dataUrl;
}

window.processPdfFile = async function(arrayBuffer) {
    setOverlay(true, "正在處理 PDF...");
    currentPdfFile = arrayBuffer; // 保存檔案以供後續同步
    pdfCanvasStates = [];
    currentPdfPage = -1;
    try {
        // 複製一份 Buffer 給 PDF.js，避免原始 Buffer 被 Worker 轉移 (Detached) 而導致無法廣播或再次使用
        const pdfBuffer = arrayBuffer.slice(0);
        pdfDoc = await pdfjsLib.getDocument({
            data: pdfBuffer,
            cMapUrl: 'https://unpkg.com/pdfjs-dist@3.11.174/cmaps/',
            cMapPacked: true
        }).promise;
        
        // 初始化圖片陣列 (Lazy Loading)
        pdfImages = new Array(pdfDoc.numPages).fill(null);
        
        // 立即更新 UI：顯示總頁數與按鈕狀態
        document.getElementById('pdf-page-indicator').innerText = `- / ${pdfDoc.numPages}`;
        updatePdfButtons();

        document.getElementById('pdf-controls').style.display = 'flex';
        
        // 房主模式：初始化並切換到第一頁 (這會觸發 loadPdfPage 並廣播影像)
        if (isHost) {
            changePdfPage(1); // 1-based logic in UI, but index is 0. changePdfPage(1) adds to -1 -> 0.
            setMode('select');
        }
    } catch (err) {
        console.error(err);
        alert("PDF 處理失敗");
    } finally {
        setOverlay(false);
    }
};

async function handlePdfUpload(input) {
    if (!isHost) return;
    const file = input.files[0];
    if (!file) return;
    const arrayBuffer = await file.arrayBuffer();
    await processPdfFile(arrayBuffer);
    input.value = '';
}

function clearCanvas(forceFullClear = false) {
    if (!isHost && !roomSettings.allowEditing) return;
    
    // 判斷是否處於 PDF 模式 (且非強制全清空)
    // 條件：currentPdfPage 有效 且 pdfImages 存在，或者畫布上已有 PDF 背景物件
    const isPdfState = currentPdfPage >= 0 && pdfImages.length > 0;
    const hasPdfObject = canvas.getObjects().some(o => o.isPdfBackground);

    if (!forceFullClear && (isPdfState || hasPdfObject)) {
        // PDF 模式：僅清除註記，保留背景
        isSyncing = true;
        const objects = canvas.getObjects();
        for (let i = objects.length - 1; i >= 0; i--) {
            if (!objects[i].isPdfBackground) {
                canvas.remove(objects[i]);
            }
        }
        canvas.requestRenderAll();
        isSyncing = false;
        
        // 更新當前頁面的儲存狀態
        if (isHost && currentPdfPage >= 0) {
            pdfCanvasStates[currentPdfPage] = JSON.stringify(canvas.toJSON(['isPdfBackground', 'uid']));
        }
        
        if (typeof broadcast === 'function') broadcast({ type: 'CLEAR_PAGE' });
    } else {
        // 一般模式或強制清空：重置為 A4 並清空所有內容
        isSyncing = true;
        canvas.clear();
        
        if (typeof window.resetToA4 === 'function') {
            window.resetToA4();
        } else {
            canvasBaseWidth = A4_WIDTH;
            canvasBaseHeight = A4_HEIGHT;
            canvasScale = 1;
            updateCanvasSize();
            if (typeof window.setGridBackground === 'function') window.setGridBackground();
        }

        lastModified = Date.now();
        if (isHost) {
            localStorage.removeItem('unbound_board_state');
            localStorage.removeItem('unbound_last_modified');
        }
        if (typeof broadcast === 'function') broadcast({ type: 'CLEAR' });
        isSyncing = false;
    }
}

function copyLink() {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
        alert("連結已複製！傳給朋友即可加入協作。\n" + url);
    });
}

// 初始 UI 狀態
setMode('pencil');
