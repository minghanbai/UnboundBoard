// /Users/minghan/Desktop/Project/UnboundBoard/connection.js

// --- PeerJS 連線邏輯 ---
function initializePeer(forceGuest = false) {
    if (peer) {
        peer.destroy();
        peer = null;
    }
    if (reconnectInterval) {
        clearInterval(reconnectInterval);
        reconnectInterval = null;
    }

    const isReturningHost = !forceGuest && targetHostId && (targetHostId === lastHostId);

    if (targetHostId && !isReturningHost) {
        isHost = false;
        peer = new Peer();
        setOverlay(true, "正在初始化連線...");
    } else {
        isHost = true;
        const idToUse = isReturningHost ? targetHostId : generateId();
        if (!isReturningHost) {
            localStorage.setItem('unbound_host_id', idToUse);
        }
        peer = new Peer(idToUse);
    }

    bindPeerEvents(isReturningHost);
    applyRoomSettings();
}

function bindPeerEvents(isReturningHost) {
    peer.on('open', (id) => {
        myPeerId = id;
        console.log('My ID:', id);
        nicknames[id] = myNickname;
        retryCount = 0;

        if (isHost) {
            const savedState = localStorage.getItem('unbound_board_state');
            const savedTime = localStorage.getItem('unbound_last_modified');
            if (savedState) {
                canvas.loadFromJSON(savedState, () => canvas.renderAll());
            }
            if (savedTime) {
                lastModified = parseInt(savedTime);
            }

            if (isReturningHost) {
                setOverlay(true, "正在等待同步最新狀態...");
                setTimeout(() => {
                    const msgDiv = document.getElementById('overlay-msg');
                    if (msgDiv && msgDiv.innerText === "正在等待同步最新狀態...") {
                        setOverlay(false);
                    }
                }, 4000);
            }

            const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?id=' + id;
            window.history.pushState({path:newUrl},'',newUrl);
        } else {
            connectToHost(targetHostId);
            startReconnectLoop();
        }
    });

    peer.on('connection', (c) => {
        c.on('open', () => {
            connections.push(c);
            updateStatus();
            if (isHost) {
                broadcastPeerList();
                c.send({ type: 'CANVAS_UPDATE', content: JSON.stringify(canvas.toJSON(['isPdfBackground', 'uid', 'pdfPage'])), timestamp: lastModified, settings: roomSettings });
                if (isYoutubeActive && currentYoutubeId) {
                    c.send({ type: 'YOUTUBE_START', videoId: currentYoutubeId });
                    if (ytPlayer && typeof ytPlayer.getCurrentTime === 'function') {
                        // 稍微延遲發送狀態，確保對方播放器已載入
                        setTimeout(() => syncYoutubeToPeer(c), 2000);
                    }
                }
            }
        });
        c.on('data', (data) => handleDataReceived(data, c));
        c.on('close', () => {
            connections = connections.filter(conn => conn !== c);
            updateStatus();
            renderUserList();
            if (isHost) broadcastPeerList();
        });
    });

    peer.on('error', (err) => {
        console.error(err);
        if(err.type === 'unavailable-id') {
            if (isHost && isReturningHost) {
                if (retryCount < 3) {
                    retryCount++;
                    setOverlay(true, `ID 佔用中，正在重試 (${retryCount}/3)...`);
                    setTimeout(() => initializePeer(false), 1500);
                } else {
                    alert("無法取得房主權限 (ID 仍被佔用)，將轉為訪客模式。");
                    initializePeer(true);
                }
            } else {
                alert("ID 衝突，請重新整理頁面");
            }
        } else if (err.type === 'peer-unavailable') {
            // 若連線備用房主失敗，觸發斷線處理以嘗試下一位
            if (conn && conn.peer !== targetHostId) {
                handleHostDisconnect();
            }
        }
    });
}

function createRoom() {
    const nameInput = document.getElementById('nickname-input').value.trim();
    myNickname = nameInput || generateNickname();
    localStorage.removeItem('unbound_board_state');
    localStorage.removeItem('unbound_last_modified');
    document.getElementById('landing-modal').classList.add('hidden');
    document.getElementById('toolbar').style.display = 'flex';
    targetHostId = null;
    initializePeer();
}

function joinRoomInput() {
    const code = document.getElementById('room-code-input').value.trim();
    if (!code) return alert("請輸入房間代碼");
    const nameInput = document.getElementById('nickname-input').value.trim();
    myNickname = nameInput || generateNickname();
    targetHostId = code;
    document.getElementById('landing-modal').classList.add('hidden');
    document.getElementById('toolbar').style.display = 'flex';
    const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?id=' + targetHostId;
    window.history.pushState({path:newUrl},'',newUrl);
    initializePeer();
}

