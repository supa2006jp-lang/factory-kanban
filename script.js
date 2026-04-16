// Firebase Configuration (Realtime Data Integration)
const firebaseConfig = {
  apiKey: "AIzaSyBfe7X9WcpCiTPf6nzJaZRXxGLwQRKALqs",
  authDomain: "factory-kanban.firebaseapp.com",
  projectId: "factory-kanban",
  storageBucket: "factory-kanban.firebasestorage.app",
  messagingSenderId: "7390637548",
  appId: "1:7390637548:web:909d565531d2f1d3d924c9"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// State Management
let tasks = [];
let workers = [];
let currentWorkerId = localStorage.getItem('current-worker-id') || 'default';
let currentTargetColumn = 'todo';
let isAutoScaleEnabled = false;

// DOM Elements
let lists = {};
let counts = {};

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

    // Firebase Realtime Sync: Workers
    db.ref('workers').on('value', (snapshot) => {
        const data = snapshot.val();
        if (data) {
            workers = Object.values(data);
        } else {
            // Default worker if empty
            workers = [{ id: 'default', name: '共通・未設定' }];
            db.ref('workers').set({ 'default': { id: 'default', name: '共通・未設定' } });
        }
        updateWorkerSelect();
    });

    // Firebase Realtime Sync: Tasks
    db.ref('tasks').on('value', (snapshot) => {
        const data = snapshot.val();
        tasks = data ? Object.values(data) : [];
        checkRecurringTasks(); 
        renderTasks();
        if (isAutoScaleEnabled) autoScale();
    });

    // Firebase Realtime Sync: Logs (Sync for current worker)
    syncWorkerLogs();

    setupDragAndDrop();
    
    // Auto-refresh scaling on resize
    window.onresize = autoScale;
    
    // Auto-refresh setting
    if (localStorage.getItem('is-auto-scale') !== 'false') {
        isAutoScaleEnabled = true;
        setTimeout(autoScale, 500); // Give time for content to render
    }
    
    setInterval(renderTasks, 3600000);
}

function syncWorkerLogs() {
    const logKey = `logs/${currentWorkerId}`;
    db.ref(logKey).on('value', (snapshot) => {
        renderLogs();
    });
}

// --- Auto Scaling Logic ---
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
    const contentHeight = wrapper.scrollHeight;
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

// Worker Management
function updateWorkerSelect() {
    const select = document.getElementById('worker-select');
    if (!select) return;
    select.innerHTML = workers.map(w => `<option value="${w.id}" ${w.id === currentWorkerId ? 'selected' : ''}>${w.name}</option>`).join('');
}

window.handleWorkerChange = function() {
    currentWorkerId = document.getElementById('worker-select').value;
    localStorage.setItem('current-worker-id', currentWorkerId);
    syncWorkerLogs();
    renderTasks();
};

