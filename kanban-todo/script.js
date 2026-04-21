// ==========================================
// Firebase 設定（お客様のキーを組み込み済み）
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyBfe7X9WcpCiTPf6nzJaZRXxGLwQRKALqs",
  authDomain: "factory-kanban.firebaseapp.com",
  projectId: "factory-kanban",
  storageBucket: "factory-kanban.firebasestorage.app",
  messagingSenderId: "7390637548",
  appId: "1:7390637548:web:909d565531d2f1d3d924c9"
};

// State Management
let tasks = [];
let workers = [];
let currentWorkerId = localStorage.getItem('current-worker-id') || 'default';
let currentTargetColumn = 'todo';
let isAutoScaleEnabled = false;
let db = null; // データベース用変数を初期化

// Firebase 初期化
try {
    if (typeof firebase !== 'undefined') {
        firebase.initializeApp(firebaseConfig);
        db = firebase.database();
        console.log("Firebase initialized successfully.");
    } else {
        console.warn("Firebase SDK not found. Running in offline mode.");
    }
} catch (e) {
    console.error("Firebase initialization error:", e);
}

// DOM Elements
let lists = {};
let counts = {};

// ==========================================
// 1. 認証・セキュリティ
// ==========================================
window.onload = function() {
    checkAuth();
};

const APP_PASS = "kita2030";

function checkAuth() {
    const isAuthed = sessionStorage.getItem('is-authenticated');
    if (isAuthed === 'true') {
        document.getElementById('auth-overlay').style.display = 'none';
        document.getElementById('auto-scale-wrapper').style.visibility = 'visible';
        init();
    } else {
        const passInput = document.getElementById('auth-pass');
        if (passInput) {
            passInput.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') handleAuth();
            });
        }
    }
}

window.handleAuth = function() {
    const input = document.getElementById('auth-pass');
    const errorMsg = document.getElementById('auth-error');
    if (input.value === APP_PASS) {
        sessionStorage.setItem('is-authenticated', 'true');
        document.getElementById('auth-overlay').style.display = 'none';
        document.getElementById('auto-scale-wrapper').style.visibility = 'visible';
        init();
    } else {
        errorMsg.style.display = 'block';
        input.value = '';
        input.focus();
    }
};