function connectToHost(hostId) {
    setOverlay(true, "正在連線到: " + hostId);
    if (conn) {
        conn.off('close');
        conn.close();
    }
    pendingAcks.forEach(t => clearTimeout(t));
    pendingAcks.clear();
    conn = peer.connect(hostId);
    conn.on('open', () => {
        failedCandidates.clear();
        setOverlay(false);
        lastHeartbeat = Date.now();
        conn.send({ type: 'REQUEST_INIT' });
        conn.send({ type: 'HELLO', nickname: myNickname });
        updateStatus(); // 更新連線狀態圖示
    });
    conn.on('data', (data) => handleDataReceived(data, conn));
    conn.on('close', () => {
        setOverlay(true, "❌ 連線中斷");
        handleHostDisconnect();
        updateStatus(); // 更新連線狀態圖示
    });
}

function handleHostDisconnect() {
    if (conn && conn.open && conn.peer === targetHostId) return;
    if (isHost && !isTempHost) return;
    console.log("Host disconnected. Finding backup...");
    setOverlay(true, "連線中斷，正在尋找備用房主...");
    
    if (conn && conn.peer !== targetHostId) {
        failedCandidates.add(conn.peer);
    }

    const candidates = knownPeers.filter(p => p !== targetHostId && p !== myPeerId && !failedCandidates.has(p)).sort();
    if (candidates.length === 0 || myPeerId < candidates[0]) {
        console.log("Becoming Temp Host");
        isTempHost = true;
        isHost = true;
        pendingAcks.forEach(t => clearTimeout(t));
        pendingAcks.clear();
        setOverlay(false);
        updateStatus();
        connections.forEach(c => {
            if (c.open) {
                c.send({ type: 'CANVAS_UPDATE', content: JSON.stringify(canvas.toJSON(['isPdfBackground', 'uid', 'pdfPage'])), timestamp: lastModified, settings: roomSettings });
            }
        });
        broadcastPeerList();
    } else {
        console.log("Connecting to Backup:", candidates[0]);
        connectToHost(candidates[0]);
    }
}

function startReconnectLoop() {
    if (reconnectInterval) clearInterval(reconnectInterval);
    reconnectInterval = setInterval(() => {
        if (conn && conn.peer === targetHostId && conn.open) return;
        const rConn = peer.connect(targetHostId);
        rConn.on('open', () => {
            console.log("Original Host is back!");
            lastHeartbeat = Date.now();
            if (isTempHost) {
                rConn.send({ type: 'CANVAS_UPDATE', content: JSON.stringify(canvas.toJSON(['isPdfBackground', 'uid', 'pdfPage'])), timestamp: lastModified, settings: roomSettings });
                isTempHost = false;
                isHost = false;
                connections.forEach(c => c.close());
                connections = [];
            }
            const oldConn = conn;
            conn = rConn; 
            if (oldConn) oldConn.close();
            pendingAcks.forEach(t => clearTimeout(t));
            pendingAcks.clear();
            isSyncing = false;
            setOverlay(false);
            updateStatus();
            conn.on('data', (data) => handleDataReceived(data, conn));
            conn.on('close', () => {
                setOverlay(true, "❌ 連線中斷");
                handleHostDisconnect();
            });
            conn.send({ type: 'REQUEST_INIT' });
            conn.send({ type: 'HELLO', nickname: myNickname });
        });
    }, 5000);
}

function broadcast(data, excludeConn = null) {
    if (isHost) {
        connections.forEach(c => {
            if (c !== excludeConn && c.open) {
                c.send(data);
            }
        });
    } else if (conn && conn.open) {
        conn.send(data);
    } else if (conn && !conn.open) {
        console.warn("無法發送數據：連線未開啟");
        setOverlay(true, "⚠️ 連線中斷，正在嘗試恢復...");
        conn.close();
    }
}

