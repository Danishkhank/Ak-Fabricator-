const $ = s => document.querySelector(s);
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));
const inr = n => new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0
}).format(Math.round(n || 0));
const td = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fd = s => s ? new Date(s + 'T00:00').toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric'
}) : '-';
const mname = m => new Date(m + '-01T00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
function toast(m, e) {
    const t = $('#toast');
    t.textContent = m;
    t.className = e ? 'e' : '';
    t.hidden = false;
    clearTimeout(toast.i);
    toast.i = setTimeout(() => t.hidden = true, 3600);
}
const errm = e => ({
    'auth/invalid-credential': 'Email ya password galat hai.', 'auth/email-already-in-use': 'Ye email pehle se hai.', 'auth/weak-password': 'Password kam se kam 6 akshar ka rakhein.', 'auth/network-request-failed': 'Internet check karein.'
}[e.code] || (e.code === 'PERMISSION_DENIED' ? 'Permission nahi hai (rules check karein).' : e.message));
const S = {
    user: null, owner: false, ready: false, workers: {}, pay: {}, leave: {}, req: {}, lreq: {}, site: {}, task: {}, me: undefined, tab: 'home', sel: null, month: td().slice(0, 7)
};
if (cfg.apiKey.startsWith('PASTE')) {
    document.getElementById('app').innerHTML = '<div class="login gl"><h2 class="gd">Setup baaki hai</h2><p class="note">index.html ke upar SETTINGS mein apna Firebase config, owner email aur phone daaliye.</p></div>';
}
else {
    firebase.initializeApp(cfg);
    const auth = firebase.auth(), db = firebase.database();
    let refs = [];
    const un = (node, uid) => Object.entries(S[node][uid] || {}).map(([id, v]) => ({
        id, uid, ...v
    })).sort((a, b) => String(b.date || b.at).localeCompare(String(a.date || a.at)));
    const W = uid => ({ uid, ...S.workers[uid] });
    /* ---- Har worker ka mahina alag tareekh se shuru ho sakta hai (cycle: 1 se 28) ---- */
    const cyc = w => Math.min(28, Math.max(1, +w.cycle || 1));
    const pad = n => String(n).padStart(2, '0');
    /* [shuru, ant) - jaise cycle 5 aur October => 2026-10-05 se 2026-11-05 se pehle tak */
    function range(w, m) {
        const [y, mo] = m.split('-').map(Number), n = new Date(y, mo, 1);
        return [`${y}-${pad(mo)}-${pad(cyc(w))}`, `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(cyc(w))}`];
    }
    const inP = (w, m, date) => { const [a, b] = range(w, m); return date >= a && date < b; };
    /* Koi tareekh kis cycle-mahine mein aati hai (3 Oct, cycle 5 => September wala mahina) */
    function pkey(w, date) {
        const [y, mo, d] = date.split('-').map(Number), k = new Date(y, mo - 1 - (d < cyc(w) ? 1 : 0), 1);
        return `${k.getFullYear()}-${pad(k.getMonth() + 1)}`;
    }
    function plabel(w) {
        if (cyc(w) === 1)
            return '';
        const [a, b] = range(w, S.month), e = new Date(b + 'T00:00');
        e.setDate(e.getDate() - 1);
        return `${fd(a)} se ${fd(`${e.getFullYear()}-${pad(e.getMonth() + 1)}-${pad(e.getDate())}`)} tak`;
    }
    const avatar = (w, big) => `<div class="av ${big ? 'lg' : ''}">${/^https:\/\//.test(w.photo || '') ? `<img src="${esc(w.photo)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}<span>${esc((w.name || '?')[0])}</span></div>`;
    /* Ek cycle-mahine ka hisaab (is mahine ki salary, katauti aur diye gaye paise) */
    function period(w, m) {
        const per = Number(w.salary || 0) / DAYS_IN_MONTH;
        const L = un('leave', w.uid).filter(l => inP(w, m, l.date)), all = L.reduce((a, l) => a + l.days, 0), u = L.filter(l => !l.paid).reduce((a, l) => a + l.days, 0);
        const cut = Math.round(per * u), net = Number(w.salary || 0) - cut, paid = un('pay', w.uid).filter(p => inP(w, m, p.date)).reduce((a, p) => a + Number(p.amount || 0), 0);
        return { per, all, u, cut, net, paid };
    }
    /* Worker ka pehla mahina: kaam shuru hone ki tareekh ya sabse purani entry */
    function firstKey(w) {
        const ds = [w.joined, ...un('pay', w.uid).map(x => x.date), ...un('leave', w.uid).map(x => x.date)].filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x || '')).sort();
        return ds.length ? pkey(w, ds[0]) : null;
    }
    /* Pichle sab mahino ka baaki (carry forward) + is mahine ka hisaab */
    function calc(w, m) {
        const c = period(w, m), f = firstKey(w);
        let carry = 0, k = f, guard = 0;
        while (k && k < m && guard++ < 240) {
            const p = period(w, k);
            carry += p.net - p.paid;
            const [y, mo] = k.split('-').map(Number), n = new Date(y, mo, 1);
            k = `${n.getFullYear()}-${pad(n.getMonth() + 1)}`;
        }
        const total = c.net + carry;
        return { ...c, carry, total, baaki: total - c.paid, pct: total > 0 ? Math.min(100, c.paid / total * 100) : 0 };
    }
    /* ---- Phone par free alarm jaisa notification: ntfy app (ntfy.sh) ---- */
    const tOwner = () => `${NTFY_PREFIX}-owner`;
    const tWorker = uid => `${NTFY_PREFIX}-w${String(uid).slice(0, 10)}`;
    function ping(topic, title, msg) {
        try {
            fetch('https://ntfy.sh/' + topic, { method: 'POST', body: msg, headers: { Title: title, Priority: '5', Tags: 'rotating_light', Click: site() } }).catch(() => { });
        }
        catch (e) { /* notification fail ho to bhi app chalti rahe */ }
    }
    const notifCard = () => `<div class="gl" style="margin-top:12px"><h3>🔔 Phone par alarm jaisa notification (free)</h3><p class="note">1) Phone mein <b>ntfy</b> app install karein.<br>2) App mein "+" dabakar ye topic jodein:<br><b style="word-break:break-all;color:var(--gold)">${S.owner ? tOwner() : tWorker(S.user.uid)}</b><br>3) App ki settings mein is topic ko <b>Urgent</b> par rakhein, aur battery saver se ntfy ko bahar rakhein.</p><button class="b s sm" data-a="copytopic">Topic copy karein</button> <button class="b sm" data-a="pingtest">🔔 Test notification bhejein</button></div>`;
    function wa(phone, text) {
        const p = String(phone).replace(/\D/g, ''), f = p.length === 10 ? '91' + p : p, t = encodeURIComponent(text), ua = navigator.userAgent;
        if (/Android/i.test(ua))
            location.href = `intent://send/?phone=${f}&text=${t}#Intent;scheme=whatsapp;package=com.whatsapp;S.browser_fallback_url=${encodeURIComponent(`https://wa.me/${f}?text=${t}`)};end`;
        else if (/iPhone|iPad/i.test(ua))
            location.href = `whatsapp://send?phone=${f}&text=${t}`;
        else
            window.open(`https://wa.me/${f}?text=${t}`);
    }
    const site = () => location.origin + location.pathname;
    /* ---- modal helpers ---- */
    const modal = h => {
        $('#modal').innerHTML = h ? `<div class="ov"><div class="mod">${h}</div></div>` : '';
        if (!h) {
            stopRing();
            setTimeout(checkPopups, 500);
        }
    };
    const ask = (t, rows, ok, danger) => new Promise(r => {
        modal(`<h3>${esc(t)}</h3><table class="dt">${rows.map(x => `<tr><td class="note">${esc(x[0])}</td><td>${esc(x[1])}</td></tr>`).join('')}</table><div class="row"><button class="b s f" id="cn">Wapas</button><button class="b ${danger ? 'd' : ''} f" id="cy">${esc(ok)}</button></div>`);
        $('#cn').onclick = () => {
            modal();
            r(0);
        };
        $('#cy').onclick = () => {
            modal();
            r(1);
        };
    });
    function form(title, fs, go, btn = 'Save') {
        modal(`<form id="fm"><h3>${title}</h3>${fs.map(f => `<label>${f.l}</label>` + (f.c ? f.c.map(o => `<label class="chk"><input type="checkbox" name="${f.n}" value="${o[0]}" ${(f.v || []).includes(o[0]) ? 'checked' : ''}> ${esc(o[1])}</label>`).join('') : f.o ? `<select name="${f.n}">${f.o.map(o => `<option value="${o[0]}" ${o[0] == f.v ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>` : f.t === 'area' ? `<textarea name="${f.n}" rows="3">${esc(f.v || '')}</textarea>` : `<input name="${f.n}" type="${f.t || 'text'}" step="any" value="${esc(f.v ?? '')}" ${f.r === 0 ? '' : 'required'}>`)).join('')}
<div class="row" style="margin-top:18px"><button type="button" class="b s f" data-a="close">Band</button><button class="b f">${btn}</button></div></form>`);
        $('#fm').onsubmit = async (e) => {
            e.preventDefault();
            const b = e.target.querySelector('button:not([type])');
            b.disabled = true;
            try {
                const fdata = new FormData(e.target), d = Object.fromEntries(fdata);
                d.team = fdata.getAll('team');
                await go(d);
            }
            catch (x) {
                toast(errm(x), 1);
            }
            b.disabled = false;
        };
    }
    /* ---- data ---- */
    const listen = (p, cb, qf) => {
        const r = qf ? qf(db.ref(p)) : db.ref(p), h = r.on('value', s => {
            cb(s.val() || {});
            render();
        }, e => toast(errm(e), 1));
        refs.push([r, h]);
    };
    auth.onAuthStateChanged(u => {
        refs.forEach(([r, h]) => r.off('value', h));
        refs = [];
        Object.assign(S, {
            user: u, owner: !!u && u.email.toLowerCase() === OWNER_EMAIL.toLowerCase(), workers: {}, pay: {}, leave: {}, req: {}, lreq: {}, site: {}, task: {}, me: undefined, tab: 'home', sel: null, ready: true
        });
        if (u) {
            const nodes = {
                pay: 'payments', leave: 'leaves', req: 'requests', lreq: 'leaveRequests', task: 'tasks'
            };
            if (S.owner) {
                listen('workers', v => S.workers = v);
                listen('sites', v => S.site = v);
                for (const k in nodes)
                    listen(nodes[k], v => S[k] = v);
            }
            else {
                listen('mySites/' + u.uid, v => S.site = v);
                listen('workers/' + u.uid, v => {
                    S.me = v.name ? v : null;
                    S.workers = v.name ? { [u.uid]: v } : {};
                });
                for (const k in nodes)
                    listen(`${nodes[k]}/${u.uid}`, v => S[k] = { [u.uid]: v });
            }
        }
        render();
    });
    /* ---- views ---- */
    const nav = (items) => `<div class="nav">${items.map(i => `<button class="${S.tab === i[0] && !S.sel ? 'on' : ''}" data-a="tab" data-id="${i[0]}">${i[1]}</button>`).join('')}</div>`;
    const top = (sub = '') => `<div class="top"><h2 data-a="home" style="cursor:pointer">AK Fabricator</h2><a class="b s sm" href="${SHOP_MAP}" target="_blank" rel="noopener" style="text-decoration:none">📍 Shop</a><button class="b s sm" data-a="out">Logout</button></div>`;
    const monthNav = (w) => `<div class="mn"><button class="b s sm" data-a="mo" data-id="-1">‹</button><div style="text-align:center"><h3 class="gd">${mname(S.month)}</h3>${w && plabel(w) ? `<div class="note">${plabel(w)}</div>` : ''}</div><button class="b s sm" data-a="mo" data-id="1">›</button></div>`;
    const stat = (k, v, c = '') => `<div class="gl"><div class="k">${k}</div><div class="big ${c}">${v}</div></div>`;
    const taskRow = (t, owner) => `<div class="it row"><div class="f"><b>${esc(t.text)}</b><div class="note">${esc(t.shift)} · ${fd(t.date)}${owner ? ' · ' + esc(S.workers[t.uid]?.name || '') : ''}</div></div>${owner ? `<span class="tag ${t.done ? 'g' : ''}">${t.done ? 'Ho gaya' : 'Baaki'}</span><button class="b d sm" data-a="del" data-n="tasks" data-u="${t.uid}" data-id="${t.id}">✕</button>` : `<button class="b ${t.done ? 's' : ''} sm" data-a="done" data-u="${t.uid}" data-id="${t.id}">${t.done ? '✓ Done' : 'Done karein'}</button>`}</div>`;
    const payRow = (p, o) => `<div class="it row"><div class="f"><b>${inr(p.amount)}</b> <span class="tag">${esc(p.mode)}</span><div class="note">${fd(p.date)}${p.note ? ' · ' + esc(p.note) : ''}</div></div>${o ? `<button class="b d sm" data-a="del" data-n="payments" data-u="${p.uid}" data-id="${p.id}">✕</button>` : ''}</div>`;
    const leaveRow = (l, o) => `<div class="it row"><div class="f"><b>${l.days} din</b> <span class="tag ${l.paid ? 'g' : 'r'}">${l.paid ? 'Paid chhutti' : 'Salary kategi'}</span><div class="note">${fd(l.date)}${l.note ? ' · ' + esc(l.note) : ''}</div></div>${o ? `<button class="b d sm" data-a="del" data-n="leaves" data-u="${l.uid}" data-id="${l.id}">✕</button>` : ''}</div>`;
    const reqRow = (r, o) => `<div class="it"><div class="row"><div class="f"><b>${inr(r.amount)}</b> <span class="tag ${r.status === 'paid' ? 'g' : r.status === 'rejected' ? 'r' : ''}">${{
        pending: 'Intezaar', paid: 'Mil gaye', rejected: 'Reject'
    }[r.status]}</span>${o ? `<div class="note"><b>${esc(S.workers[r.uid]?.name || '')}</b> · ` : '<div class="note">'}${new Date(r.at).toLocaleDateString('en-IN')} · ${esc(r.note || '')}</div></div></div>${o && r.status === 'pending' ? `<div class="row" style="margin-top:8px;justify-content:flex-end"><button class="b d sm" data-a="rej" data-u="${r.uid}" data-id="${r.id}">Reject</button><button class="b sm" data-a="payreq" data-u="${r.uid}" data-id="${r.id}">Pay karein</button></div>` : ''}</div>`;
    const sumCards = c => `<div class="grid">${stat('Mahine ki salary', inr(c.net + c.cut))}${stat(`Chhutti kati (${c.u} din)`, '− ' + inr(c.cut), c.cut ? 'bad' : '')}${stat('Ab tak mile', inr(c.paid), 'ok')}${stat(c.baaki < 0 ? 'Zyada diye' : 'Baaki', inr(Math.abs(c.baaki)), c.baaki > 0 ? 'gd' : c.baaki < 0 ? 'bad' : 'ok')}</div><div class="gl"><div class="row sp"><span class="k">Payable ${inr(c.total)} mein se mile</span><b>${Math.round(c.pct)}%</b></div><div class="bar"><i style="width:${c.pct}%"></i></div><p class="note" style="margin:10px 0 0">${c.carry ? `Pichla baaki: <b class="${c.carry > 0 ? 'gd' : 'bad'}">${inr(Math.abs(c.carry))}${c.carry < 0 ? ' (zyada diye)' : ''}</b> · ` : ''}Kul chhutti: ${c.all} din · Ek din ka rate: ${inr(c.per)}</p></div>`;
    /* ---- Site: ek se zyada logon ko saunpna ---- */
    const teamOf = x => x.team ? Object.keys(x.team) : (x.assignedTo ? [x.assignedTo] : []);
    const fmt12 = t => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`; };
    const siteCopy = x => ({ name: x.name, address: x.address || '', map: x.map || '', note: x.note || '', status: x.status || 'chalu', at: x.at || Date.now() });
    /* Master record (sites) ke saath har worker ki apni copy (mySites) sahi rakhta hai */
    async function syncTeam(id, x, team) {
        const old = teamOf(x);
        for (const u of old)
            if (!team.includes(u))
                await db.ref(`mySites/${u}/${id}`).remove();
        for (const u of team)
            if (!old.includes(u)) {
                await db.ref(`mySites/${u}/${id}`).set({ ...siteCopy(x), seen: false });
                ping(tWorker(u), 'Nayi site', `${x.name} ${x.address || ''}`);
            }
        await db.ref('sites/' + id).update({ team: Object.fromEntries(team.map(u => [u, true])), assignedTo: null });
    }
    const siteRow = (x, o) => `<div class="gl"><div class="row"><div class="f"><b>🏗 ${esc(x.name)}</b> <span class="tag ${x.status === 'done' ? 'g' : ''}">${x.status === 'done' ? 'Poora' : 'Chalu'}</span>
${x.address ? `<div class="note">📍 <a class="gd" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(x.address)}" target="_blank" rel="noopener">${esc(x.address)}</a></div>` : ''}${/^https:\/\//.test(x.map || '') ? `<div class="note"><a class="gd" href="${esc(x.map)}" target="_blank" rel="noopener">🗺 Map kholein</a></div>` : ''}${x.note ? `<div class="note">${esc(x.note)}</div>` : ''}
${o ? `<div class="note">Zimmedari: <b>${esc(teamOf(x).map(u => S.workers[u]?.name).filter(Boolean).join(', ')) || 'Abhi kisi ko nahi saunpi'}</b></div>` : ''}</div></div>
${o ? `<div class="row wr" style="margin-top:10px;justify-content:flex-end"><button class="b d sm" data-a="delsite" data-id="${x.id}">Delete</button><button class="b s sm" data-a="sstatus" data-id="${x.id}">${x.status === 'done' ? 'Dobara chalu' : 'Poora hua'}</button><button class="b sm" data-a="assign" data-id="${x.id}">Kisko saunpein</button></div>` : ''}</div>`;
    const siteList = f => Object.entries(S.site).map(([id, v]) => ({ id, ...v })).filter(f).sort((a, b) => (a.status === 'done') - (b.status === 'done') || (b.at || 0) - (a.at || 0));
    const lreqRow = (r, o) => `<div class="it"><div class="row"><div class="f"><b>🗓 ${r.days} din ki chhutti</b> <span class="tag ${r.status === 'approved' ? 'g' : r.status === 'rejected' ? 'r' : ''}">${{ pending: 'Intezaar', approved: 'Manzoor', rejected: 'Reject' }[r.status]}</span>