// ==========================================
// 2. 初期化・同期
// ==========================================
function init() {
    lists = {
        todo: document.getElementById('list-todo'),
        progress: document.getElementById('list-progress'),
        done: document.getElementById('list-done')
    };
    counts = {
        todo: document.getElementById('count-todo'),
        progress: document.getElementById('count-progress'),
        done: document.getElementById('count-done')
    };

    // 最速でローカルデータを画面に反映（更新リロード時のチラつき・非表示を防ぐ）
    let loadedWorkers = JSON.parse(localStorage.getItem('local_workers') || '[{"id":"default","name":"共通・未設定"}]');
    if (loadedWorkers.length === 0) loadedWorkers = [{"id":"default","name":"共通・未設定"}];
    workers = loadedWorkers;
    tasks = JSON.parse(localStorage.getItem('local_tasks') || '[]');
    updateWorkerSelect();
    renderTasks();

    if (db) {
        // 接続監視
        db.ref('.info/connected').on('value', (snapshot) => {
            const isOnline = snapshot.val() === true;
            console.log("Sync Status:", isOnline ? "Online" : "Offline");
            const dot = document.getElementById('sync-dot');
            const text = document.getElementById('sync-text');
            const statusBox = document.getElementById('sync-status');
            if (dot && text && statusBox) {
                dot.style.background = isOnline ? '#2ecc71' : '#ff7675';
                text.innerText = isOnline ? 'CLOUD SYNC' : 'OFFLINE';
                statusBox.style.color = isOnline ? '#27ae60' : '#ff7675';
                statusBox.style.borderColor = isOnline ? '#2ecc71' : '#ff7675';
                statusBox.style.background = isOnline ? '#f0fff4' : '#fff5f5';
            }
        });

        // 作業員同期
        db.ref('workers').on('value', (snapshot) => {
            const data = snapshot.val();
            let cloudWorkers = data ? Object.values(data) : [];
            let localWorkers = JSON.parse(localStorage.getItem('local_workers') || '[]');
            
            // Merge cloud and local workers safely
            const workerMap = {};
            cloudWorkers.forEach(w => workerMap[w.id] = w);
            localWorkers.forEach(w => {
                if (!workerMap[w.id]) workerMap[w.id] = w; // Cloud priority
            });
            
            workers = Object.values(workerMap);
            
            if (workers.length === 0) {
                workers = [{ id: 'default', name: '共通・未設定' }];
            }
            updateWorkerSelect();
            // クラウドから得られた作業員リストを再度ローカルに保存して次回起動を速める
            localStorage.setItem('local_workers', JSON.stringify(workers));
        });

        // タスク同期
        db.ref('tasks').on('value', (snapshot) => {
            const data = snapshot.val();
            let cloudTasks = data ? Object.values(data) : [];
            
            const taskMap = {};
            cloudTasks.forEach(t => taskMap[t.id] = t);
            
            // クラウドにデータがある場合はそれをマスターとする
            if (cloudTasks.length > 0) {
                tasks = Object.values(taskMap);
                localStorage.setItem('local_tasks', JSON.stringify(tasks));
            } else {
                // クラウドが空の場合はローカルから読み込む
                tasks = JSON.parse(localStorage.getItem('local_tasks') || '[]');
            }
            
            checkRecurringTasks(); 
            renderTasks();
            if (isAutoScaleEnabled) autoScale();
        });
        
        syncWorkerLogs();
    } else {
        // オフライン時のフォールバック
        workers = [{ id: 'default', name: '共通・未設定 (オフライン)' }];
        updateWorkerSelect();
        renderTasks();
    }

    setupDragAndDrop();
    window.onresize = autoScale;
    
    if (localStorage.getItem('is-auto-scale') !== 'false') {
        isAutoScaleEnabled = true;
        setTimeout(autoScale, 500);
    }
}

function syncWorkerLogs() {
    renderLogs();
    if (!db) return;
    const logKey = `logs/${currentWorkerId}`;
    db.ref(logKey).on('value', (snapshot) => {
        const cloudHist = snapshot.val();
        if (cloudHist) {
            localStorage.setItem(`local_logs_${currentWorkerId}`, JSON.stringify(cloudHist));
            renderLogs();
        }
    });
}

// ==========================================
// 3. 作業員管理
// ==========================================
window.openWorkerModal = function() {
    document.getElementById('worker-modal-overlay').classList.add('active');
    renderWorkerManageList();
};

window.closeWorkerModal = function() {
    document.getElementById('worker-modal-overlay').classList.remove('active');
};

window.addWorker = function() {
    const nameInput = document.getElementById('new-worker-name');
    const name = nameInput.value.trim();
    
    if (!name) {
        alert('名前を入力してください。');
        return;
    }

    const id = 'w' + Date.now();
    const newWorker = { id, name };

    // 最優先でローカルのUIとStorageを更新（Firebaseの通信保留によるフリーズを回避）
    let localWorkers = JSON.parse(localStorage.getItem('local_workers') || '[]');
    localWorkers.push(newWorker);
    localStorage.setItem('local_workers', JSON.stringify(localWorkers));
    
    workers.push(newWorker);
    updateWorkerSelect();
    nameInput.value = '';
    alert('作業員「' + name + '」を追加しました！');

    // バックグラウンドでクラウドへ同期（失敗・保留でもUIは既に更新済み）
    if (db) {
        db.ref('workers/' + id).set(newWorker).catch(console.warn);
    }
};

window.deleteWorker = function(id) {
    if (workers.length <= 1) {
        alert('最後の作業員は削除できません。');
        return;
    }
    if (confirm('この作業員を削除しますか？')) {
        let localWorkers = JSON.parse(localStorage.getItem('local_workers') || '[]');
        localWorkers = localWorkers.filter(w => w.id !== id);
        localStorage.setItem('local_workers', JSON.stringify(localWorkers));

        workers = workers.filter(w => w.id !== id);
        updateWorkerSelect();

        if (db) {
            db.ref('workers/' + id).remove().catch(console.warn);
        }
    }
};