function handleDataReceived(data, senderConn) {
    if (data.type === 'HEARTBEAT') {
        lastHeartbeat = Date.now();
        return;
    }
    if (data.type === 'HELLO') {
        nicknames[senderConn.peer] = data.nickname;
        if (isHost) broadcastPeerList();
    }
    if (data.type === 'UPDATE_ACK') {
        if (pendingAcks.has(data.msgId)) {
            clearTimeout(pendingAcks.get(data.msgId));
            pendingAcks.delete(data.msgId);
        }
        return;
    }
    if (data.type === 'CHAT') {
        const senderName = data.nickname || "Unknown";
        appendChatMessage(senderName, data.message, false);
        let displayMsg = data.message;
        if (displayMsg.length > 15) displayMsg = displayMsg.substring(0, 15) + '...';
        showToast(`💬 ${senderName}: ${displayMsg}`, 'chat');
        if (isHost) broadcast(data, senderConn);
        const panel = document.getElementById('side-panel');
        if (panel.classList.contains('hidden') || activeTab !== 'chat') {
            document.getElementById('btn-chat').classList.add('has-unread');
            if (!panel.classList.contains('hidden')) document.getElementById('tab-chat').classList.add('has-unread');
        }
    }
    if (data.type === 'RAISE_HAND') {
        raisedHands.add(data.peerId);
        const name = data.nickname || nicknames[data.peerId] || "某人";
        nicknames[data.peerId] = name;
        showToast(`✋ ${name} 舉手了！`);
        renderUserList();
        if (isHost) broadcast(data, senderConn);
    }
    if (data.type === 'LOWER_HAND') {
        if (data.peerId === 'ALL') {
            raisedHands.clear();
            showToast(`房主放下了所有人的手`);
        } else {
            raisedHands.delete(data.peerId);
        }
        renderUserList();
        if (isHost) broadcast(data, senderConn);
    }
    if (data.type === 'ROOM_SETTINGS_UPDATE') {
        roomSettings = data.settings;
        applyRoomSettings();
        if (isHost) broadcast(data, senderConn);
    }
    if (data.type === 'YOUTUBE_START') {
        initYoutubePlayer(data.videoId);
    }
    if (data.type === 'YOUTUBE_SYNC') {
        if (ytPlayer && typeof ytPlayer.seekTo === 'function') {
            const diff = Math.abs(ytPlayer.getCurrentTime() - data.time);
            // 如果時間差超過 1 秒才進行跳轉，避免微小誤差造成卡頓
            if (diff > 1) {
                ytPlayer.seekTo(data.time, true);
            }
            if (data.action === 'play') {
                ytPlayer.playVideo();
                // 強制觸發：當發生跳轉 (seek) 時，播放器可能會進入緩衝或暫停，導致 playVideo 被吞掉
                // 使用多階段延遲 (200ms, 800ms) 確保播放指令被執行
                if (diff > 1 || (typeof ytPlayer.getPlayerState === 'function' && ytPlayer.getPlayerState() !== 1)) {
                    [200, 800].forEach(delay => {
                        setTimeout(() => {
                            if (ytPlayer && typeof ytPlayer.playVideo === 'function') ytPlayer.playVideo();
                        }, delay);
                    });
                }
            }
            else if (data.action === 'pause') ytPlayer.pauseVideo();
        }
    }
    if (data.type === 'YOUTUBE_CLOSE') {
        closeYoutubeLocal();
    }
    if (data.type === 'PDF_PAGE_DATA') {
        // 接收房主傳來的 PDF 頁面影像
        if (pdfImages.length !== data.totalPages) {
            pdfImages = new Array(data.totalPages).fill(null);
        }
        pdfImages[data.pageIndex] = data.image;
        hostPdfPage = data.pageIndex;
        
        // 強制同步到最新頁面 (房主切換時，訪客強制跟隨)
        isPrivateView = false;
        document.getElementById('btn-return-live').style.display = 'none';
        
        // 更新頁面指示器與按鈕
        document.getElementById('pdf-page-indicator').innerText = `${data.pageIndex + 1} / ${data.totalPages}`;
        document.getElementById('pdf-controls').style.display = 'flex';
        
        changePdfPage(data.pageIndex, true, true);
    }
    
    
    // --- 增量更新處理 ---
    if (data.type === 'CANVAS_OP') {
        // 檢查操作的目標頁面
        const opPage = (data.pdfPage !== undefined) ? data.pdfPage : -1;
        
        // 如果操作屬於當前頁面，直接應用到畫布
        if (opPage === currentPdfPage) {
            if (isPrivateView) return; // 預覽模式下忽略更新，避免畫面錯亂
            isSyncing = true; // 鎖定，避免套用更新時觸發本地事件
            
            if (data.action === 'add') {
                fabric.util.enlivenObjects([JSON.parse(data.content)], (objs) => {
                    objs.forEach(o => {
                        o.pdfPage = opPage; // 確保屬性存在
                        canvas.add(o);
                    });
                    canvas.requestRenderAll();
                });
            } 
            else if (data.action === 'modify') {
                const obj = canvas.getObjects().find(o => o.uid === data.uid);
                if (obj) {
                    const props = JSON.parse(data.content);
                    obj.set(props);
                    obj.setCoords(); // 更新座標感應區
                    canvas.requestRenderAll();
                }
            } 
            else if (data.action === 'remove') {
                const obj = canvas.getObjects().find(o => o.uid === data.uid);
                if (obj) {
                    canvas.remove(obj);
                    canvas.requestRenderAll();
                }
            }
            isSyncing = false;
        } 
        // 如果操作屬於其他頁面，更新背景狀態 (pdfCanvasStates)
        else if (opPage >= 0 && pdfCanvasStates[opPage]) {
            try {
                const state = JSON.parse(pdfCanvasStates[opPage]);
                if (!state.objects) state.objects = [];
                
                if (data.action === 'add') {
                    const newObj = JSON.parse(data.content);
                    newObj.pdfPage = opPage;
                    state.objects.push(newObj);
                } else if (data.action === 'modify') {
                    const idx = state.objects.findIndex(o => o.uid === data.uid);
                    if (idx !== -1) state.objects[idx] = JSON.parse(data.content);
                } else if (data.action === 'remove') {
                    state.objects = state.objects.filter(o => o.uid !== data.uid);
                }
                pdfCanvasStates[opPage] = JSON.stringify(state);
            } catch (e) { console.error("Background update failed:", e); }
        }
        
        if (isHost) {
            // 房主轉發給其他人
            broadcast(data, senderConn);
        }
    }
    else if (data.type === 'CANVAS_UPDATE') {
        if (isPrivateView) return; // 預覽模式下忽略全量更新
        if (data.timestamp && data.timestamp < lastModified - 2000) {
            console.log("收到舊數據，忽略並回傳本地新版");
            senderConn.send({
                type: 'CANVAS_UPDATE',
                content: JSON.stringify(canvas.toJSON(['isPdfBackground', 'uid', 'pdfPage'])),
                timestamp: lastModified,
                msgId: Date.now() + '-rev-' + Math.random().toString(36).substr(2, 9)
            });
            return;
        }

        // 防護機制：若房主當前有 PDF 背景，但收到的更新中沒有 PDF 背景 (且非 CLEAR 指令)，則忽略該更新
        // 這防止訪客端因載入延遲或錯誤而回傳空的狀態覆蓋房主
        if (isHost) {
            const currentBg = canvas.getObjects().find(o => o.isPdfBackground);
            if (currentBg) {
                try {
                    const incomingJson = JSON.parse(data.content);
                    const incomingHasPdf = incomingJson.objects && incomingJson.objects.some(o => o.isPdfBackground);
                    
                    if (!incomingHasPdf) {
                        console.warn("防護機制：收到異常更新 (PDF 背景遺失)，忽略並回傳本地狀態");
                        senderConn.send({
                            type: 'CANVAS_UPDATE',
                            content: JSON.stringify(canvas.toJSON(['isPdfBackground', 'uid', 'pdfPage'])),
                            timestamp: lastModified,
                            msgId: Date.now() + '-protect-' + Math.random().toString(36).substr(2, 9)
                        });
                        return;
                    }
                } catch (e) {
                    console.error("JSON Parse Error:", e);
                }
            }
        }

        if (data.timestamp) lastModified = data.timestamp;
        if (data.settings) {
            roomSettings = data.settings;
            applyRoomSettings();
        }
        isSyncing = true;
        if (isHost && data.msgId) {
            senderConn.send({ type: 'UPDATE_ACK', msgId: data.msgId });
        }
        canvas.loadFromJSON(data.content, () => {
            canvas.renderAll();
            const bg = canvas.getObjects().find(o => o.isPdfBackground);
            if (bg) {
                bg.set({ 
                    selectable: false, evented: false,
                    lockMovementX: true, lockMovementY: true,
                    lockRotation: true, lockScalingX: true, lockScalingY: true
                });
                document.getElementById('pdf-controls').style.display = 'flex';
                document.querySelectorAll('#pdf-controls .host-only').forEach(el => {
                    el.style.display = isHost ? 'inline-block' : 'none';
                });
                
                // 嘗試根據背景圖同步頁碼 (若 PDF_PAGE_SYNC 尚未到達)
                // 注意：由於 Lazy Loading，pdfImages 可能包含 null，這裡僅作已渲染頁面的比對
                const currentSrc = bg.getSrc();
                const pageIdx = pdfImages.indexOf(currentSrc);
                if (pageIdx !== -1 && pageIdx !== currentPdfPage) {
                    currentPdfPage = pageIdx;
                    hostPdfPage = pageIdx; // 假設全量更新來自房主當前頁面
                    document.getElementById('pdf-page-indicator').innerText = `${currentPdfPage + 1} / ${pdfImages.length}`;
                    if (typeof updatePdfButtons === 'function') updatePdfButtons();
                }

                if (currentSrc !== lastPdfSrc) {
                    fitPdfToWindow(bg);
                    lastPdfSrc = currentSrc;
                }
            } else {
                document.getElementById('pdf-controls').style.display = 'none';
                lastPdfSrc = null;
            }
            applyRoomSettings();
            isSyncing = false; 
            if (isHost) {
                localStorage.setItem('unbound_board_state', data.content);
                localStorage.setItem('unbound_last_modified', lastModified);
                setOverlay(false);
            }
        });
        if (isHost) broadcast(data, senderConn);
    }
    else if (data.type === 'PEER_LIST') {
        knownPeers = data.peers;
        if (data.raisedHands) raisedHands = new Set(data.raisedHands);
        if (data.nicknames) nicknames = data.nicknames;
        renderUserList();
    }
    else if (data.type === 'REQUEST_INIT') {
        if (isHost) {
            senderConn.send({
                type: 'CANVAS_UPDATE',
                content: JSON.stringify(canvas.toJSON(['isPdfBackground', 'uid', 'pdfPage'])),
                timestamp: lastModified,
                settings: roomSettings
            });
            // 若當前在 PDF 模式，發送當前頁面的影像給新訪客
            if (currentPdfPage >= 0 && pdfImages[currentPdfPage]) {
                senderConn.send({ 
                    type: 'PDF_PAGE_DATA', 
                    pageIndex: currentPdfPage,
                    totalPages: pdfImages.length,
                    image: pdfImages[currentPdfPage]
                });
            }
            if (isHost && isYoutubeActive && currentYoutubeId) {
                senderConn.send({ type: 'YOUTUBE_START', videoId: currentYoutubeId });
                setTimeout(() => syncYoutubeToPeer(senderConn), 2000);
            }
            broadcastPeerList();
        }
    }
    else if (data.type === 'CLEAR') {
        isSyncing = true;
        canvas.clear();
        // 使用 drawing.js 提供的重置函式，確保狀態一致 (A4 + 灰點背景)
        if (typeof window.resetToA4 === 'function') {
            window.resetToA4();
        } else {
            canvas.backgroundColor = "#f8f9fa";
            canvas.setZoom(1);
            canvas.viewportTransform = [1, 0, 0, 1, 0, 0];
        }
        if (isHost) localStorage.removeItem('unbound_board_state');
        if (isHost) localStorage.removeItem('unbound_last_modified');
        if (isHost) broadcast(data, senderConn);
        isSyncing = false;
    }
    else if (data.type === 'CLEAR_PAGE') {
        isSyncing = true;
        const objects = canvas.getObjects();
        for (let i = objects.length - 1; i >= 0; i--) {
            if (!objects[i].isPdfBackground) {
                canvas.remove(objects[i]);
            }
        }
        canvas.requestRenderAll();
        isSyncing = false;
    }
    else if (data.type === 'KICK') {
        alert("您已被房主踢出房間。");
        window.location.href = window.location.pathname;
        return;
    }
    else if (data.type === 'HOST_CHANGED') {
        console.log("Host changed to:", data.newHostId);
        targetHostId = data.newHostId;
        const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?id=' + targetHostId;
        window.history.pushState({path:newUrl},'',newUrl);
        if (myPeerId === targetHostId) {
            isHost = true;
            localStorage.setItem('unbound_host_id', myPeerId);
            updateStatus();
        } else {
            connectToHost(targetHostId);
        }
    }
}