<div class="note">${o ? '<b>' + esc(S.workers[r.uid]?.name || '') + '</b> · ' : ''}${fd(r.date)} · ${esc(r.note || '')}</div></div></div>${o && r.status === 'pending' ? `<div class="row wr" style="margin-top:8px;justify-content:flex-end"><button class="b d sm" data-a="lrej" data-u="${r.uid}" data-id="${r.id}">Reject</button><button class="b s sm" data-a="lacc" data-u="${r.uid}" data-id="${r.id}" data-p="1">Paid chhutti</button><button class="b sm" data-a="lacc" data-u="${r.uid}" data-id="${r.id}" data-p="0">Salary kategi</button></div>` : ''}</div>`;

    /* Owner ke liye saari pending requests (paise + chhutti) */
    const pendingAll = () => [
        ...Object.keys(S.req).flatMap(u => un('req', u)).filter(r => r.status === 'pending').map(r => ({ ...r, kind: 'pay' })),
        ...Object.keys(S.lreq).flatMap(u => un('lreq', u)).filter(r => r.status === 'pending').map(r => ({ ...r, kind: 'leave' }))
    ];

    /* ---- Popups: owner ko urgent request, worker ko naya kaam ---- */
    const seen = new Set();
    const popRows = a => `<table class="dt">${a.map(x => `<tr><td class="note">${x[0]}</td><td>${esc(x[1])}</td></tr>`).join('')}</table>`;
    /* ---- Popup aane par ring jaisi awaaz + vibration (website khuli ho tab) ---- */
    let AC = null, ringT = null;
    document.addEventListener('click', () => {
        try {
            if (!AC)
                AC = new (window.AudioContext || window.webkitAudioContext)();
            if (AC.state === 'suspended')
                AC.resume();
        }
        catch (e) { }
    });
    function beep() {
        try {
            const o = AC.createOscillator(), g = AC.createGain();
            o.type = 'square';
            o.frequency.value = 880;
            g.gain.value = 0.25;
            o.connect(g);
            g.connect(AC.destination);
            o.start();
            o.stop(AC.currentTime + 0.22);
        }
        catch (e) { }
    }
    function stopRing() {
        if (ringT) {
            clearInterval(ringT);
            ringT = null;
        }
    }
    function startRing() {
        stopRing();
        try {
            navigator.vibrate && navigator.vibrate([400, 200, 400, 200, 400]);
        }
        catch (e) { }
        if (!AC || AC.state !== 'running')
            return;
        let n = 0;
        const go = () => { beep(); setTimeout(beep, 300); setTimeout(beep, 600); };
        go();
        ringT = setInterval(() => { go(); if (++n >= 12) stopRing(); }, 1800);
    }
    const popup = h => { modal(h); startRing(); };
    function checkPopups() {
        if (!S.user || $('#modal').innerHTML)
            return;
        if (S.owner) {
            const p = pendingAll().filter(x => !seen.has(x.id))[0];
            if (!p || !S.workers[p.uid])
                return;
            seen.add(p.id);
            const w = W(p.uid), ids = `data-u="${p.uid}" data-id="${p.id}"`;
            if (p.kind === 'pay') {
                popup(`<h3>💰 Paison ki request</h3>${popRows([['Worker', w.name], ['Amount', inr(p.amount)], ['Wajah', p.note || '-'], ['Is mahine baaki', inr(calc(w, S.month).baaki)]])}
