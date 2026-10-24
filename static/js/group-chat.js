// ---- 群聊 ----
// 在 chat.js 之后加载，复用它的状态与工具函数，并覆盖列表渲染。

let groups = [];
let currentGroup = null;
let groupHistories = {};

// 微信式九宫格群头像（把自己也算进去）
const _GRP_CELLS = {
  2: [0,1], 3: [1,2,3], 4: [0,1,2,3],
  5: [1,2,6,7,8], 6: [3,4,5,6,7,8], 7: [1,3,4,5,6,7,8], 8: [1,2,3,4,5,6,7,8], 9: [0,1,2,3,4,5,6,7,8]
};
function renderGroupAvatarHTML(group, cls) {
  cls = cls || 'c-avatar';
  const sz = cls === 'cp-avatar' ? 42 : 44;   // 要和 CSS 里的头像尺寸一致，否则九宫格错位
  const userAv = document.getElementById('my-avatar-img')?.src || '';
  const avs = [userAv, ...(group.members || []).map(mid => skills.find(s => s.id === mid)?.avatar || '')].slice(0, 9);
  const total = avs.length;
  if (total <= 1) return `<div class="${cls}" style="background:var(--green);display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px">群</div>`;
  const G = total <= 4 ? 2 : 3, gap = 1;
  const tile = Math.floor((sz - 2 - gap * (G - 1)) / G);
  const gridPx = tile * G + gap * (G - 1);
  const off = Math.floor((sz - gridPx) / 2);
  const cells = _GRP_CELLS[total] || _GRP_CELLS[9];
  const byRow = {};
  cells.forEach(c => { const r = Math.floor(c / G); (byRow[r] ||= []).push(c); });
  let html = `<div class="${cls}" style="position:relative;overflow:hidden">`, idx = 0;
  for (const [row, rowCells] of Object.entries(byRow)) {
    const cnt = rowCells.length;
    const rowStart = off + Math.floor((gridPx - (tile * cnt + gap * (cnt - 1))) / 2);
    for (let ci = 0; ci < cnt && idx < total; ci++, idx++) {
      html += `<img src="${avs[idx] || ''}" style="position:absolute;top:${off + parseInt(row) * (tile + gap)}px;left:${rowStart + ci * (tile + gap)}px;width:${tile}px;height:${tile}px;object-fit:cover" onerror="this.src='${FALLBACK_AVATAR}'">`;
    }
  }
  return html + '</div>';
}

function showAddMenu() {
  const btn = document.getElementById('add-btn-top');
  const r = btn.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.className = 'top-menu';
  menu.style.top = (r.bottom + 5) + 'px';
  menu.style.left = Math.max(8, r.right - 132) + 'px';
  menu.innerHTML = `<div class="top-menu-item" id="mi-grp">发起群聊</div><div class="top-menu-item" id="mi-add">添加 Skill</div>`;
  menu.querySelector('#mi-grp').onclick = () => { menu.remove(); openCreateGroup(); };
  menu.querySelector('#mi-add').onclick = () => { menu.remove(); openImportModal(); };
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', function f(e) {
    if (!menu.contains(e.target) && e.target !== btn) { menu.remove(); document.removeEventListener('click', f); }
  }, {once: true}), 50);
}