function broadcastPeerList() {
    const list = connections.map(c => c.peer);
    list.push(myPeerId);
    knownPeers = list;
    broadcast({ type: 'PEER_LIST', peers: list, nicknames: nicknames, raisedHands: Array.from(raisedHands) });
    renderUserList();
}

function updateStatus() {
    updateUserIcon();
    renderUserList();
    applyRoomSettings();
}

function updateUserIcon() {
    const indicator = document.getElementById('user-status-indicator');
    if (!indicator) return;
    
    indicator.innerHTML = '';
    
    if (isHost) {
        // 房主邏輯：區分正式房主與臨時房主
        // 正式房主：金黃色皇冠 (#ffc107)
        // 臨時房主：橘紅色皇冠 (#fd7e14)
        const color = isTempHost ? '#fd7e14' : '#ffc107';
        indicator.innerHTML = `<i data-lucide="crown" style="width: 14px; height: 14px; fill: ${color}; color: ${color}; stroke-width: 2px;"></i>`;
    } else {
        // 訪客邏輯：根據連線狀態顯示燈號
        if (conn && conn.open) {
            // 正常連線：綠色小點
            indicator.innerHTML = `<div style="width: 10px; height: 10px; background: #28a745; border-radius: 50%; border: 2px solid white;"></div>`;
        } else if (reconnectInterval || (conn && !conn.open)) {
            // 重連中/警告：黃色驚嘆號 (加上閃爍動畫)
            indicator.innerHTML = `<i data-lucide="alert-circle" class="blink" style="width: 16px; height: 16px; fill: #ffc107; color: white; stroke-width: 2px;"></i>`;
        } else {
            // 斷線/錯誤：紅色小點
            indicator.innerHTML = `<div style="width: 10px; height: 10px; background: #dc3545; border-radius: 50%; border: 2px solid white;"></div>`;
        }
    }
    lucide.createIcons({ root: indicator });
}