<div class="row wr"><button class="b s f" data-a="snooze">Baad mein</button><button class="b d f" data-a="rej" ${ids}>Reject</button><button class="b f" data-a="payreq" ${ids}>Pay karein</button></div>`);
            }
            else {
                popup(`<h3>🗓 Chhutti ki request</h3>${popRows([['Worker', w.name], ['Tareekh', fd(p.date)], ['Din', p.days], ['Wajah', p.note || '-']])}
<div class="row wr"><button class="b s f" data-a="snooze">Baad mein</button><button class="b d f" data-a="lrej" ${ids}>Reject</button></div>
<div class="row wr" style="margin-top:8px"><button class="b s f" data-a="lacc" ${ids} data-p="1">Paid chhutti</button><button class="b f" data-a="lacc" ${ids} data-p="0">Salary kategi</button></div>`);
            }
            return;
        }
        const st = siteList(x => x.seen === false && !seen.has(x.id))[0];
        if (st) {
            seen.add(st.id);
            popup(`<h3>🏗 Nayi site aapko saunpi gayi</h3>${popRows([['Site', st.name], ['Pata', st.address || '-'], ['Note', st.note || '-']])}${/^https:\/\//.test(st.map || '') ? `<p><a class="gd" href="${esc(st.map)}" target="_blank" rel="noopener">🗺 Map kholein</a></p>` : ''}
<button class="b" style="width:100%" data-a="sack" data-id="${st.id}">Samajh gaya ✓</button>`);
            return;
        }
        const t = un('task', S.user.uid).find(x => x.seen === false && !seen.has(x.id));
        if (!t)
            return;
        seen.add(t.id);
        popup(`<h3>📌 Naya kaam mila hai</h3><p class="note">${esc(t.shift)} · ${fd(t.date)}</p><p style="font-size:18px;word-break:break-word">${esc(t.text)}</p>
<button class="b" style="width:100%" data-a="ack" data-u="${t.uid}" data-id="${t.id}">Samajh gaya ✓</button>`);
    }

    function ownerView() {
        const ws = Object.keys(S.workers).map(W).sort((a, b) => a.name.localeCompare(b.name)), P = pendingAll();
        const T = ws.reduce((a, w) => {
            const c = calc(w, S.month);
            a.n += c.total;
            a.p += c.paid;
            return a;
        }, { n: 0, p: 0 });
        let b = '';
        if (S.sel && S.workers[S.sel]) {
            const w = W(S.sel), c = calc(w, S.month);
            b = `<button class="b s sm" data-a="back">← Wapas</button><div class="gl" style="margin-top:12px"><div class="row">${avatar(w)}<div class="f"><h3>${esc(w.name)}</h3><div class="note">${esc(w.role || '')} · ${esc(w.phone || '')} · Salary ${inr(w.salary)}/mahina</div></div></div>
  <div class="row wr" style="margin-top:12px"><button class="b sm" data-a="addpay">+ Payment</button><button class="b s sm" data-a="addleave">+ Chhutti</button><button class="b s sm" data-a="addtask" data-u="${w.uid}">+ Kaam</button><button class="b s sm" data-a="remind">WhatsApp</button><button class="b s sm" data-a="salary">Profile edit</button><button class="b d sm" data-a="delw">Delete</button></div></div>
  ${monthNav(w)}${sumCards(c)}<div class="gl"><h3>Payments</h3>${un('pay', w.uid).filter(p => inP(w, S.month, p.date)).map(p => payRow(p, 1)).join('') || '<div class="empty">Is mahine koi payment nahi.</div>'}</div>
  <div class="gl"><h3>Chhuttiyan</h3>${un('leave', w.uid).filter(l => inP(w, S.month, l.date)).map(l => leaveRow(l, 1)).join('') || '<div class="empty">Is mahine koi chhutti nahi.</div>'}</div>`;
        }
        else if (S.tab === 'sites') {
            b = `<div class="row sp" style="margin-bottom:12px"><h3>Sites</h3><button class="b sm" data-a="addsite">+ Nayi site</button></div>${siteList(() => true).map(x => siteRow(x, 1)).join('') || '<div class="gl empty">Abhi koi site nahi. "+ Nayi site" se banayein.</div>'}`;
        }
        else if (S.tab === 'tasks') {
            const t = Object.keys(S.task).flatMap(u => un('task', u)).filter(x => x.date === td() || !x.done).sort((a, b) => b.date.localeCompare(a.date));
            b = `<div class="row sp" style="margin-bottom:12px"><h3>Kaam / Instructions</h3><button class="b sm" data-a="addtask">+ Naya kaam</button></div><div class="gl">${t.map(x => taskRow(x, 1)).join('') || '<div class="empty">Aaj ka koi kaam nahi diya.</div>'}</div>`;
        }
        else if (S.tab === 'req') {
            const r = [...Object.keys(S.req).flatMap(u => un('req', u)).map(x => ({ ...x, kind: 'pay' })), ...Object.keys(S.lreq).flatMap(u => un('lreq', u)).map(x => ({ ...x, kind: 'leave' }))].sort((a, b) => b.at - a.at);
            b = `<h3 style="margin-bottom:12px">Requests (paise + chhutti)</h3><div class="gl">${r.map(x => x.kind === 'pay' ? reqRow(x, 1) : lreqRow(x, 1)).join('') || '<div class="empty">Koi request nahi.</div>'}</div>`;
        }
        else if (S.tab === 'team') {
            b = `<div class="row sp" style="margin-bottom:12px"><h3>Team (${ws.length})</h3><button class="b sm" data-a="addw">+ Worker</button></div>${ws.map(w => {
                const c = calc(w, S.month);
                return `<div class="gl" data-a="open" data-id="${w.uid}" style="cursor:pointer"><div class="row">${avatar(w)}<div class="f"><b>${esc(w.name)}</b><div class="note">${esc(w.role || '')} · ${inr(w.salary)}</div></div><div style="text-align:right"><b class="${c.baaki > 0 ? 'gd' : 'ok'}">${inr(c.baaki)}</b><div class="k">baaki</div></div></div><div class="bar"><i style="width:${c.pct}%"></i></div></div>`;
            }).join('') || '<div class="gl empty">Pehle worker add karein.</div>'}`;
        }
        else {
            b = `${P.length ? `<div class="gl" data-a="tab" data-id="req" style="cursor:pointer;border-color:var(--amb)"><b style="color:var(--amb)">🔔 ${P.length} request aapke jawab ka intezaar kar rahi hai</b><div class="note">Dekhne ke liye dabayein</div></div>` : ''}${monthNav()}
  <div class="grid">${stat('Team', ws.length)}${stat('Kul payable', inr(T.n))}${stat('Diye gaye', inr(T.p), 'ok')}${stat('Baaki', inr(T.n - T.p), 'gd')}</div>
  <div class="gl"><h3 style="margin-bottom:6px">Team ka hisaab</h3>${ws.map(w => {
                const c = calc(w, S.month);
                return `<div class="it" data-a="open" data-id="${w.uid}" style="cursor:pointer"><div class="row sp"><b>${esc(w.name)}</b><span class="note">${inr(c.paid)} / ${inr(c.net)}</span></div><div class="bar"><i style="width:${c.pct}%"></i></div></div>`;
            }).join('') || '<div class="empty">Abhi koi worker nahi.</div>'}</div>
  <button class="b s" data-a="csv" style="width:100%">⬇ Is mahine ki report (CSV)</button>${notifCard()}`;
        }
        return top() + `<div class="wrap">${b}</div>` + nav([['home', 'Overview'], ['team', 'Team'], ['tasks', 'Kaam'], ['sites', 'Sites'], ['req', 'Requests' + (P.length ? ' (' + P.length + ')' : '')]]);
    }
    function workerView() {
        if (S.me === undefined)
            return top() + '<div class="empty">Load ho raha hai...</div>';
        if (!S.me)
            return top() + '<div class="wrap"><div class="gl empty">Aapka account abhi owner ne team mein add nahi kiya hai.</div></div>';
        const w = W(S.user.uid), c = calc(w, S.month);
        let b = '';
        if (S.tab === 'sites') {
            b = `<h3 style="margin-bottom:12px">Meri Sites</h3>${siteList(() => true).map(x => siteRow(x, 0)).join('') || '<div class="gl empty">Abhi aapko koi site nahi saunpi gayi.</div>'}`;
        }
        else if (S.tab === 'tasks') {
            const t = un('task', w.uid).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
            b = `<h3 style="margin-bottom:12px">Aapka kaam</h3><div class="gl">${t.map(x => taskRow(x, 0)).join('') || '<div class="empty">Abhi koi instruction nahi.</div>'}</div>`;
        }
        else if (S.tab === 'req') {
            const all = [...un('req', w.uid).map(x => ({ ...x, kind: 'pay' })), ...un('lreq', w.uid).map(x => ({ ...x, kind: 'leave' }))].sort((a, b) => b.at - a.at);
            b = `<div class="row wr" style="margin-bottom:12px"><button class="b sm" data-a="mkreq">+ Paison ki request</button><button class="b s sm" data-a="mklreq">+ Chhutti ki request</button></div><div class="gl">${all.map(x => x.kind === 'pay' ? reqRow(x, 0) : lreqRow(x, 0)).join('') || '<div class="empty">Koi request nahi.</div>'}</div><button class="b s" data-a="wowner" style="width:100%">WhatsApp par owner ko reminder</button>`;
        }
        else {
            const tt = un('task', w.uid).filter(t => t.date === td());
            b = `<div class="gl"><div style="float:right">${avatar(w, 1)}</div><div class="k">Namaste</div><h1 style="font-size:34px" class="gd">${esc(w.name)}</h1><div class="note">${esc(w.role || '')} · Salary ${inr(w.salary)}/mahina</div></div>${tt.length ? `<div class="gl"><h3>Aaj ka kaam</h3>${tt.map(x => taskRow(x, 0)).join('')}</div>` : ''}${monthNav(w)}${sumCards(c)}
  <div class="gl"><h3>Mile hue paise</h3>${un('pay', w.uid).filter(p => inP(w, S.month, p.date)).map(p => payRow(p, 0)).join('') || '<div class="empty">Is mahine abhi kuch nahi mila.</div>'}</div>
  <div class="gl"><h3>Meri chhuttiyan</h3>${un('leave', w.uid).filter(l => inP(w, S.month, l.date)).map(l => leaveRow(l, 0)).join('') || '<div class="empty">Is mahine koi chhutti nahi.</div>'}</div>${notifCard()}`;
        }
        return top() + `<div class="wrap">${b}</div>` + nav([['home', 'Mera Hisaab'], ['tasks', 'Kaam'], ['sites', 'Sites'], ['req', 'Request']]);
    }
    const photos = () => (typeof LOGIN_PHOTOS !== 'undefined' && Array.isArray(LOGIN_PHOTOS) ? LOGIN_PHOTOS : []).filter(u => /^https:\/\//.test(u)).slice(0, 5);
    const slidesHtml = () => photos().length ? `<div class="slides">${photos().map((u, i) => `<img class="${i ? '' : 'on'}" src="${esc(u)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`).join('')}</div>` : '';
    let slideT = null;
    const loginView = () => `<div class="login ${photos().length ? 'has-photos' : ''}">
<div class="hero">
${slidesHtml()}
<svg class="bp" viewBox="0 0 330 232" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<defs>
<linearGradient id="gls" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7f9bff" stop-opacity=".30"/><stop offset="1" stop-color="#d8b56a" stop-opacity=".10"/></linearGradient>
<linearGradient id="glr" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".38"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<clipPath id="cp"><rect x="70" y="32" width="200" height="136"/></clipPath>
</defs>
<rect x="70" y="32" width="200" height="136" fill="url(#gls)" stroke="#d8b56a" stroke-width="3.5" rx="2"/>
<g clip-path="url(#cp)"><polygon class="glare" points="0,32 44,32 18,168 -26,168" fill="url(#glr)"/></g>
<rect x="77" y="39" width="186" height="122" fill="none" stroke="#d8b56a" stroke-opacity=".5"/>
<line x1="170" y1="32" x2="170" y2="168" stroke="#d8b56a" stroke-width="3.5"/>
<line x1="70" y1="72" x2="270" y2="72" stroke="#d8b56a" stroke-opacity=".6" stroke-width="2"/>
<g stroke="#d8b56a" stroke-opacity=".55" stroke-width="1"><line x1="70" y1="196" x2="270" y2="196"/><line x1="70" y1="189" x2="70" y2="203"/><line x1="270" y1="189" x2="270" y2="203"/>
<line x1="44" y1="32" x2="44" y2="168"/><line x1="37" y1="32" x2="51" y2="32"/><line x1="37" y1="168" x2="51" y2="168"/>
<line x1="70" y1="172" x2="70" y2="190" stroke-dasharray="2 3"/><line x1="270" y1="172" x2="270" y2="190" stroke-dasharray="2 3"/></g>
<g fill="#d8b56a" font-size="11" font-family="Manrope,sans-serif" text-anchor="middle"><text x="170" y="218">2400 mm</text><text transform="translate(27 100) rotate(-90)">1500 mm</text></g>
</svg>
<div class="brand">AK Fabricator<small>Aluminium · Glass · Interior</small></div>
<div class="chips"><span>Aluminium</span><span>Glass</span><span>Interior</span></div>
<p class="note" style="margin:12px 0 0">Ghanshyam Chauhan · Team Ledger</p>
</div>
<form class="gl" id="lg"><label style="margin:0">Email</label><input name="e" type="email" required autocomplete="username"><label>Password</label><input name="p" type="password" required autocomplete="current-password">
<button class="b" style="width:100%;margin-top:18px">Login</button><button type="button" class="b s" style="width:100%;margin-top:10px" data-a="forgot">Password bhool gaye?</button></form>
<p class="c" style="text-align:center"><a class="note" href="${SHOP_MAP}" target="_blank" rel="noopener">📍 Shop ka location dekhein</a></p></div>`;
    function render() {
        if (!S.ready)
            return;
        $('#app').innerHTML = !S.user ? loginView() : S.owner ? ownerView() : workerView();
        setTimeout(checkPopups, 0);
        clearInterval(slideT);
        if (document.querySelectorAll('.slides img').length > 1) {
            let k = 0;
            slideT = setInterval(() => {
                const im = document.querySelectorAll('.slides img');
                if (!im.length)
                    return clearInterval(slideT);
                im[k % im.length].classList.remove('on');
                k = (k + 1) % im.length;
                im[k].classList.add('on');
            }, 3500);
        }
        const l = $('#lg');
        if (l)
            l.onsubmit = async (e) => {
                e.preventDefault();
                try {
                    await auth.signInWithEmailAndPassword(l.e.value.trim(), l.p.value);
                }
                catch (x) {
                    toast(errm(x), 1);
                }
            };
    }
    /* ---- actions ---- */
    const rowsPay = (p, w) => [['Worker', w.name], ['Amount', inr(p.amount)], ['Tareekh', fd(p.date)], ['Tareeka', p.mode], ['Note', p.note || '-']];
    function payForm(uid, amt, reqId) {
        const w = W(uid), c = calc(w, S.month);
        form('Payment add karein', [{
                n: 'amount', l: `Amount (₹) · is mahine baaki ${inr(c.baaki)}`, t: 'number', v: amt || ''
            }, {
                n: 'date', l: 'Tareekh', t: 'date', v: td()
            }, {
                n: 'mode', l: 'Kaise diye', o: [['Cash', 'Cash'], ['UPI', 'UPI'], ['Bank', 'Bank transfer']]
            }, {
                n: 'note', l: 'Note (optional)', v: '', r: 0
            }], async (d) => {
            const p = {
                amount: +d.amount, date: d.date, mode: d.mode, note: d.note.trim(), at: Date.now()
            };
            if (!(p.amount > 0))
                return toast('Sahi amount likhein.', 1);
            const over = p.amount > Math.max(0, calc(w, pkey(w, d.date)).baaki);
            if (!await ask(over ? '⚠ Baaki se zyada payment' : 'Payment confirm karein', [...rowsPay(p, w), ...(over ? [['Dhyan', 'Ye salary limit se zyada hai (advance)']] : [])], 'Haan, save karein'))
                return payForm(uid, amt, reqId);
            await db.ref('payments/' + uid).push(p);
            ping(tWorker(uid), 'Payment mili', `${inr(p.amount)} (${p.mode}) aapke hisaab mein jude`);
            if (reqId)
                await db.ref(`requests/${uid}/${reqId}/status`).set('paid');
            modal();
            toast('Payment save ho gayi.');
        });
    }
    /* ---- Back button: phone ka back sirf pichli screen par jaaye, poori site se bahar nahi ---- */
    history.replaceState({ tab: 'home', sel: null }, '');
    function go(tab, sel) {
        S.tab = tab;
        S.sel = sel;
        history.pushState({ tab, sel }, '');
        render();
    }
    window.addEventListener('popstate', e => {
        if ($('#modal').innerHTML) {
            $('#modal').innerHTML = '';
            history.pushState({ tab: S.tab, sel: S.sel }, '');
            return;
        }
        const st = e.state || { tab: 'home', sel: null };
        S.tab = st.tab;
        S.sel = st.sel;
        render();
    });
    const A = {
        out: () => auth.signOut(), close: () => modal(),
        back: () => { if (history.state && history.state.sel) history.back(); else go(S.tab, null); },
        open: d => go(S.tab, d.id),
        tab: d => { if (d.id !== S.tab || S.sel) go(d.id, null); },
        home: () => { modal(); if (S.tab !== 'home' || S.sel) go('home', null); window.scrollTo(0, 0); },
        snooze: () => modal(),
        ack: d => { db.ref(`tasks/${d.u}/${d.id}/seen`).set(true); modal(); },
        mo: d => {
            const [y, m] = S.month.split('-').map(Number), n = new Date(y, m - 1 + +d.id, 1);
            S.month = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
            render();
        },
        async forgot() {
            const e = $('#lg').e.value.trim();
            if (!e)
                return toast('Pehle email likhein.', 1);
            await auth.sendPasswordResetEmail(e);
            toast('Reset link email par bhej diya.');
        },
        addpay: () => payForm(S.sel), payreq: d => payForm(d.u, S.req[d.u][d.id].amount, d.id),
        addleave: () => {
            const w = W(S.sel);
            form('Chhutti add karein', [{
                    n: 'date', l: 'Tareekh', t: 'date', v: td()
                }, {
                    n: 'days', l: 'Kitne din (aadha din = 0.5)', t: 'number', v: 1
                }, {
                    n: 'paid', l: 'Salary katni hai?', o: [['0', 'Haan, salary kategi (bina paid)'], ['1', 'Nahi, paid chhutti']]
                }, {
                    n: 'note', l: 'Wajah (optional)', v: '', r: 0
                }], async (d) => {
                const l = {
                    date: d.date, days: +d.days, paid: d.paid === '1', note: d.note.trim()
                };
                if (!(l.days > 0))
                    return toast('Din sahi likhein.', 1);
                if (!await ask('Chhutti confirm karein', [['Worker', w.name], ['Tareekh', fd(l.date)], ['Din', l.days], ['Salary kategi', l.paid ? 'Nahi' : 'Haan ≈ ' + inr(calc(w, pkey(w, d.date)).per * l.days)]], 'Haan, add karein'))
                    return;
                await db.ref('leaves/' + S.sel).push(l);
                modal();
                toast('Chhutti add ho gayi.');
            });
        },
        salary: () => {
            const w = W(S.sel);
            form('Profile badlein', [
                { n: 's', l: 'Salary (₹/mahina)', t: 'number', v: w.salary },
                { n: 'cycle', l: 'Mahina kis tareekh se shuru hota hai (1 se 28)', t: 'number', v: cyc(w) },
                { n: 'photo', l: 'Photo ka link (https://...)', t: 'url', v: w.photo || '', r: 0 },
                { n: 'joined', l: 'Hisaab kis tareekh se shuru (pichla baaki yahin se judta hai)', t: 'date', v: w.joined || td() }
            ], async (d) => {
                const ph = d.photo.trim();
                if (ph && !/^https:\/\//.test(ph))
                    return toast('Photo link https:// se shuru hona chahiye.', 1);
                await db.ref(`workers/${S.sel}`).update({ salary: +d.s, cycle: Math.min(28, Math.max(1, Math.round(+d.cycle) || 1)), photo: ph, joined: d.joined || w.joined || td() });
                modal();
                toast('Profile update ho gaya.');
            });
        },
        addw: () => form('Naya worker', [{ n: 'name', l: 'Naam' }, {
                n: 'role', l: 'Kaam / Role', r: 0
            }, {
                n: 'phone', l: 'Phone', t: 'tel', r: 0
            }, {
                n: 'salary', l: 'Salary (₹/mahina)', t: 'number'
            }, {
                n: 'email', l: 'Login email', t: 'email'
            }, { n: 'pass', l: 'Password (kam se kam 6)' }, { n: 'cycle', l: 'Mahina kis tareekh se shuru hota hai (1 se 28)', t: 'number', v: 1 }, { n: 'photo', l: 'Photo ka link (optional)', t: 'url', r: 0 }, { n: 'joined', l: 'Kaam shuru hone ki tareekh', t: 'date', v: td() }], async (d) => {
            const sec = firebase.apps.find(a => a.name === 'sec') || firebase.initializeApp(cfg, 'sec');
            /* Agar pehli koshish mein Auth account ban gaya tha par worker list mein save nahi hua,
               to email "pehle se hai" aata hai. Us case mein wahi password se andar jaakar
               worker ka profile poora kar dete hain. */
            let c;
            try {
                c = await sec.auth().createUserWithEmailAndPassword(d.email.trim(), d.pass);
            }
            catch (err) {
                if (err.code !== 'auth/email-already-in-use')
                    throw err;
                try {
                    c = await sec.auth().signInWithEmailAndPassword(d.email.trim(), d.pass);
                }
                catch (e2) {
                    throw new Error('Ye email Firebase mein pehle se hai. Ya to wahi password daalein jo pehle rakha tha, ya Firebase Console > Authentication > Users mein is email ko delete karein.');
                }
                const old = await db.ref('workers/' + c.user.uid).once('value');
                if (old.exists()) {
                    await sec.auth().signOut();
                    throw new Error('Ye worker pehle se team mein hai.');
                }
            }
            await sec.auth().signOut();
            await db.ref('workers/' + c.user.uid).set({
                name: d.name.trim(), role: d.role.trim(), phone: d.phone.trim(), salary: +d.salary, email: d.email.trim().toLowerCase(), joined: d.joined || td(), cycle: Math.min(28, Math.max(1, Math.round(+d.cycle) || 1)), photo: (d.photo || '').trim()
            });
            modal();
            toast('Worker add ho gaya.');
        }, 'Worker banayein'),
        async delw() {
            const w = W(S.sel);
            if (!await ask('Worker delete karein?', [['Naam', w.name], ['Dhyan', 'Iska poora hisaab delete hoga']], 'Haan, delete karein', 1))
                return;
            for (const n of ['payments', 'leaves', 'requests', 'leaveRequests', 'tasks', 'mySites'])
                await db.ref(`${n}/${S.sel}`).remove();
            for (const [id, x] of Object.entries(S.site))
                if (teamOf(x).includes(S.sel))
                    await syncTeam(id, x, teamOf(x).filter(u => u !== S.sel));
            await db.ref('workers/' + S.sel).remove();
            history.back();
            toast('Worker delete ho gaya.');
        },
        async del(d) {
            if (!await ask('Delete karein?', [['Cheez', {
                        payments: 'Payment', leaves: 'Chhutti', tasks: 'Kaam'
                    }[d.n]]], 'Haan, delete karein', 1))
                return;
            await db.ref(`${d.n}/${d.u}/${d.id}`).remove();
            toast('Delete ho gaya.');
        },
        addtask: d => form('Kaam / Instruction', [{
                n: 'to', l: 'Kisko', o: [['all', 'Sabko'], ...Object.keys(S.workers).map(u => [u, S.workers[u].name])], v: d.u || 'all'
            }, {
                n: 'shift', l: 'Kab', o: [['Subah aate hi', 'Subah aate hi'], ['Dopahar', 'Dopahar'], ['Shaam', 'Shaam'], ['Band karte waqt', 'Band karte waqt'], ['Other', 'Other (time khud likhein)']]
            }, {
                n: 'date', l: 'Tareekh', t: 'date', v: td()
            }, {
                n: 'time', l: 'Time (jab "Other" chuna ho)', t: 'time', r: 0
            }, {
                n: 'text', l: 'Kya karna hai', t: 'area'
            }], async (d) => {
            const t = {
                text: d.text.trim(), shift: d.shift === 'Other' ? (d.time ? 'Time ' + fmt12(d.time) : 'Other') : d.shift, date: d.date, done: false, seen: false, at: Date.now()
            }, to = d.to === 'all' ? Object.keys(S.workers) : [d.to];
            for (const u of to) {
            await db.ref('tasks/' + u).push(t);
            ping(tWorker(u), 'Naya kaam', `${t.shift}: ${t.text}`);
        }
            modal();
            toast('Kaam de diya gaya.');
        }, 'Bhejein'),
        done: d => db.ref(`tasks/${d.u}/${d.id}/done`).set(!S.task[d.u][d.id].done),
        async rej(d) {
            const r = S.req[d.u][d.id];
            if (!await ask('Request reject karein?', [['Worker', W(d.u).name], ['Amount', inr(r.amount)], ['Wajah', r.note || '-']], 'Haan, reject karein', 1))
                return;
            await db.ref(`requests/${d.u}/${d.id}/status`).set('rejected');
            ping(tWorker(d.u), 'Paison ki request reject', `${inr(r.amount)} ki request abhi manzoor nahi hui`);
            toast('Request reject ho gayi.');
        },
        addsite: () => form('Nayi site', [{ n: 'name', l: 'Site ka naam' }, { n: 'address', l: 'Pata (likhkar)', r: 0 },
            { n: 'map', l: 'Google Maps ka link (optional)', t: 'url', r: 0 }, { n: 'note', l: 'Note (optional)', t: 'area', r: 0 },
            { n: 'team', l: 'Kin-kin ko saunpni hai (ek se zyada chun sakte hain)', c: Object.keys(S.workers).map(u => [u, S.workers[u].name]) }], async (d) => {
            const mp = d.map.trim();
            if (mp && !/^https:\/\//.test(mp))
                return toast('Map link https:// se shuru hona chahiye.', 1);
            const x = { name: d.name.trim(), address: d.address.trim(), map: mp, note: d.note.trim(), status: 'chalu', at: Date.now() };
            const r = db.ref('sites').push();
            await r.set(x);
            await syncTeam(r.key, x, d.team);
            modal();
            toast('Site save ho gayi.');
        }, 'Site banayein'),
        assign: d => {
            const x = S.site[d.id];
            form('Site kin-kin ko saunpein?', [{ n: 'team', l: x.name, c: Object.keys(S.workers).map(u => [u, S.workers[u].name]), v: teamOf(x) }], async (f) => {
                const names = f.team.map(u => W(u).name).join(', ') || 'Kisi ko nahi';
                if (!await ask('Site saunpein?', [['Site', x.name], ['Kin ko', names]], 'Haan, saunpein'))
                    return;
                await syncTeam(d.id, x, f.team);
                modal();
                toast('Site saunp di gayi.');
            }, 'Aage badhein');
        },
        async sstatus(d) {
            const x = S.site[d.id], st = x.status === 'done' ? 'chalu' : 'done';
            await db.ref('sites/' + d.id + '/status').set(st);
            for (const u of teamOf(x))
                await db.ref(`mySites/${u}/${d.id}/status`).set(st);
        },
        async delsite(d) {
            const x = S.site[d.id];
            if (!await ask('Site delete karein?', [['Site', x.name]], 'Haan, delete karein', 1))
                return;
            for (const u of teamOf(x))
                await db.ref(`mySites/${u}/${d.id}`).remove();
            await db.ref('sites/' + d.id).remove();
            toast('Site delete ho gayi.');
        },
        sack: d => { db.ref(`mySites/${S.user.uid}/${d.id}/seen`).set(true); modal(); },
        pingtest: () => {
            ping(S.owner ? tOwner() : tWorker(S.user.uid), 'Test notification', 'Agar ye awaaz ke saath aaya to setup sahi hai.');
            toast('Test bhej diya. Phone par 5-10 second mein aana chahiye.');
        },
        copytopic: async () => {
            try {
                await navigator.clipboard.writeText(S.owner ? tOwner() : tWorker(S.user.uid));
                toast('Topic copy ho gaya.');
            }
            catch (e) {
                toast('Copy nahi hua, topic haath se likh lein.', 1);
            }
        },
        mklreq: () => form('Chhutti ki request', [{ n: 'date', l: 'Kis tareekh se', t: 'date', v: td() }, { n: 'days', l: 'Kitne din (aadha din = 0.5)', t: 'number', v: 1 }, { n: 'note', l: 'Wajah', t: 'area' }], async (d) => {
            const r = { date: d.date, days: +d.days, note: d.note.trim(), status: 'pending', at: Date.now() };
            if (!(r.days > 0))
                return toast('Din sahi likhein.', 1);
            if (!await ask('Owner ko chhutti ki request bhejein?', [['Tareekh', fd(r.date)], ['Din', r.days], ['Wajah', r.note || '-']], 'Haan, bhejein'))
                return;
            await db.ref('leaveRequests/' + S.user.uid).push(r);
            ping(tOwner(), 'Chhutti ki request', `${S.me.name}: ${r.days} din (${fd(r.date)}) - ${r.note || ''}`);
            modal();
            toast('Chhutti ki request owner ko bhej di gayi.');
        }, 'Aage badhein'),
        async lrej(d) {
            const r = S.lreq[d.u][d.id];
            if (!await ask('Chhutti reject karein?', [['Worker', W(d.u).name], ['Tareekh', fd(r.date)], ['Din', r.days]], 'Haan, reject karein', 1))
                return;
            await db.ref(`leaveRequests/${d.u}/${d.id}/status`).set('rejected');
            ping(tWorker(d.u), 'Chhutti reject', `${fd(r.date)} ki chhutti manzoor nahi hui`);
            toast('Chhutti reject ho gayi.');
        },
        async lacc(d) {
            const r = S.lreq[d.u][d.id], paid = d.p === '1';
            if (!await ask('Chhutti manzoor karein?', [['Worker', W(d.u).name], ['Tareekh', fd(r.date)], ['Din', r.days], ['Salary kategi', paid ? 'Nahi (paid chhutti)' : 'Haan']], 'Haan, manzoor karein'))
                return;
            await db.ref('leaves/' + d.u).push({ date: r.date, days: r.days, paid, note: r.note || 'Request se manzoor' });
            await db.ref(`leaveRequests/${d.u}/${d.id}/status`).set('approved');
            ping(tWorker(d.u), 'Chhutti manzoor', `${r.days} din ki chhutti manzoor (${fd(r.date)})`);
            toast('Chhutti manzoor ho gayi.');
        },
        mkreq: () => form('Paison ki zaroorat', [{
                n: 'amount', l: 'Kitne paise chahiye (₹)', t: 'number'
            }, {
                n: 'note', l: 'Wajah', t: 'area'
            }], async (d) => {
            const r = {
                amount: +d.amount, note: d.note.trim(), status: 'pending', at: Date.now()
            };
            if (!(r.amount > 0))
                return toast('Sahi amount likhein.', 1);
            if (!await ask('Owner ko request bhejein?', [['Amount', inr(r.amount)], ['Wajah', r.note || '-']], 'Haan, bhejein'))
                return;
            await db.ref('requests/' + S.user.uid).push(r);
            ping(tOwner(), 'Paison ki request', `${S.me.name}: ${inr(r.amount)} - ${r.note || ''}`);
            modal();
            toast('Request owner ko bhej di gayi.');
        }, 'Aage badhein'),
        remind: () => {
            const w = W(S.sel), c = calc(w, S.month);
            wa(w.phone, `${w.name} ji, ${mname(S.month)} ka hisaab:\nSalary: ${inr(w.salary)}\nChhutti ki katauti: ${inr(c.cut)}\nPichla baaki: ${inr(c.carry)}\nAb tak diye: ${inr(c.paid)}\nBaaki: ${inr(c.baaki)}\n\nApna poora hisaab dekhne ke liye link par click karke login karein:\n${site()}`);
        },
        wowner: () => {
            const w = W(S.user.uid), c = calc(w, S.month);
            wa(OWNER_PHONE, `Sir, main ${w.name}. ${mname(S.month)} ka mera baaki ${inr(c.baaki)} hai (kul payable ${inr(c.total)}, mile ${inr(c.paid)}). Kripya payment kar dijiye.\n\nHisaab: ${site()}`);
        },
        csv: () => {
            const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"', rows = [['Worker', 'Salary', 'Katauti', 'Pichla baaki', 'Kul payable', 'Diye', 'Baaki'], ...Object.keys(S.workers).map(W).map(w => {
                    const c = calc(w, S.month);
                    return [w.name, w.salary, c.cut, c.carry, c.total, c.paid, c.baaki];
                })];
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob(['\ufeff' + rows.map(r => r.map(q).join(',')).join('\n')], { type: 'text/csv' }));
            a.download = `report-${S.month}.csv`;
            a.click();
        }
    };
    document.addEventListener('click', async (ev) => {
        const b = ev.target.closest('[data-a]');
        if (!b || !A[b.dataset.a])
            return;
        if (b.tagName === 'A')
            return;
        try {
            await A[b.dataset.a](b.dataset);
        }
        catch (e) {
            toast(errm(e), 1);
        }
    });
}

