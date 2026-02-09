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

            document.getElementById('status').innerText = "👑 房主模式 (等待連線)";
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
                c.send({ type: 'CANVAS_UPDATE', content: JSON.stringify(canvas.toJSON(['isPdfBackground', 'uid'])), timestamp: lastModified, settings: roomSettings });
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
    document.getElementById('status').innerText = "正在連線到: " + hostId;
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
        document.getElementById('status').innerText = "✅ 已連線";
        lastHeartbeat = Date.now();
        conn.send({ type: 'REQUEST_INIT' });
        conn.send({ type: 'HELLO', nickname: myNickname });
    });
    conn.on('data', (data) => handleDataReceived(data, conn));
    conn.on('close', () => {
        setOverlay(true, "❌ 連線中斷");
        document.getElementById('status').innerText = "❌ 連線中斷";
        handleHostDisconnect();
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
                c.send({ type: 'CANVAS_UPDATE', content: JSON.stringify(canvas.toJSON(['isPdfBackground', 'uid'])), timestamp: lastModified, settings: roomSettings });
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
                rConn.send({ type: 'CANVAS_UPDATE', content: JSON.stringify(canvas.toJSON(['isPdfBackground', 'uid'])), timestamp: lastModified, settings: roomSettings });
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
                document.getElementById('status').innerText = "❌ 連線中斷";
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
        showToast(`💬 ${senderName}: ${data.message}`, 'chat');
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
    
    // --- 增量更新處理 ---
    if (data.type === 'CANVAS_OP') {
        isSyncing = true; // 鎖定，避免套用更新時觸發本地事件
        
        if (data.action === 'add') {
            fabric.util.enlivenObjects([JSON.parse(data.content)], (objs) => {
                objs.forEach(o => canvas.add(o));
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
        
        if (isHost) {
            // 房主轉發給其他人
            broadcast(data, senderConn);
        }
        isSyncing = false;
    }
    else if (data.type === 'CANVAS_UPDATE') {
        if (data.timestamp && data.timestamp < lastModified - 2000) {
            console.log("收到舊數據，忽略並回傳本地新版");
            senderConn.send({
                type: 'CANVAS_UPDATE',
                content: JSON.stringify(canvas.toJSON(['isPdfBackground', 'uid'])),
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
                            content: JSON.stringify(canvas.toJSON(['isPdfBackground', 'uid'])),
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
                bg.set({ selectable: false, evented: false });
                document.getElementById('pdf-controls').style.display = 'flex';
                document.querySelectorAll('#pdf-controls .host-only').forEach(el => {
                    el.style.display = isHost ? 'inline-block' : 'none';
                });
                const currentSrc = bg.getSrc();
                if (currentSrc !== lastPdfSrc) {
                    fitPdfToWindow(bg);
                    lastPdfSrc = currentSrc;
                }
            } else {
                document.getElementById('pdf-controls').style.display = 'none';
                lastPdfSrc = null;
            }
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
                content: JSON.stringify(canvas.toJSON(['isPdfBackground', 'uid'])),
                timestamp: lastModified,
                settings: roomSettings
            });
            broadcastPeerList();
        }
    }
    else if (data.type === 'CLEAR') {
        isSyncing = true;
        canvas.clear();
        canvas.backgroundColor = "#f8f9fa";
        canvas.setZoom(1);
        canvas.viewportTransform = [1, 0, 0, 1, 0, 0];
        if (isHost) localStorage.removeItem('unbound_board_state');
        if (isHost) localStorage.removeItem('unbound_last_modified');
        if (isHost) broadcast(data, senderConn);
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
    const role = isTempHost ? "⚠️ 臨時房主" : (isHost ? "👑 房主" : "訪客");
    document.getElementById('status').innerText = ` | 線上: ${connections.length + (isHost?0:1)}`;
    renderUserList();
    applyRoomSettings();
}

// 增量更新發送函式
window.sendObjectUpdate = (action, obj) => {
    if (isSyncing) return;
    
    // 序列化物件 (包含 uid)
    const content = action === 'remove' ? null : JSON.stringify(obj.toJSON(['isPdfBackground', 'uid']));
    
    const payload = { 
        type: 'CANVAS_OP', 
        action: action, 
        uid: obj.uid, 
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
        const json = JSON.stringify(canvas.toJSON(['isPdfBackground', 'uid']));
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
        btnHand.innerText = "🙌 放下";
        btnHand.classList.add('active');
    } else {
        btnHand.innerText = "✋ 舉手";
        btnHand.classList.remove('active');
    }
    if (raisedHands.size > 0) {
        btnHand.classList.add('has-unread');
    } else {
        btnHand.classList.remove('has-unread');
    }
    if (isHost && raisedHands.size > 0) {
        const lowerAllBtn = document.createElement('button');
        lowerAllBtn.innerText = "🙌 全部放下";
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
    allPeers.forEach(pid => {
        const div = document.createElement('div');
        div.className = 'user-item';
        const displayName = (nicknames[pid] && nicknames[pid].trim()) ? nicknames[pid] : pid.substr(0, 8);
        let html = `<span>${displayName}`;
        if (pid === targetHostId) html += `<span class="tag tag-host">房主</span>`;
        if (pid === myPeerId) html += `<span class="tag tag-me">我</span>`;
        if (raisedHands.has(pid)) html += ` <span style="font-size:1.2em;">✋</span>`;
        html += `</span>`;
        html += `<div style="display:flex; gap:5px;">`;
        if (isHost && raisedHands.has(pid)) {
            html += `<button onclick="lowerHand('${pid}')" style="font-size:0.8em; padding:2px 5px;">放下</button>`;
        }
        if (isHost && pid !== myPeerId) {
            html += `<button onclick="transferHost('${pid}')" style="font-size:0.8em; padding:2px 5px;">👑 轉移</button>`;
            html += `<button onclick="kickMember('${pid}')" style="font-size:0.8em; padding:2px 5px; margin-left: 5px; background-color: #dc3545; color: white; border: none; border-radius: 3px;">🚫 踢出</button>`;
        }
        html += `</div>`;
        div.innerHTML = html;
        container.appendChild(div);
    });
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
    const canEdit = isHost || roomSettings.allowEditing;
    const canChat = isHost || roomSettings.allowChat;
    const canHand = isHost || roomSettings.allowRaiseHand;
    const editBtns = ['btn-pencil', 'btn-eraser', 'btn-select', 'btn-note', 'btn-img', 'btn-pdf', 'btn-clear'];
    editBtns.forEach(id => {
        const btn = document.getElementById(id);
        if(btn) btn.disabled = !canEdit;
    });
    if (!canEdit) {
        canvas.isDrawingMode = false;
        canvas.selection = false;
        canvas.forEachObject(o => o.selectable = false);
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        document.getElementById('btn-pencil').classList.remove('active');
        document.getElementById('btn-eraser').classList.remove('active');
        document.getElementById('btn-select').classList.remove('active');
    }
    document.getElementById('btn-chat-send').disabled = !canChat;
    document.getElementById('btn-hand').disabled = !canHand;
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