function renderWorkerManageList() {
    const list = document.getElementById('worker-manage-list');
    if (!list) return;
    list.innerHTML = workers.map(w => `
        <div class="worker-item">
            <span>${escapeHTML(w.name)}</span>
            <button class="btn-del" onclick="deleteWorker('${w.id}')">削除</button>
        </div>
    `).join('');
}

function updateWorkerSelect() {
    const select = document.getElementById('worker-select');
    if (!select) return;
    
    if (!workers.find(w => w.id === currentWorkerId)) {
        currentWorkerId = workers[0] ? workers[0].id : 'default';
        localStorage.setItem('current-worker-id', currentWorkerId);
    }

    select.innerHTML = workers.map(w => `<option value="${w.id}" ${w.id === currentWorkerId ? 'selected' : ''}>${escapeHTML(w.name)}</option>`).join('');
    
    if (document.getElementById('worker-modal-overlay') && document.getElementById('worker-modal-overlay').classList.contains('active')) {
        renderWorkerManageList();
    }
}

window.handleWorkerChange = function() {
    currentWorkerId = document.getElementById('worker-select').value;
    localStorage.setItem('current-worker-id', currentWorkerId);
    if (db) syncWorkerLogs();
    renderTasks();
};

// ==========================================
// 4. タスク・看板操作
// ==========================================
function renderTasks() {
    if (!lists.todo) return;
    Object.keys(lists).forEach(status => {
        lists[status].innerHTML = '';
        const filtered = tasks.filter(t => {
            if (t.status !== status) return false;
            // assignedTo の判定 ('all'の考慮と拒否リストの考慮)
            if (t.assignedTo && Array.isArray(t.assignedTo)) {
                const isRejected = t.rejectedBy && t.rejectedBy.includes(currentWorkerId);
                if (isRejected) return false;
                return t.assignedTo.includes(currentWorkerId) || t.assignedTo.includes('all') || t.requestedBy === currentWorkerId;
            }
            return true;
        });
        // 期限が短いものほど上（先頭）にくるようにソート
        filtered.sort((a, b) => {
            if (!a.deadline && !b.deadline) return a.id.localeCompare(b.id);
            if (a.deadline && !b.deadline) return -1;
            if (!a.deadline && b.deadline) return 1;
            return new Date(a.deadline) - new Date(b.deadline);
        });

        filtered.forEach(task => lists[status].appendChild(createTaskCard(task)));
        counts[status].innerText = filtered.length;
    });
}