// 增量更新發送函式
window.sendObjectUpdate = (action, obj) => {
    if (isSyncing) return;
    
    // 序列化物件 (包含 uid)
    const content = action === 'remove' ? null : JSON.stringify(obj.toJSON(['isPdfBackground', 'uid', 'pdfPage']));
    
    const payload = { 
        type: 'CANVAS_OP', 
        action: action, 
        uid: obj.uid, 
        pdfPage: obj.pdfPage, // 傳送頁碼
        content: content 
    };
    
    broadcast(payload);
};

// 全量更新 (保留給 PDF 切換頁面或初始化使用)
window.sendFullSync = () => {
    if (isSyncing) return;
    
    // 這裡可以保留 Debounce 機制，因為全量更新較重
    if (updateTimer) clearTimeout(updateTimer);

    updateTimer = setTimeout(() => {
        const json = JSON.stringify(canvas.toJSON(['isPdfBackground', 'uid', 'pdfPage']));
        lastModified = Date.now();
        if (isHost) localStorage.setItem('unbound_board_state', json);
        if (isHost) localStorage.setItem('unbound_last_modified', lastModified);
        
        const payload = { type: 'CANVAS_UPDATE', content: json, timestamp: lastModified };
        
        if (!isHost) {
            const msgId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            payload.msgId = msgId;
            let timeoutDuration = 600 + (json.length / 500);
            if (typeof arg === 'number') {
                timeoutDuration = Math.max(timeoutDuration, arg);
            }
            const timeout = setTimeout(() => {
                if (pendingAcks.has(msgId)) {
                    console.warn("同步逾時，房主無回應:", msgId);
                    setOverlay(true, "⚠️ 同步失敗，正在重連...");
                    if (conn) conn.close();
                    pendingAcks.delete(msgId);
                }
            }, timeoutDuration); 
            pendingAcks.set(msgId, timeout);
        }
        broadcast(payload);
    }, 50); // 50ms 延遲，足夠讓 UI 響應，又不影響同步體感
};