function openCreateGroup() {
  const overlay = document.createElement('div');
  overlay.className = 'gc-overlay';
  let selected = [];
  overlay.innerHTML = `<div class="gc-box">
    <div class="gc-left"><div class="gc-title">选择联系人</div><div class="gc-list" id="gc-list"></div></div>
    <div class="gc-right">
      <div class="gc-cnt">已选 <span id="gc-cnt">0</span> 人</div>
      <div class="gc-names" id="gc-names"></div>
      <div class="gc-btns"><button class="gc-cancel" id="gc-cancel">取消</button><button class="gc-done" id="gc-done">完成</button></div>
    </div></div>`;
  document.body.appendChild(overlay);
  const lst = overlay.querySelector('#gc-list');
  skills.forEach(s => {
    const d = document.createElement('label');
    d.className = 'gc-row';
    const rn = s.real_name && s.real_name !== s.name ? ` (${escapeHtml(s.real_name)})` : '';
    d.innerHTML = `<input type="checkbox"><span>${escapeHtml(s.name)}${rn}</span>`;
    d.querySelector('input').onchange = e => {
      selected = e.target.checked ? [...selected, s] : selected.filter(x => x.id !== s.id);
      overlay.querySelector('#gc-cnt').textContent = selected.length;
      overlay.querySelector('#gc-names').innerHTML = selected.map(x => `<span class="gc-chip">${escapeHtml(x.name)}</span>`).join('');
    };
    lst.appendChild(d);
  });
  overlay.querySelector('#gc-cancel').onclick = () => overlay.remove();
  overlay.querySelector('#gc-done').onclick = async () => {
    if (!selected.length) return;
    const d = await fetch('/api/groups', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({members: selected.map(s => s.id)})
    }).then(r => r.json());
    if (d.ok) {
      groups.push(d.group);
      groupHistories[d.group.id] = await fetch('/api/groups/' + d.group.id + '/history').then(r => r.json());
      renderAll();
      openGroupChat(d.group.id);
    } else if (d.error) alert(d.error);
    overlay.remove();
  };
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

async function openGroupChat(gid) {
  _attachedFiles = []; currentGroup = gid; currentChat = null;
  if (!groupHistories[gid]) {
    groupHistories[gid] = await fetch('/api/groups/' + gid + '/history').then(r => r.json()) || [];
  }
  renderGroupChat(gid);
}

function renderGroupChat(gid) {
  const group = groups.find(g => g.id === gid);
  if (!group) return;
  const history = groupHistories[gid] || [];

  document.getElementById('chat-area').innerHTML = `
    <div class="chat-header">
      <div class="ch-name" onclick="openGroupRenameModal('${gid}')">${escapeHtml(group.name)} (${group.members.length + 1})</div>
      <div class="ch-spacer"></div>
      ${_headerBtnsHTML(`openGroupRenameModal('${gid}')`)}
    </div>
    <div class="chat-messages" id="msg-container"></div>
    ${_composerHTML('sendGroupMessage', '<div id="mention-popup"></div>')}
    <div class="call-popup-overlay" id="call-popup-overlay" onclick="closeCallPopup()">
      <div class="call-popup">你走火入魔了，还真想给 AI 打电话啊？</div>
    </div>`;
  buildEmojiPicker();

  const myAvatar = document.getElementById('my-avatar-img')?.src || '';
  const GAP = 300;
  let html = '';
  history.forEach((msg, i) => {
    const ts = msg.timestamp || 0, prevTs = i > 0 ? (history[i - 1].timestamp || 0) : 0;
    if (i === 0 || ts - prevTs > GAP) html += `<div class="msg-time">${fmtDate(ts, true)}</div>`;
    if (msg.sender === 'system') { html += `<div class="msg-time">${escapeHtml(msg.content)}</div>`; return; }
    const isSelf = msg.sender === 'user';
    const c = skills.find(s => s.id === msg.sender) || skills.find(s => s.name === msg.sender_name);
    const av = isSelf ? myAvatar : (c?.avatar || '');
    html += `<div class="msg-row ${isSelf ? 'self' : 'other'}">`
          + `<div class="msg-avatar"><img src="${av}" onerror="this.src='${FALLBACK_AVATAR}'"></div>`
          + `<div class="msg-content-wrap">`
          + (isSelf ? '' : `<div class="msg-sender-name">${escapeHtml(msg.sender_name || '')}</div>`)
          + `<div class="msg-bubble">${renderEmoji(escapeHtml(msg.content))}</div></div></div>`;
  });
  const mc = document.getElementById('msg-container');
  mc.innerHTML = html;
  mc.scrollTop = mc.scrollHeight;
  renderChatList();
  _setupResizeDrag();
}