// UI Rendering
function renderTasks() {
    if (!lists.todo) return;
    Object.keys(lists).forEach(status => {
        lists[status].innerHTML = '';
        const filtered = tasks.filter(t => t.status === status && (t.assignedTo ? t.assignedTo.includes(currentWorkerId) : true));
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
        const d = new Date(task.deadline);
        const now = new Date();
        const diff = d - now;
        const isNear = diff > 0 && diff < 86400000;
        deadlineInfo = `<div class="task-deadline ${isNear ? 'urgent' : ''}">${isNear ? '期限間近！' : ''} 期限: ${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}</div>`;
    }

    const requestStamp = task.isRequest ? '<div class="request-stamp">依頼</div>' : '';

    card.innerHTML = `
        ${requestStamp}
        <div class="task-content">
            <div style="font-weight:900;">${escapeHTML(task.title || task.content)}</div>
            ${deadlineInfo}
        </div>
        <div class="task-footer">
            <div class="task-actions">
                ${task.status === 'todo' ? `<button onclick="moveTask('${task.id}', 'progress')" title="着手">▶</button>` : ''}
                ${task.status === 'progress' ? `<button onclick="moveTask('${task.id}', 'done')" title="完了">✔</button>` : ''}
                ${task.status === 'done' ? `<button onclick="moveTask('${task.id}', 'todo')" title="戻す">↺</button>` : ''}
                <button onclick="editTask('${task.id}')" title="編集">✎</button>
                <button onclick="deleteTask('${task.id}')" title="削除">🗑</button>
            </div>
        </div>
    `;
    card.onclick = (e) => {
        if (e.target.tagName !== 'BUTTON') editTask(task.id);
    };
    return card;
}

// Data Operations
window.openModal = function(status, taskId = null, isRecurring = false, isRequest = false) {
    currentTargetColumn = status;
    const modal = document.getElementById('modal-overlay');
    const workerArea = document.getElementById('worker-selection-area');
    const rejectBtn = document.getElementById('reject-btn');
    
    resetModal();
    
    if (taskId) {
        const task = tasks.find(t => t.id === taskId);
        document.getElementById('modal-title').innerText = 'タスクを編集';
        document.getElementById('edit-task-id').value = taskId;
        document.getElementById('task-title').value = task.title || task.content;
        document.getElementById('task-desc').value = task.description || '';
        document.getElementById('task-priority').value = task.priority || 'low';
        document.getElementById('task-deadline').value = task.deadline || '';
        document.getElementById('task-recurring').checked = !!task.isRecurring;
        
        if (task.isRequest) {
            rejectBtn.style.display = 'block';
            workerArea.style.display = 'block';
            renderWorkerCheckboxes(task.assignedTo || []);
        }
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
    list.innerHTML = workers.map(w => `
        <label style="display:flex; align-items:center; gap:10px; padding:5px; border-bottom:1px solid #eee; cursor:pointer;">
            <input type="checkbox" value="${w.id}" ${selectedIds.includes(w.id) ? 'checked' : ''} style="width:18px; height:18px;">
            <span style="font-weight:bold;">${w.name}</span>
        </label>
    `).join('');
}

window.saveTask = function() {
    const id = document.getElementById('edit-task-id').value || Date.now().toString();
    const title = document.getElementById('task-title').value;
    const isRequest = document.getElementById('worker-selection-area').style.display === 'block';
    
    const selectedWorkers = [];
    if (isRequest) {
        document.querySelectorAll('#modal-worker-list input:checked').forEach(el => selectedWorkers.push(el.value));
    }

    const newTask = {
        id,
        title,
        description: document.getElementById('task-desc').value,
        priority: document.getElementById('task-priority').value,
        deadline: document.getElementById('task-deadline').value,
        status: currentTargetColumn,
        isRecurring: document.getElementById('task-recurring').checked,
        isRequest,
        assignedTo: isRequest ? selectedWorkers : [currentWorkerId],
        requestedBy: isRequest ? currentWorkerId : null,
        requestGroupId: isRequest ? (id + '-group') : null
    };

    db.ref('tasks/' + id).set(newTask);
    
    if (isRequest) {
        selectedWorkers.forEach(wid => {
            if (wid !== currentWorkerId) {
                showSystemMessage(`依頼作成 by ${getWorkerName(currentWorkerId)} 【${title}】 内容：${newTask.description}`, wid);
            }
        });
    }
    
    closeModal();
};

window.deleteTask = function(id) {
    if (confirm('このタスクを削除しますか？')) {
        db.ref('tasks/' + id).remove();
    }
};

window.moveTask = function(id, newStatus) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    
    if (task.isRequest && newStatus === 'done') {
        const title = task.title || task.content;
        showSystemMessage(`依頼完了 by ${getWorkerName(currentWorkerId)} 【${title}】`, task.requestedBy);
        task.assignedTo.forEach(wid => {
            if (wid !== currentWorkerId) {
                showSystemMessage(`依頼完了 by ${getWorkerName(currentWorkerId)} 【${title}】`, wid);
            }
        });
        // Sync same request tasks
        tasks.forEach(t => {
            if (t.requestGroupId === task.requestGroupId) {
                db.ref('tasks/' + t.id + '/status').set('done');
            }
        });
    } else {
        db.ref('tasks/' + id + '/status').set(newStatus);
    }
};

window.rejectTask = function() {
    const id = document.getElementById('edit-task-id').value;
    const task = tasks.find(t => t.id === id);
    const reason = prompt('拒否理由を入力してください:', '多忙のため');
    if (reason === null) return;

    if (task && task.isRequest) {
        showSystemMessage(`依頼拒否 by ${getWorkerName(currentWorkerId)} 【${task.title}】 理由：${reason}`, task.requestedBy);
        db.ref('tasks/' + id).remove();
    }
    closeModal();
};

// System Messages & Logs
function showSystemMessage(msg, targetWorkerId) {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const logKey = `logs/${targetWorkerId || currentWorkerId}`;
    
    db.ref(logKey).once('value', (snapshot) => {
        let history = snapshot.val() || [];
        history.unshift({ time, text: msg, isRead: false });
        if (history.length > 50) history = history.slice(0, 50);
        db.ref(logKey).set(history);
    });
}

function renderLogs() {
    const logKey = `logs/${currentWorkerId}`;
    db.ref(logKey).once('value', (snapshot) => {
        const history = snapshot.val() || [];
        const msgList = document.getElementById('msg-list');
        const badge = document.getElementById('log-count-badge');
        if (!msgList) return;

        const unreadCount = history.filter(m => !m.isRead).length;
        if (unreadCount > 0) {
            badge.innerText = unreadCount;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }

        const displayHistory = history.slice(0, 6);
        msgList.innerHTML = displayHistory.map(m => `
            <li style="margin-bottom: 2px; color: ${m.isRead ? '#333' : '#ff6b6b'}; display: flex; gap: 8px; align-items: center;">
                <span style="color: ${m.isRead ? '#888' : '#ff6b6b'}; font-family: monospace; font-size: 0.7rem;">[${m.time}]</span>
                <span style="font-weight: 700;">${getLogWithStamp(m.text)}</span>
            </li>
        `).join('');
    });
}

window.openLogHistory = function() {
    const overlay = document.getElementById('log-history-overlay');
    const list = document.getElementById('full-log-list');
    const logKey = `logs/${currentWorkerId}`;
    
    db.ref(logKey).once('value', (snapshot) => {
        const history = snapshot.val() || [];
        if (history.length === 0) {
            list.innerHTML = '<div style="text-align:center; padding: 20px; color: #888;">履歴がありません。</div>';
        } else {
            list.innerHTML = history.map(m => `
                <div style="padding: 10px; border-bottom: 2px solid #eee; display: flex; gap: 15px; align-items: center; color: ${m.isRead ? 'inherit' : '#ff6b6b'};">
                    <span style="color: ${m.isRead ? '#666' : '#ff6b6b'}; font-family: monospace; white-space: nowrap;">[${m.time}]</span>
                    <span style="font-weight: 700; color: ${m.isRead ? 'var(--text-main)' : '#ff6b6b'}; word-break: break-all;">${getLogWithStamp(m.text)}</span>
                </div>
            `).join('');
            
            const updatedHistory = history.map(m => ({ ...m, isRead: true }));
            db.ref(logKey).set(updatedHistory);
        }
    });
    overlay.classList.add('active');
};

function getLogWithStamp(text) {
    let stamp = '';
    let content = text;
    if (text.startsWith('依頼作成')) {
        stamp = '<span class="log-stamp stamp-create">作成</span>';
        content = text.replace('依頼作成', '').trim();
    } else if (text.startsWith('依頼完了')) {
        stamp = '<span class="log-stamp stamp-done">完了</span>';
        content = text.replace('依頼完了', '').trim();
    } else if (text.startsWith('依頼拒否')) {
        stamp = '<span class="log-stamp stamp-reject">拒否</span>';
        content = text.replace('依頼拒否', '').trim();
    }
    return `${stamp}${escapeHTML(content)}`;
}

// Helpers
function getWorkerName(id) {
    const w = workers.find(w => w.id === id);
    return w ? w.name : '不明';
}

function checkRecurringTasks() {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${now.getMonth() + 1}`;
    const lastChecked = localStorage.getItem('last-recurring-check');
    if (lastChecked === currentMonth) return;
    
    tasks.forEach(t => {
        if (t.isRecurring && t.status === 'done') {
            db.ref('tasks/' + t.id + '/status').set('todo');
        }
    });
    localStorage.setItem('last-recurring-check', currentMonth);
}

function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// Modal/Drag Handlers
function resetModal() {
    document.getElementById('edit-task-id').value = '';
    document.getElementById('task-title').value = '';
    document.getElementById('task-desc').value = '';
    document.getElementById('task-priority').value = 'low';
    document.getElementById('task-deadline').value = '';
    document.getElementById('task-recurring').checked = false;
    document.getElementById('worker-selection-area').style.display = 'none';
    document.getElementById('reject-btn').style.display = 'none';
}

window.closeModal = function() {
    document.getElementById('modal-overlay').classList.remove('active');
};

window.closeLogHistory = function() {
    document.getElementById('log-history-overlay').classList.remove('active');
};

function setupDragAndDrop() {
    ['todo', 'progress', 'done'].forEach(id => {
        const list = document.getElementById('list-' + id);
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