function renderUserList() {
    const container = document.getElementById('user-list-content');
    container.innerHTML = '';
    const btnHand = document.getElementById('btn-hand');
    
    if (raisedHands.has(myPeerId)) {
        // if (btnHandText) btnHandText.innerText = "放下"; // 已改為純 Icon
        btnHand.classList.add('active');
    } else {
        // if (btnHandText) btnHandText.innerText = "舉手"; // 已改為純 Icon
        btnHand.classList.remove('active');
    }
    if (raisedHands.size > 0) {
        btnHand.classList.add('has-unread');
    } else {
        btnHand.classList.remove('has-unread');
    }
    if (isHost && raisedHands.size > 0) {
        const lowerAllBtn = document.createElement('button');
        lowerAllBtn.innerHTML = `<i data-lucide="hand"></i> <span>全部放下</span>`;
        lowerAllBtn.className = "secondary-btn";
        lowerAllBtn.style.margin = "10px";
        lowerAllBtn.style.width = "calc(100% - 20px)";
        lowerAllBtn.style.padding = "5px";
        lowerAllBtn.onclick = () => lowerHand('ALL');
        container.appendChild(lowerAllBtn);
    }
    let allPeers = [...knownPeers];
    if (!allPeers.includes(myPeerId)) allPeers.push(myPeerId);
    allPeers.sort((a, b) => {
        if (a === targetHostId) return -1;
        if (b === targetHostId) return 1;
        if (a === myPeerId) return -1;
        return 0;
    });

    // 更新右上角人數徽章
    const badge = document.getElementById('user-count-badge');
    if (badge) badge.innerText = allPeers.length;

    allPeers.forEach(pid => {
        const div = document.createElement('div');
        div.className = 'user-item';
        const displayName = (nicknames[pid] && nicknames[pid].trim()) ? nicknames[pid] : pid.substr(0, 8);
        let html = `<span>${displayName}`;
        if (pid === targetHostId) html += `<span class="tag tag-host">房主</span>`;
        if (pid === myPeerId) html += `<span class="tag tag-me">我</span>`;
        if (raisedHands.has(pid)) html += ` <i data-lucide="hand" style="width:16px;height:16px;color:#ffc107;vertical-align:middle;"></i>`;
        html += `</span>`;
        html += `<div style="display:flex; gap:5px;">`;
        if (isHost && raisedHands.has(pid)) {
            html += `<button onclick="lowerHand('${pid}')" style="font-size:0.8em; padding:2px 5px;">放下</button>`;
        }
        if (isHost && pid !== myPeerId) {
            html += `<button onclick="transferHost('${pid}')" style="font-size:0.8em; padding:2px 5px;" title="轉移房主"><i data-lucide="crown" style="width:14px;height:14px;"></i></button>`;
            html += `<button onclick="kickMember('${pid}')" style="font-size:0.8em; padding:2px 5px; margin-left: 5px; background-color: #dc3545; color: white; border: none; border-radius: 3px;" title="踢出"><i data-lucide="ban" style="width:14px;height:14px;"></i></button>`;
        }
        html += `</div>`;
        div.innerHTML = html;
        container.appendChild(div);
    });
    lucide.createIcons({ root: container });
}

function transferHost(newHostId) {
    if (!confirm("確定要將房主權限轉移給這位使用者嗎？")) return;
    broadcast({ type: 'HOST_CHANGED', newHostId: newHostId });
    isHost = false;
    targetHostId = newHostId;
    localStorage.removeItem('unbound_host_id');
    const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?id=' + targetHostId;
    window.history.pushState({path:newUrl},'',newUrl);
    connectToHost(targetHostId);
}

function kickMember(targetId) {
    if (!confirm("確定要踢出這位成員嗎？")) return;
    const connToKick = connections.find(c => c.peer === targetId);
    if (connToKick) {
        connToKick.send({ type: 'KICK' });
        setTimeout(() => connToKick.close(), 500);
    }
}

function toggleHand() {
    if (!isHost && !roomSettings.allowRaiseHand) return alert("房主已關閉舉手功能");
    if (raisedHands.has(myPeerId)) {
        const data = { type: 'LOWER_HAND', peerId: myPeerId };
        handleDataReceived(data, null);
        broadcast(data);
    } else {
        const data = { type: 'RAISE_HAND', peerId: myPeerId, nickname: myNickname };
        handleDataReceived(data, null);
        broadcast(data);
    }
}