function createTaskCard(task) {
    const card = document.createElement('div');
    card.className = `task-card priority-${task.priority || 'low'} ${task.isRecurring ? 'type-recurring' : ''} ${task.isRequest ? 'type-request' : ''}`;
    card.draggable = true;
    card.dataset.id = task.id;
    card.addEventListener('dragstart', handleDragStart);

    let deadlineInfo = '';
    if (task.deadline) {
        let timeStr = '';
        if (task.deadline.includes('T')) {
            const d = new Date(task.deadline);
            timeStr = ` ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        }
        
        const dateParts = task.deadline.split('T')[0].split('-');
        const month = parseInt(dateParts[1], 10);
        const day = parseInt(dateParts[2], 10);

        deadlineInfo = `<div class="task-deadline" style="display:inline-block; margin-top:8px; padding:3px 10px; border-radius:8px; font-size:0.75rem; font-weight:900; background-color:#ffeb3b; color:#d32f2f; border:2px solid #d32f2f; box-shadow: 2px 2px 0px rgba(0,0,0,0.2);">
            ⏰ 期限: ${month}/${day}${timeStr}
        </div>`;
    }

    let requestStamp = '';
    if (task.isRequest) {
        let senderName = '不明';
        if (task.requestedBy) {
            const sender = workers.find(w => w.id === task.requestedBy);
            if (sender) senderName = sender.name;
        }
        requestStamp = `
            <div style="margin-bottom: 5px; display: flex; gap: 5px;">
                <span style="background:var(--accent-green); color:white; padding:2px 6px; border-radius:4px; font-size:0.7rem; font-weight:900;">依頼</span>
                <span style="background:#0984e3; color:white; padding:2px 6px; border-radius:4px; font-size:0.7rem; font-weight:900;">👤 ${escapeHTML(senderName)} から</span>
            </div>
        `;
    }
    
    const archiveBtnHTML = task.status === 'done' ? `<div style="position:absolute; right:15px; top:50%; transform:translateY(-50%); font-size:1.5rem; cursor:pointer;" onclick="archiveTask(event, '${task.id}')" title="履歴に格納">🗑️</div>` : '';

    card.innerHTML = `
        ${requestStamp}
        <div class="task-content">
            <div style="font-weight:900; padding-right:30px;">${escapeHTML(task.title || task.content)}</div>
            ${deadlineInfo}
        </div>
        ${archiveBtnHTML}
    `;
    card.onclick = (e) => {
        openModal(task.status, task.id);
    };
    return card;
}

window.openModal = function(status, taskId = null, isRecurring = false, isRequest = false) {
    currentTargetColumn = status;
    const modal = document.getElementById('modal-overlay');
    const workerArea = document.getElementById('worker-selection-area');
    const rejectBtn = document.getElementById('reject-btn');
    
    resetModal();
    
    if (taskId) {
        const task = tasks.find(t => t.id === taskId);
        if (!task) return;
        document.getElementById('modal-title').innerText = 'タスクを編集';
        document.getElementById('edit-task-id').value = taskId;
        document.getElementById('task-title').value = task.title || task.content || '';
        document.getElementById('task-desc').value = task.description || '';
        document.getElementById('task-priority').value = task.priority || 'low';
        
        if (task.deadline) {
            if (task.deadline.includes('T')) {
                const parts = task.deadline.split('T');
                document.getElementById('task-deadline-date').value = parts[0];
                document.getElementById('task-deadline-time').value = parts[1];
            } else {
                document.getElementById('task-deadline-date').value = task.deadline;
                document.getElementById('task-deadline-time').value = '';
            }
        } else {
            document.getElementById('task-deadline-date').value = '';
            document.getElementById('task-deadline-time').value = '';
        }
        
        document.getElementById('task-recurring').checked = task.isRecurring || false;
        
        if (task.isRequest) {
            if (task.requestedBy === currentWorkerId) {
                // 自分が送信した依頼（宛先などを変更できる）
                rejectBtn.style.display = 'none';
                workerArea.style.display = 'block';
                renderWorkerCheckboxes(task.assignedTo || []);
            } else {
                // 人から受け取った依頼（宛先変更不可、拒否のみ可能）
                rejectBtn.style.display = 'block';
                workerArea.style.display = 'none';
            }
        }
        const delBtn = document.getElementById('modal-delete-btn');
        if (delBtn) delBtn.style.display = 'block';
    } else {
        document.getElementById('modal-title').innerText = isRequest ? '業務依頼を作成' : '新規タスク';
        document.getElementById('task-recurring').checked = isRecurring;
        if (isRequest) {
            workerArea.style.display = 'block';
            renderWorkerCheckboxes([currentWorkerId]);
        }
    }
    modal.classList.add('active');
};

function renderWorkerCheckboxes(selectedIds) {
    const list = document.getElementById('modal-worker-list');
    const allChecked = selectedIds.includes('all') ? 'checked' : '';
    let html = `
        <label style="display:flex; align-items:center; gap:10px; padding:8px 5px; border-bottom:2px solid #ccc; cursor:pointer; background:#fff9e6;">
            <input type="checkbox" value="all" ${allChecked} style="width:18px; height:18px;">
            <span style="font-weight:900; color:#d63031;">全員に依頼する</span>
        </label>
    `;
    html += workers.map(w => `
        <label style="display:flex; align-items:center; gap:10px; padding:5px; border-bottom:1px solid #eee; cursor:pointer;">
            <input type="checkbox" value="${w.id}" ${selectedIds.includes(w.id) ? 'checked' : ''} style="width:18px; height:18px;">
            <span style="font-weight:bold;">${escapeHTML(w.name)}</span>
        </label>
    `).join('');
    list.innerHTML = html;
}

window.saveTask = function() {
    const id = document.getElementById('edit-task-id').value || Date.now().toString();
    const title = document.getElementById('task-title').value;
    if (!title) { alert('タイトルを入力してください。'); return; }
    
    const isRequest = document.getElementById('worker-selection-area').style.display === 'block';
    const selectedWorkers = [];
    if (isRequest) {
        document.querySelectorAll('#modal-worker-list input:checked').forEach(el => selectedWorkers.push(el.value));
    }

    const dateVal = document.getElementById('task-deadline-date').value;
    const timeVal = document.getElementById('task-deadline-time').value;
    const finalDeadline = dateVal ? (timeVal ? `${dateVal}T${timeVal}` : dateVal) : '';

    const newTask = {
        id, title,
        description: document.getElementById('task-desc').value,
        priority: document.getElementById('task-priority').value,
        deadline: finalDeadline,
        status: currentTargetColumn,
        isRecurring: document.getElementById('task-recurring').checked,
        isRequest,
        assignedTo: isRequest ? selectedWorkers : [currentWorkerId],
        requestedBy: isRequest ? currentWorkerId : null,
        requestGroupId: isRequest ? (id + '-group') : null
    };

    // 最優先でローカルを更新（オフライン・保留時対策）
    let localTasks = JSON.parse(localStorage.getItem('local_tasks') || '[]');
    const existingIdx = localTasks.findIndex(t => t.id === id);
    if (existingIdx >= 0) localTasks[existingIdx] = newTask;
    else localTasks.push(newTask);
    localStorage.setItem('local_tasks', JSON.stringify(localTasks));

    const isNew = !document.getElementById('edit-task-id').value;
    const memIdx = tasks.findIndex(t => t.id === id);
    if (memIdx >= 0) tasks[memIdx] = newTask;
    else tasks.push(newTask);
    
    // --- ログ登録（オフライン対応） ---
    if (isRequest && isNew) {
        const timeStr = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        const logText = `依頼作成 ［${title}］`;
        
        // 作業者たちへ通知
        selectedWorkers.forEach(wId => {
            if (wId === 'all') workers.forEach(w => appendLog(w.id, logText, timeStr));
            else appendLog(wId, logText, timeStr);
        });

        // 依頼した自分自身のログにも表示（重複を防ぐため含まれていない場合のみ）
        if (!selectedWorkers.includes(currentWorkerId) && !selectedWorkers.includes('all')) {
            appendLog(currentWorkerId, logText, timeStr);
        }
    }

    renderTasks();
    if (isRequest && isNew) renderLogs();
    closeModal();

    if (db) {
        db.ref('tasks/' + id).set(newTask).catch(console.warn);
    }
};

window.deleteTask = function(id) {
    if (confirm('このタスクを削除しますか？')) {
        let localTasks = JSON.parse(localStorage.getItem('local_tasks') || '[]');
        localTasks = localTasks.filter(t => t.id !== id);
        localStorage.setItem('local_tasks', JSON.stringify(localTasks));
        
        tasks = tasks.filter(t => t.id !== id);
        renderTasks();

        if (db) {
            db.ref('tasks/' + id).remove().catch(console.warn);
        }
    }
};

window.handleModalDelete = function() {
    const id = document.getElementById('edit-task-id').value;
    if (id) {
        deleteTask(id);
        closeModal();
    }
};

window.rejectTask = function() {
    const id = document.getElementById('edit-task-id').value;
    const title = document.getElementById('task-title').value;
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    if (confirm(`この依頼「${title}」を拒否しますか？`)) {
        const timeStr = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        const logText = `依頼拒否 ［${title} by ${currentWorkerId}］`;
        
        // 自分自身（拒否操作をした本人）のログに表示
        appendLog(currentWorkerId, logText, timeStr);
        
        // 依頼元へ通知
        if (task.requestedBy && task.requestedBy !== currentWorkerId) {
            appendLog(task.requestedBy, logText, timeStr);
        }

        // 自分の担当から外す
        task.assignedTo = (task.assignedTo || []).filter(wId => wId !== currentWorkerId);
        if (task.assignedTo.includes('all')) {
            task.assignedTo = task.assignedTo.filter(wId => wId !== 'all');
            // '全員'指定から自分だけを外した状態として、他の既存メンバーを明示的に割当て直す処理などが必要ですが
            // 今回はシンプルに自身の表示から確実に消すため、自身のIDを明示的に除外。
            task.rejectedBy = task.rejectedBy || [];
            task.rejectedBy.push(currentWorkerId);
        }
        
        let localTasks = JSON.parse(localStorage.getItem('local_tasks') || '[]');
        const idx = localTasks.findIndex(t => t.id === id);
        if (idx >= 0) localTasks[idx] = task;
        localStorage.setItem('local_tasks', JSON.stringify(localTasks));

        renderTasks();
        renderLogs();
        closeModal();

        if (db) {
            db.ref('tasks/' + id).set(task).catch(console.warn);
        }
    }
};

window.moveTask = function(id, newStatus) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    
    const oldStatus = task.status;
    task.status = newStatus;

    let localTasks = JSON.parse(localStorage.getItem('local_tasks') || '[]');
    const lTask = localTasks.find(t => t.id === id);
    if (lTask) {
        lTask.status = newStatus;
    } else {
        localTasks.push(task);
    }
    localStorage.setItem('local_tasks', JSON.stringify(localTasks));

    // --- ログ通知の生成 ---
    if (task.isRequest && task.requestedBy && oldStatus !== newStatus) {
        const timeStr = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        const title = task.title || task.content || '';
        let logText = '';
        
        if (newStatus === 'progress' && oldStatus === 'todo') {
            logText = `依頼着手 ［${title} by ${currentWorkerId}］`;
        } else if (newStatus === 'done' && oldStatus !== 'done') {
            logText = `依頼完了 ［${title} by ${currentWorkerId}］`;
        }
        
        if (logText) {
            // 操作した本人のログ
            appendLog(currentWorkerId, logText, timeStr);
            
            // 依頼元へ通知
            if (task.requestedBy && task.requestedBy !== currentWorkerId) {
                appendLog(task.requestedBy, logText, timeStr);
            }
        }
    }

    renderTasks();
    renderLogs(); // 自分がテストしてる時用

    if (db) {
        db.ref('tasks/' + id + '/status').set(newStatus).catch(console.warn);
    }
};

// ==========================================
// 5. ログ・通知
// ==========================================
function appendLog(targetId, text, timeStr) {
    if (!targetId || targetId === 'all') return;
    let locLogs = JSON.parse(localStorage.getItem(`local_logs_${targetId}`) || '[]');
    locLogs.unshift({ time: timeStr, text: text, isRead: false });
    localStorage.setItem(`local_logs_${targetId}`, JSON.stringify(locLogs.slice(0, 50)));

    if (db) {
        db.ref(`logs/${targetId}`).once('value', snap => {
            const hist = snap.val() || JSON.parse(localStorage.getItem(`local_logs_${targetId}`) || '[]');
            if (!hist.find(h => h.time === timeStr && h.text === text)) {
                hist.unshift({ time: timeStr, text: text, isRead: false });
                db.ref(`logs/${targetId}`).set(hist.slice(0, 50)).catch(()=>{});
            }
        }).catch(()=>{});
    }
}

function renderLogs() {
    const history = JSON.parse(localStorage.getItem(`local_logs_${currentWorkerId}`) || '[]');
    const msgList = document.getElementById('msg-list');
    if (!msgList) return;
    const displayHistory = history.slice(0, 6);
    msgList.innerHTML = displayHistory.map(m => `
        <li style="margin-bottom: 2px; color: ${m.isRead ? '#333' : '#ff6b6b'}; display: flex; gap: 8px; align-items: center;">
            <span style="color: ${m.isRead ? '#888' : '#ff6b6b'}; font-family: monospace; font-size: 0.7rem;">[${m.time}]</span>
            <span style="font-weight: 700;">${getLogWithStamp(m.text)}</span>
        </li>
    `).join('');
}

function getLogWithStamp(text) {
    let stamp = '';
    let content = text;
    if (text.startsWith('依頼作成')) {
        stamp = '<span class="log-stamp stamp-create">作成</span>';
        content = text.replace('依頼作成', '').trim();
    } else if (text.startsWith('依頼着手')) {
        stamp = '<span class="log-stamp" style="background:#0984e3; color:white; padding:2px 6px; border-radius:4px; font-size:0.7rem; margin-right:5px; font-weight:900;">着手</span>';
        content = text.replace('依頼着手', '').trim();
    } else if (text.startsWith('依頼完了')) {
        stamp = '<span class="log-stamp stamp-done">完了</span>';
        content = text.replace('依頼完了', '').trim();
    } else if (text.startsWith('依頼拒否')) {
        stamp = '<span class="log-stamp stamp-reject">拒否</span>';
        content = text.replace('依頼拒否', '').trim();
    }
    return `${stamp}${escapeHTML(content)}`;
}

// ==========================================
// 6. オートスケール
// ==========================================
function autoScale() {
    if (!isAutoScaleEnabled) return;
    const wrapper = document.getElementById('auto-scale-wrapper');
    if (!wrapper) return;
    wrapper.style.transform = 'none';
    wrapper.style.width = '1450px'; 
    wrapper.style.left = '50%';
    wrapper.style.position = 'absolute';
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const contentWidth = 1450;
    const contentHeight = wrapper.scrollHeight || 1000;
    const scaleW = (viewportWidth * 0.94) / contentWidth;
    const scaleH = (viewportHeight * 0.92) / contentHeight;
    const finalScale = Math.min(scaleW, scaleH);
    wrapper.style.transformOrigin = 'top center';
    wrapper.style.transform = `translateX(-50%) scale(${finalScale})`;
    document.body.style.overflow = 'hidden';
}

window.toggleAutoScale = function() {
    isAutoScaleEnabled = !isAutoScaleEnabled;
    localStorage.setItem('is-auto-scale', isAutoScaleEnabled);
    const wrapper = document.getElementById('auto-scale-wrapper');
    const btn = document.getElementById('full-view-btn');
    if (isAutoScaleEnabled) {
        autoScale();
        btn.textContent = 'フィット解除';
        btn.style.background = 'white';
    } else {
        wrapper.style.position = 'static';
        wrapper.style.transform = 'none';
        wrapper.style.width = '100%';
        wrapper.style.left = 'auto';
        btn.textContent = 'フィット切替';
        btn.style.background = '#e7f3ff';
        document.body.style.overflow = 'auto';
    }
};

// ==========================================
// 7. その他ヘルパー
// ==========================================
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function resetModal() {
    document.getElementById('edit-task-id').value = '';
    document.getElementById('task-title').value = '';
    document.getElementById('task-desc').value = '';
    document.getElementById('task-priority').value = 'low';
    document.getElementById('task-deadline-date').value = '';
    document.getElementById('task-deadline-time').value = '';
    document.getElementById('task-recurring').checked = false;
    document.getElementById('worker-selection-area').style.display = 'none';
    document.getElementById('reject-btn').style.display = 'none';
    const delBtn = document.getElementById('modal-delete-btn');
    if (delBtn) delBtn.style.display = 'none';
}

window.closeModal = function() {
    document.getElementById('modal-overlay').classList.remove('active');
};

window.openLogHistory = function() {
    const history = JSON.parse(localStorage.getItem(`local_logs_${currentWorkerId}`) || '[]');
    const list = document.getElementById('full-log-list');
    if (list) {
        list.innerHTML = history.map(m => `
            <div style="padding: 10px; border-bottom: 3px solid #eee; display: flex; gap: 15px; align-items: flex-start;">
                <span style="color: #666; font-family: monospace; font-size: 0.9rem; white-space: nowrap;">[${m.time}]</span>
                <span style="font-weight: 900; font-size: 1.1rem; color: #333;">${getLogWithStamp(m.text)}</span>
            </div>
        `).join('');
    }
    const overlay = document.getElementById('log-history-overlay');
    if (overlay) overlay.classList.add('active');
};

window.closeLogHistory = function() {
    const overlay = document.getElementById('log-history-overlay');
    if (overlay) overlay.classList.remove('active');
};

window.archiveTask = function(e, id) {
    if (e) e.stopPropagation();
    if (confirm('このタスクを「過去の履歴」に格納しますか？')) {
        const task = tasks.find(t => t.id === id);
        if (!task) return;
        task.status = 'archived';

        let localTasks = JSON.parse(localStorage.getItem('local_tasks') || '[]');
        const idx = localTasks.findIndex(t => t.id === id);
        if (idx >= 0) localTasks[idx] = task;
        localStorage.setItem('local_tasks', JSON.stringify(localTasks));

        renderTasks();

        if (db) {
            db.ref('tasks/' + id + '/status').set('archived').catch(console.warn);
        }
    }
};

window.toggleHistory = function(show) {
    const overlay = document.getElementById('history-modal-overlay');
    if (!overlay) return;
    
    if (show) {
        const list = document.getElementById('history-list');
        const archivedTasks = tasks.filter(t => {
            if (t.status !== 'archived') return false;
            if (t.assignedTo && Array.isArray(t.assignedTo)) {
                return t.assignedTo.includes(currentWorkerId) || t.assignedTo.includes('all') || t.requestedBy === currentWorkerId;
            }
            return true;
        });
        
        list.innerHTML = archivedTasks.map(t => {
            let requestStamp = '';
            if (t.isRequest) {
                let senderName = '不明';
                if (t.requestedBy) {
                    const sender = workers.find(w => w.id === t.requestedBy);
                    if (sender) senderName = sender.name;
                }
                requestStamp = `
                    <div style="display:flex; gap:5px; margin-bottom:5px;">
                        <span style="background:var(--accent-green); color:white; padding:3px 8px; border-radius:6px; font-size:0.8rem; font-weight:900; vertical-align:middle;">依頼</span>
                        <span style="background:#0984e3; color:white; padding:3px 8px; border-radius:6px; font-size:0.8rem; font-weight:900; vertical-align:middle;">👤 ${escapeHTML(senderName)} から</span>
                    </div>
                `;
            }
            
            let deadlineInfo = '';
            if (t.deadline) {
                let timeStr = '';
                if (t.deadline.includes('T')) {
                    const d = new Date(t.deadline);
                    timeStr = ` ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                }
                const dateParts = t.deadline.split('T')[0].split('-');
                const month = parseInt(dateParts[1], 10);
                const day = parseInt(dateParts[2], 10);
                deadlineInfo = `<div style="display:inline-block; margin-top:8px; padding:3px 10px; border-radius:8px; font-size:0.75rem; font-weight:900; background-color:#ffeb3b; color:#d32f2f; border:2px solid #d32f2f; box-shadow: 2px 2px 0px rgba(0,0,0,0.2);">⏰ 期限: ${month}/${day}${timeStr}</div>`;
            }

            return `
                <div style="padding: 15px; border: 3px solid var(--text-main); border-radius: 12px; background: #fff; box-shadow: 4px 4px 0px var(--shadow-color); margin-bottom: 5px;">
                    ${requestStamp}
                    <div style="display:flex; align-items:center;">
                        <span style="font-weight: 900; font-size:1.1rem;">${escapeHTML(t.title || t.content)}</span>
                    </div>
                    ${deadlineInfo}
                </div>
            `;
        }).join('');
        
        if (archivedTasks.length === 0) list.innerHTML = '<div style="color:#777; text-align:center; padding: 20px; font-weight: bold;">格納された履歴はありません</div>';
        overlay.classList.add('active');
    } else {
        overlay.classList.remove('active');
    }
};

function setupDragAndDrop() {
    ['todo', 'progress', 'done'].forEach(id => {
        const list = document.getElementById('list-' + id);
        if (!list) return;
        list.addEventListener('dragover', e => e.preventDefault());
        list.addEventListener('drop', e => {
            const taskId = e.dataTransfer.getData('text/plain');
            moveTask(taskId, id);
        });
    });
}

function handleDragStart(e) {
    e.dataTransfer.setData('text/plain', e.target.dataset.id);
}
