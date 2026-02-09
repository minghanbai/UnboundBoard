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

const canvasEl = document.getElementById('c');
const canvas = new fabric.Canvas(canvasEl, {
    isDrawingMode: true,
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

function resizeCanvas() {
    canvas.setWidth(window.innerWidth);
    canvas.setHeight(window.innerHeight - document.getElementById('toolbar').offsetHeight);
    const bg = canvas.getObjects().find(o => o.isPdfBackground);
    if (bg) fitPdfToWindow(bg);
}

function fitPdfToWindow(bgImg) {
    if (!bgImg) bgImg = canvas.getObjects().find(o => o.isPdfBackground);
    if (!bgImg) return;

    canvas.backgroundColor = "#525659";
    const clipRect = new fabric.Rect({
        left: bgImg.left,
        top: bgImg.top,
        width: bgImg.width * bgImg.scaleX,
        height: bgImg.height * bgImg.scaleY
    });
    canvas.clipPath = clipRect;

    const padding = 40;
    const availableWidth = canvas.width - padding;
    const availableHeight = canvas.height - padding;
    const contentWidth = bgImg.width * bgImg.scaleX;
    const contentHeight = bgImg.height * bgImg.scaleY;
    const zoom = Math.min(availableWidth / contentWidth, availableHeight / contentHeight);
    
    canvas.setZoom(zoom);
    const vpt = canvas.viewportTransform;
    vpt[4] = (canvas.width - contentWidth * zoom) / 2;
    vpt[5] = (canvas.height - contentHeight * zoom) / 2;
    canvas.requestRenderAll();
}

function zoomPdf(factor) {
    let zoom = canvas.getZoom();
    zoom *= factor;
    if (zoom > 5) zoom = 5;
    if (zoom < 0.1) zoom = 0.1;
    canvas.zoomToPoint(new fabric.Point(canvas.width / 2, canvas.height / 2), zoom);
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

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
        canvas.remove(opt.target);
    }
});
canvas.on('mouse:up', () => { isMouseDown = false; });
canvas.on('mouse:move', (opt) => {
    if (currentMode === 'eraser' && isMouseDown && opt.target && opt.target.type === 'path') {
        canvas.remove(opt.target);
    }
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
    canvas.add(note);
    canvas.setActiveObject(note);
    setMode('select');
    if (typeof sendUpdate === 'function') sendUpdate();
}

function deleteSelectedObject() {
    if (!isHost && !roomSettings.allowEditing) return;
    const activeObjects = canvas.getActiveObjects();
    if (activeObjects.length) {
        if (activeObjects[0].isEditing) return;
        canvas.discardActiveObject();
        activeObjects.forEach(obj => canvas.remove(obj));
        canvas.requestRenderAll();
        if (typeof sendUpdate === 'function') sendUpdate();
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
            canvas.add(img);
            canvas.setActiveObject(img);
            setMode('select');
            if (typeof sendUpdate === 'function') sendUpdate(3000);
        });
    };
    reader.readAsDataURL(file);
    input.value = '';
}

function changePdfPage(offset) {
    const newIndex = currentPdfPage + offset;
    if (newIndex < 0 || newIndex >= pdfImages.length) return;
    if (currentPdfPage >= 0) {
        pdfCanvasStates[currentPdfPage] = JSON.stringify(canvas.toJSON(['isPdfBackground']));
    }
    currentPdfPage = newIndex;
    loadPdfPage();
}

function loadPdfPage() {
    document.getElementById('pdf-page-indicator').innerText = `${currentPdfPage + 1} / ${pdfImages.length}`;
    isSyncing = true;
    const onLoaded = () => {
        isSyncing = false;
        if (typeof sendUpdate === 'function') sendUpdate();
    };
    if (pdfCanvasStates[currentPdfPage]) {
        canvas.loadFromJSON(pdfCanvasStates[currentPdfPage], () => {
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
    canvas.setZoom(1);
    canvas.viewportTransform = [1, 0, 0, 1, 0, 0];
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
    canvas.clear();
    canvas.backgroundColor = "#f8f9fa";
    canvas.setZoom(1);
    canvas.viewportTransform = [1, 0, 0, 1, 0, 0];
    lastModified = Date.now();
    if (isHost) localStorage.removeItem('unbound_board_state');
    if (typeof broadcast === 'function') broadcast({ type: 'CLEAR' });
}

function copyLink() {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
        alert("連結已複製！傳給朋友即可加入協作。\n" + url);
    });
}

// 初始 UI 狀態
setMode('pencil');