function lowerHand(targetId) {
    const data = { type: 'LOWER_HAND', peerId: targetId };
    handleDataReceived(data, null);
    broadcast(data);
}

function toggleSidePanel(tab) {
    const panel = document.getElementById('side-panel');
    if (panel.classList.contains('hidden')) {
        panel.classList.remove('hidden');
        switchTab(tab);
    } else {
        if (activeTab === tab) {
            panel.classList.add('hidden');
        } else {
            switchTab(tab);
        }
    }
}

function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById('panel-' + tab).classList.add('active');
    if (tab === 'chat') {
        document.getElementById('btn-chat').classList.remove('has-unread');
        document.getElementById('tab-chat').classList.remove('has-unread');
        setTimeout(() => document.getElementById('chat-input').focus(), 100);
    }
}

function sendChatMessage() {
    if (!isHost && !roomSettings.allowChat) return alert("房主已關閉聊天功能");
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message) return;
    const data = {
        type: 'CHAT',
        message: message,
        senderId: myPeerId,
        nickname: myNickname,
        timestamp: Date.now()
    };
    appendChatMessage(myNickname, message, true);
    broadcast(data);
    input.value = '';
}

function appendChatMessage(senderName, message, isSelf) {
    const history = document.getElementById('chat-history');
    const div = document.createElement('div');
    div.className = isSelf ? 'chat-msg self' : 'chat-msg other';
    const nameSpan = document.createElement('div');
    nameSpan.className = 'chat-name';
    nameSpan.innerText = senderName;
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.innerText = message;
    div.appendChild(nameSpan);
    div.appendChild(bubble);
    history.appendChild(div);
    history.scrollTop = history.scrollHeight;
}

document.getElementById('chat-input').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
        sendChatMessage();
    }
});

function toggleSettings() {
    const modal = document.getElementById('settings-modal');
    modal.classList.toggle('hidden');
    document.getElementById('setting-hand').checked = roomSettings.allowRaiseHand;
    document.getElementById('setting-chat').checked = roomSettings.allowChat;
    document.getElementById('setting-edit').checked = roomSettings.allowEditing;
}

function updateSettings() {
    if (!isHost) return;
    roomSettings.allowRaiseHand = document.getElementById('setting-hand').checked;
    roomSettings.allowChat = document.getElementById('setting-chat').checked;
    roomSettings.allowEditing = document.getElementById('setting-edit').checked;
    broadcast({ type: 'ROOM_SETTINGS_UPDATE', settings: roomSettings });
    applyRoomSettings();
}

function applyRoomSettings() {
    const btnSettings = document.getElementById('btn-settings');
    if (isHost) {
        btnSettings.style.display = 'inline-block';
    } else {
        btnSettings.style.display = 'none';
        document.getElementById('settings-modal').classList.add('hidden');
    }

    // 限制 PDF 與 YouTube 工具僅供房主使用
    const hostOnlyTools = ['btn-pdf', 'btn-youtube', 'btn-clear'];
    hostOnlyTools.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = isHost ? '' : 'none';
    });

    const canEdit = isHost || (roomSettings.allowEditing && !isPrivateView);
    const canChat = isHost || roomSettings.allowChat;
    const canHand = isHost || roomSettings.allowRaiseHand;
    const editBtns = ['btn-pencil', 'btn-eraser', 'btn-select', 'btn-note', 'btn-img'];
    editBtns.forEach(id => {
        const btn = document.getElementById(id);
        if(btn) btn.disabled = !canEdit;
    });
    if (!canEdit) {
        canvas.isDrawingMode = false;
        canvas.selection = false;
        canvas.defaultCursor = 'default';
        canvas.hoverCursor = 'default';
        canvas.forEachObject(o => {
            o.selectable = false;
            o.evented = false;
        });
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        document.getElementById('btn-pencil').classList.remove('active');
        const btnEraser = document.getElementById('btn-eraser');
        if (btnEraser) btnEraser.classList.remove('active');
        document.getElementById('btn-select').classList.remove('active');
    } else {
        canvas.hoverCursor = 'move';
    }
    document.getElementById('btn-chat-send').disabled = !canChat;
    document.getElementById('btn-hand').disabled = !canHand;
}

// --- YouTube 同步功能 ---

window.startYoutubePrompt = function() {
    if (!isHost) return alert("只有房主可以開啟 YouTube 同步播放");
    const url = prompt("請輸入 YouTube 影片網址或 ID：");
    if (!url) return;
    
    let videoId = '';
    if (url.length === 11) {
        videoId = url;
    } else {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
        const match = url.match(regExp);
        if (match && match[2].length === 11) {
            videoId = match[2];
        } else {
            return alert("無效的 YouTube 網址");
        }
    }
    
    initYoutubePlayer(videoId);
    broadcast({ type: 'YOUTUBE_START', videoId: videoId });
};

