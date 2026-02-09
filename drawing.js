// /Users/minghan/Desktop/Project/UnboundBoard/drawing.js

// 設定 PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// 強制覆寫 getContext
const originalGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function(type, attributes) {
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

// 右鍵選單處理
canvas.upperCanvasEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const pointer = canvas.getPointer(e);
    const objects = canvas.getObjects();
    let target = null;
    for (let i = objects.length - 1; i >= 0; i--) {
        if (objects[i].containsPoint(pointer)) {
            target = objects[i];
            break;
        }
    }
    if (target) {
        canvas.setActiveObject(target);
        canvas.renderAll();
        const menu = document.getElementById('context-menu');
        menu.style.display = 'block';
        menu.style.left = e.clientX + 'px';
        menu.style.top = e.clientY + 'px';
    } else {
        document.getElementById('context-menu').style.display = 'none';
    }
});

// 更新畫布尺寸與縮放 (核心邏輯：讓畫布 DOM 元素大小隨縮放改變)
function updateCanvasSize() {
    canvas.setWidth(canvasBaseWidth * canvasScale);
    canvas.setHeight(canvasBaseHeight * canvasScale);
    canvas.setZoom(canvasScale);
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
    const padding = 40;
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
function setGridBackground() {
    const gridSize = 30; // 點的間距
    const dotRadius = 1; // 點的大小
    
    const patternCanvas = document.createElement('canvas');
    patternCanvas.width = gridSize;
    patternCanvas.height = gridSize;
    const ctx = patternCanvas.getContext('2d');
    
    ctx.fillStyle = '#cccccc'; // 淡灰色
    ctx.beginPath();
    ctx.arc(gridSize/2, gridSize/2, dotRadius, 0, Math.PI * 2);
    ctx.fill();

    const pattern = new fabric.Pattern({ source: patternCanvas, repeat: 'repeat' });
    canvas.setBackgroundColor(pattern, canvas.renderAll.bind(canvas));
}

setGridBackground(); // 初始化背景

// 確保物件擁有唯一 ID
function assignUid(obj) {
    if (!obj.uid) obj.uid = generateId();
}

function setMode(mode) {
    if (!isHost && !roomSettings.allowEditing && mode !== 'select') return;
    currentMode = mode;
    
    document.getElementById('btn-pencil').classList.remove('active');
    document.getElementById('btn-select').classList.remove('active');
    document.getElementById('btn-eraser').classList.remove('active');
    
    canvas.isDrawingMode = false;
    canvas.selection = false;
    canvas.defaultCursor = 'default';
    canvas.forEachObject(o => {
        if (o.isPdfBackground) {
            o.selectable = false;
            o.evented = false;
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
    isMouseDown = true;
    let target = opt.target;
    if (opt.button === 3 && !target && canvas.isDrawingMode) {
        target = canvas.findTarget(opt.e);
    }
    document.getElementById('context-menu').style.display = 'none';
    if (opt.button === 3 && target) {
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
canvas.on('mouse:up', () => { isMouseDown = false; });
canvas.on('mouse:move', (opt) => {
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
    if ((e.key === 'Delete' || e.key === 'Backspace') && !isInput) {
        deleteSelectedObject();
    }
});

function handleImageUpload(input) {
    if (!isHost && !roomSettings.allowEditing) return;
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        fabric.Image.fromURL(e.target.result, function(img) {
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

function changePdfPage(offset) {
    const newIndex = currentPdfPage + offset;
    if (newIndex < 0 || newIndex >= pdfImages.length) return;
    if (currentPdfPage >= 0) {
        pdfCanvasStates[currentPdfPage] = JSON.stringify(canvas.toJSON(['isPdfBackground', 'uid']));
    }
    currentPdfPage = newIndex;
    loadPdfPage();
}

function loadPdfPage() {
    document.getElementById('pdf-page-indicator').innerText = `${currentPdfPage + 1} / ${pdfImages.length}`;
    isSyncing = true;
    const onLoaded = () => {
        isSyncing = false;
        // 切換頁面屬於大幅變動，使用全量更新較安全
        if (typeof sendFullSync === 'function') sendFullSync();
    };
    if (pdfCanvasStates[currentPdfPage]) {
        canvas.loadFromJSON(pdfCanvasStates[currentPdfPage], () => {
            // 載入後自動適應視窗 (若需要保持縮放可改用 updateCanvasSize)
            fitPdfToWindow(); 
            onLoaded();
        });
    } else {
        canvas.clear();
        canvas.backgroundColor = "#f8f9fa";
        canvas.setZoom(1);
        canvas.viewportTransform = [1, 0, 0, 1, 0, 0];
        fabric.Image.fromURL(pdfImages[currentPdfPage], function(img) {
            img.set({
                left: 0, top: 0, originX: 'left', originY: 'top',
                scaleX: 1, scaleY: 1, selectable: false, evented: false,
                isPdfBackground: true
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
    document.getElementById('pdf-controls').style.display = 'none';
    document.getElementById('btn-pdf').style.display = 'inline-block';
    document.getElementById('btn-img').style.display = 'inline-block';
    
    // 恢復 A4 尺寸
    canvasBaseWidth = A4_WIDTH;
    canvasBaseHeight = A4_HEIGHT;
    canvasScale = 1;
    updateCanvasSize();
    canvas.clipPath = null;
    clearCanvas();
}

async function handlePdfUpload(input) {
    if (!isHost && !roomSettings.allowEditing) return;
    const file = input.files[0];
    if (!file) return;
    setOverlay(true, "正在處理 PDF...");
    pdfImages = [];
    pdfCanvasStates = [];
    currentPdfPage = -1;
    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 2.0 });
            const canvasTmp = document.createElement('canvas');
            const context = canvasTmp.getContext('2d');
            canvasTmp.height = viewport.height;
            canvasTmp.width = viewport.width;
            await page.render({ canvasContext: context, viewport: viewport }).promise;
            pdfImages.push(canvasTmp.toDataURL('image/jpeg', 0.8));
        }
        document.getElementById('pdf-controls').style.display = 'flex';
        changePdfPage(1);
        setMode('select');
    } catch (err) {
        console.error(err);
        alert("PDF 處理失敗");
    } finally {
        setOverlay(false);
        input.value = '';
    }
}

function clearCanvas() {
    if (!isHost && !roomSettings.allowEditing) return;
    isSyncing = true; // 鎖定，避免觸發個別的 remove 事件
    canvas.clear();
    setGridBackground(); // 恢復定位點背景
    canvas.setZoom(1);
    canvas.viewportTransform = [1, 0, 0, 1, 0, 0];
    lastModified = Date.now();
    if (isHost) localStorage.removeItem('unbound_board_state');
    if (typeof broadcast === 'function') broadcast({ type: 'CLEAR' });
    isSyncing = false;
}

function copyLink() {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
        alert("連結已複製！傳給朋友即可加入協作。\n" + url);
    });
}

// 初始 UI 狀態
setMode('pencil');