async function sendGroupMessage() {
  if (!currentGroup) return;
  const input = document.getElementById('msg-input'), msg = input.value.trim();
  if (!msg) return;
  const chatId = currentGroup;
  input.value = '';

  const nick = document.getElementById('sp-nickname')?.value || '微信用户';
  (groupHistories[chatId] ||= []).push({sender: 'user', sender_name: nick, content: msg, timestamp: Date.now() / 1000});
  if (currentGroup === chatId) renderGroupChat(chatId);

  try {
    const res = await fetch('/api/groups/' + chatId + '/send', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({message: msg})
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({error: '请求失败'}));
      groupHistories[chatId].push({sender: 'system', content: e.error || '请求失败', timestamp: Date.now() / 1000});
      if (currentGroup === chatId) renderGroupChat(chatId);
      return;
    }
    await _readSSE(res, d => {
      if (d.done) return;
      groupHistories[chatId].push(d.system
        ? {id: d.id, sender: 'system', content: d.content, timestamp: Date.now() / 1000}
        : {id: d.id, sender: d.sender, sender_name: d.sender_name, content: d.content, time: d.time, timestamp: Date.now() / 1000});
      if (currentGroup === chatId) renderGroupChat(chatId);
    });
  } catch (e) { console.error(e); }
  finally { if (currentGroup === chatId) document.getElementById('msg-input')?.focus(); }
}

function handleGroupInput(e) {
  handleMentionInput(e);
}

function handleMentionInput(e) {
  const input = e.target, val = input.value, cp = input.selectionStart;
  const before = val.substring(0, cp), atIdx = before.lastIndexOf('@');
  const popup = document.getElementById('mention-popup');
  if (!popup) return;
  if (atIdx < 0 || (atIdx > 0 && before[atIdx - 1] !== ' ')) { popup.style.display = 'none'; return; }
  const grp = groups.find(g => g.id === currentGroup);
  if (!grp) { popup.style.display = 'none'; return; }
  const q = before.substring(atIdx + 1).toLowerCase();
  const members = ['所有人', ...grp.members.map(mid => {
    const s = skills.find(x => x.id === mid);
    return s ? {name: s.name, real_name: s.real_name || ''} : {name: mid, real_name: ''};
  })];
  const filtered = members.filter(n => typeof n === 'string'
    ? n.toLowerCase().includes(q)
    : n.name.toLowerCase().includes(q) || n.real_name.toLowerCase().includes(q));
  if (!filtered.length) { popup.style.display = 'none'; return; }
  popup.style.display = 'block';
  popup.innerHTML = filtered.map(n => {
    const name = typeof n === 'string' ? n : n.name;
    const label = typeof n === 'string' ? n
      : (n.real_name && n.real_name !== n.name ? `${escapeHtml(n.name)} (${escapeHtml(n.real_name)})` : escapeHtml(n.name));
    return `<div class="mention-item" onclick="selectMention('${name.replace(/'/g, "\\'")}')">@${label}</div>`;
  }).join('');
}

function selectMention(name) {
  const input = document.getElementById('msg-input');
  if (!input) return;
  const val = input.value, cp = input.selectionStart;
  const atIdx = val.substring(0, cp).lastIndexOf('@');
  input.value = val.substring(0, atIdx) + '@' + name + ' ' + val.substring(cp);
  document.getElementById('mention-popup').style.display = 'none';
  input.focus();
}

function openGroupRenameModal(gid) {
  const g = groups.find(x => x.id === gid);
  if (!g) return;
  document.getElementById('edit-modal-title').textContent = '修改群聊名称';
  document.getElementById('edit-name-label').textContent = '群聊名称';
  document.getElementById('edit-name').value = g.name;
  document.getElementById('edit-avatar-group').style.display = 'none';
  document.getElementById('edit-realname-group').style.display = 'none';
  editingContact = gid; _editingGroup = true;
  document.getElementById('edit-modal').classList.add('show');
}

let _editingGroup = false;
const _originalSaveContact = saveContact;
saveContact = async function () {
  if (_editingGroup && editingContact) {
    const gid = editingContact;
    const name = document.getElementById('edit-name').value.trim();
    await fetch('/api/groups/' + gid + '/rename', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name})
    });
    const g = groups.find(x => x.id === gid);
    if (g) g.name = name;
    _editingGroup = false;
    closeModal();
    renderAll();
    if (currentGroup === gid) renderGroupChat(gid);
    return;
  }
  _originalSaveContact();
};