window.initYoutubePlayer = function(videoId) {
    isYoutubeActive = true;
    currentYoutubeId = videoId;
    document.getElementById('youtube-wrapper').classList.remove('hidden');
    
    // 訪客顯示遮罩，防止自行操作
    if (!isHost) {
        document.getElementById('yt-blocker').style.display = 'block';
        document.getElementById('btn-close-yt').style.display = 'none'; 
        document.getElementById('guest-yt-controls').style.display = 'flex';
        document.getElementById('btn-guest-play').style.display = 'block';
    } else {
        document.getElementById('yt-blocker').style.display = 'none';
        document.getElementById('btn-close-yt').style.display = 'block';
        document.getElementById('guest-yt-controls').style.display = 'none';
    }

    if (ytPlayer && typeof ytPlayer.loadVideoById === 'function') {
        ytPlayer.loadVideoById(videoId);
    } else {
        // 若 ytPlayer 狀態異常（存在但無方法），先進行清理
        if (ytPlayer) {
            try { if (typeof ytPlayer.destroy === 'function') ytPlayer.destroy(); } catch(e) {}
            ytPlayer = null;
        }

        // 確保 DOM 容器重置為 div (避免 iframe 殘留導致 API 初始化失敗)
        const wrapper = document.getElementById('youtube-wrapper');
        if (!document.getElementById('yt-player')) {
            const newDiv = document.createElement('div');
            newDiv.id = 'yt-player';
            const oldIframe = wrapper.querySelector('iframe');
            if (oldIframe) wrapper.replaceChild(newDiv, oldIframe);
            else wrapper.insertBefore(newDiv, wrapper.firstChild);
        }

        if (typeof YT === 'undefined' || typeof YT.Player === 'undefined') {
            setTimeout(() => initYoutubePlayer(videoId), 500);
            return;
        }

        ytPlayer = new YT.Player('yt-player', {
            height: '100%',
            width: '100%',
            videoId: videoId,
            playerVars: { 'autoplay': 1, 'controls': 1 },
            events: {
                'onStateChange': onPlayerStateChange
            }
        });
    }
};

function onPlayerStateChange(event) {
    if (!isHost) {
        if (event.data === YT.PlayerState.PLAYING) {
            document.getElementById('btn-guest-play').style.display = 'none';
        }
        return;
    }
    
    const time = ytPlayer.getCurrentTime();
    if (event.data === YT.PlayerState.PLAYING) {
        broadcast({ type: 'YOUTUBE_SYNC', action: 'play', time: time });
    } else if (event.data === YT.PlayerState.PAUSED) {
        broadcast({ type: 'YOUTUBE_SYNC', action: 'pause', time: time });
    }
}

function syncYoutubeToPeer(conn) {
    if (!ytPlayer || !isHost || typeof ytPlayer.getPlayerState !== 'function') return;
    const state = ytPlayer.getPlayerState();
    const time = ytPlayer.getCurrentTime();
    const action = (state === YT.PlayerState.PLAYING) ? 'play' : 'pause';
    conn.send({ type: 'YOUTUBE_SYNC', action: action, time: time });
}

window.ytGuestPlay = function() {
    if (ytPlayer && typeof ytPlayer.playVideo === 'function') {
        ytPlayer.playVideo();
        document.getElementById('btn-guest-play').style.display = 'none';
    }
};

window.ytToggleMute = function() {
    if (ytPlayer && typeof ytPlayer.isMuted === 'function') {
        if (ytPlayer.isMuted()) ytPlayer.unMute();
        else ytPlayer.mute();
    }
};

window.ytSetVolume = function(val) {
    if (ytPlayer && typeof ytPlayer.setVolume === 'function') {
        ytPlayer.setVolume(val);
    }
};

window.closeYoutube = function() {
    if (isHost) broadcast({ type: 'YOUTUBE_CLOSE' });
    closeYoutubeLocal();
};

function closeYoutubeLocal() {
    isYoutubeActive = false;
    currentYoutubeId = null;
    document.getElementById('youtube-wrapper').classList.add('hidden');
    if (ytPlayer) {
        ytPlayer.stopVideo();
        // 選擇不 destroy，保留實例供下次使用，避免 iframe 重建閃爍
        // ytPlayer.destroy(); 
        // ytPlayer = null;
    }
}

setInterval(() => {
    if (isHost) {
        broadcast({ type: 'HEARTBEAT' });
    } else {
        if (conn && conn.open) {
            if (Date.now() - lastHeartbeat > 5000) {
                console.warn("心跳超時，判定房主斷線");
                setOverlay(true, "⚠️ 連線不穩定，嘗試重連中...");
                conn.close();
            }
        }
    }
}, 2000);

if (targetHostId) {
    myNickname = generateNickname();
    document.getElementById('toolbar').style.display = 'flex';
    initializePeer();
} else {
    document.getElementById('landing-modal').classList.remove('hidden');
    document.getElementById('nickname-input').value = generateNickname();
}