async function deleteGroup(gid) {
  if (!confirm('删除此群聊？')) return;
  await fetch('/api/groups/' + gid, {method: 'DELETE'});
  groups = groups.filter(g => g.id !== gid);
  delete groupHistories[gid];
  if (currentGroup === gid) {
    currentGroup = null;
    document.getElementById('chat-area').innerHTML = '<div class="no-chat"></div>';
  }
  renderAll();
}
async function clearGroupHistory(gid) {
  if (!confirm('清空该群聊的聊天记录？')) return;
  await fetch('/api/groups/' + gid + '/clear', {method: 'POST'});
  groupHistories[gid] = [];
  if (currentGroup === gid) renderGroupChat(gid);
  renderAll();
}

// ---- 覆盖：把群聊并进会话列表 ----
const _originalInit = init;
init = async function () {
  await _originalInit();
  groups = await fetch('/api/groups').then(r => r.json()) || [];
  await Promise.all(groups.map(async g => {
    groupHistories[g.id] = await fetch('/api/groups/' + g.id + '/history').then(r => r.json()) || [];
  }));
  renderAll();
};

renderChatList = function () {
  const list = document.getElementById('chat-contact-list');
  if (!list) return;
  const lastOf = h => { for (let i = h.length - 1; i >= 0; i--) if (!h[i].deleted) return h[i]; return null; };
  const items = [];

  skills.forEach(s => {
    const last = lastOf(histories[s.id] || []);
    items.push({
      type: 'contact', id: s.id, name: s.name, avatar: s.avatar,
      lastMsg: last ? (last.is_voice ? '[语音]' : last.content.substring(0, 30)) : (s.default_note || ''),
      lastTs: last ? (last.timestamp || 0) : 0
    });
  });
  groups.forEach(g => {
    const last = lastOf(groupHistories[g.id] || []);
    let lastMsg = '';
    if (last) {
      lastMsg = (last.sender === 'user' || last.sender === 'system')
        ? last.content.substring(0, 30)
        : (last.sender_name || '?') + ': ' + last.content.substring(0, 30);
    }
    items.push({type: 'group', id: g.id, name: g.name, lastMsg, lastTs: last ? (last.timestamp || 0) : 0, groupRef: g});
  });

  items.sort((a, b) => b.lastTs - a.lastTs);
  list.innerHTML = '';
  items.forEach(item => {
    const d = document.createElement('div');
    const active = item.type === 'group' ? currentGroup === item.id : currentChat === item.id;
    d.className = 'contact-item' + (active ? ' active' : '');
    d.onclick = () => item.type === 'group' ? openGroupChat(item.id) : openChat(item.id);
    if (item.type === 'contact') d.id = 'item-' + item.id;
    const avatarHTML = item.type === 'group'
      ? renderGroupAvatarHTML(item.groupRef)
      : `<div class="c-avatar"><img src="${item.avatar}" onerror="this.src='${FALLBACK_AVATAR}'"></div>`;
    d.innerHTML = `${avatarHTML}<div class="c-info"><div class="c-name">${escapeHtml(item.name)}</div>
      <div class="c-msg">${escapeHtml(item.lastMsg)}</div></div>
      ${_listRightHTML(item.lastTs)}`;
    list.appendChild(d);
  });
};

const _originalRenderContactsDetail = renderContactsDetail;
renderContactsDetail = function () {
  _originalRenderContactsDetail();
  const c = document.getElementById('contacts-detail-list');
  if (!c) return;
  groups.forEach(g => {
    const d = document.createElement('div');
    d.className = 'cp-item';
    d.innerHTML = `${renderGroupAvatarHTML(g, 'cp-avatar')}
      <span class="cp-name" onclick="openGroupRenameModal('${g.id}')">${escapeHtml(g.name)}</span>
      <span class="cp-action" onclick="clearGroupHistory('${g.id}')">清空聊天</span>
      <span class="cp-del" onclick="deleteGroup('${g.id}')">删除</span>`;
    c.appendChild(d);
  });
};

const __origRenderGroupChat = renderGroupChat;
renderGroupChat = function (gid) { _renderSkipDeleted(groupHistories, gid, __origRenderGroupChat); };

init();
