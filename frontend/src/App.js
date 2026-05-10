import React, { useState, useEffect, useCallback, useMemo } from 'react';

// ─── STYLES (must be at top, before any component) ───────────────────────────
const S = {
    input:  { width:'100%', padding:'7px 10px', border:'1px solid #cbd5e1', borderRadius:6, fontSize:13, boxSizing:'border-box', background:'#fff', outline:'none', fontFamily:'inherit' },
    card:   { background:'#fff', border:'1px solid #e2e8f0', borderRadius:10, padding:20, marginBottom:16 },
    h2:     { margin:'0 0 16px', color:'#1e293b', fontSize:22, fontWeight:800 },
    lbl:    { display:'flex', flexDirection:'column', gap:5, fontSize:13, fontWeight:600, color:'#374151' },
    grid2:  { display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 },
    th:     { padding:'10px 12px', textAlign:'left', fontSize:12, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:0.5 },
    td:     { padding:'10px 12px', fontSize:13, color:'#1e293b', verticalAlign:'middle' },
    btnP:   { background:'#6366f1', color:'#fff', border:'none', padding:'8px 18px', borderRadius:7, cursor:'pointer', fontSize:13, fontWeight:700 },
    btnG:   { background:'#f1f5f9', color:'#374151', border:'1px solid #e2e8f0', padding:'8px 14px', borderRadius:7, cursor:'pointer', fontSize:13, fontWeight:600 },
    btnS:   { background:'#f1f5f9', color:'#374151', border:'1px solid #e2e8f0', padding:'4px 10px', borderRadius:5, cursor:'pointer', fontSize:12 },
    btnDel: { background:'#fee2e2', color:'#ef4444', border:'1px solid #fecaca', padding:'4px 10px', borderRadius:5, cursor:'pointer', fontSize:12 },
    msg:    { background:'#e0f2fe', border:'1px solid #7dd3fc', color:'#0369a1', padding:'10px 14px', borderRadius:7, marginBottom:12, fontSize:13 },
    tagBadge: { display:'inline-block', padding:'2px 6px', background:'#f1f5f9', border:'1px solid #e2e8f0', borderRadius:4, fontFamily:'monospace', fontSize:11, marginRight:5, marginBottom:5, color:'#475569' },
};

const fmt24 = (d) => {
    if (!d) return '—';
    try {
        const date = new Date(d);
        if (isNaN(date.getTime())) return '—';
        const pad = n => String(n).padStart(2, '0');
        const yr = date.getFullYear();
        const mo = pad(date.getMonth() + 1);
        const da = pad(date.getDate());
        const hr = pad(date.getHours());
        const mi = pad(date.getMinutes());
        const se = pad(date.getSeconds());
        return `${yr}-${mo}-${da} ${hr}:${mi}:${se}`;
    } catch { return '—'; }
};

// ─── API helper (never JSON.parse raw — avoids crash when backend returns HTML/text) ──
const API = process.env.REACT_APP_API_URL || 'http://localhost:3001';

const apiFetch = async (path, opts = {}) => {
    const headers = { ...(opts.headers || {}) };
    if (opts.body != null && !(opts.body instanceof FormData) && headers['Content-Type'] === undefined)
        headers['Content-Type'] = 'application/json';
    let r;
    try {
        r = await fetch(`${API}${path}`, { ...opts, headers });
    } catch (e) {
        return { success: false, error: `Network error: ${e.message || 'request failed'}` };
    }
    const text = await r.text();
    let data = {};
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            const snippet = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 280);
            return {
                success: false,
                error: snippet || `Non-JSON response (HTTP ${r.status}). Is the API running on ${API}?`,
                _httpStatus: r.status
            };
        }
    }
    if (!r.ok && data.success !== false && !data.error)
        data = { ...data, success: false, error: data.message || data.error || `HTTP ${r.status}` };
    return data;
};

// ─── Badge ────────────────────────────────────────────────────────────────────
const Badge = ({ status }) => {
    const colors = { running:'#22c55e', paused:'#f59e0b', draft:'#6b7280', scheduled:'#8b5cf6', completed:'#3b82f6', failed:'#ef4444' };
    return <span style={{ background:colors[status]||'#6b7280', color:'#fff', padding:'2px 10px', borderRadius:12, fontSize:12, fontWeight:700 }}>{status}</span>;
};

// ─── Default campaign form values ─────────────────────────────────────────────
const FORM_DEFAULTS = {
    name:'', return_path:'bounce@[domain]', from_name:'', from_email:'',
    reply_to:'', from_name_encoding:'base64',
    subject:'', subject_encoding:'base64',
    content_type:'text/html', charset:'UTF-8', ct_encoding:'8Bit Encoding',
    header_processing:'Default Process',
    header_sets: [{ id: 1, name: 'Header 1', enabled: true, content: 'Date: [smtp_date]\nMessage-Id: <{n,15}.{n,1}.{A,3}{n,10}@[domain]>\nTo: [to]\nFrom: [from]\nSubject: [subject]' }],
    active_header_set_idx: 0,
    from_lines:[''], use_smtp_email:false,
    subject_lines:[''], 
    header_rotation:1, header_body_separator:'\\n\\n', html_bodies:[''], body_rotation:1,
    url_format:'Format 1', placeholders:[], smtp_accounts:[], emails_per_smtp:100,
    change_interface_after:1, sending_script:'queue', send_speed:10, send_speed_unit:'minute',
    batch_size:100, batch_pause:1, batch_pause_unit:'minute', range_start_from:0,
    range_count:0, repeat:1, stop_after:0, launch_date:'',
    test_after_emails:100, test_email_destination:'', test_recipient_emails: '', verify_mailboxes:false, auto_reply_status:'disabled',
    auto_reply_randomize:'disabled', auto_reply_rotation:1, auto_reply_accounts:'',
    data_list_ids:[],
};

const withDefaults = (data) => {
    if (!data) return { ...FORM_DEFAULTS };
    return {
        ...FORM_DEFAULTS,
        ...data,
        name:           typeof data.name === 'string' ? data.name : '',
        reply_to:       typeof data.reply_to === 'string' ? data.reply_to : 'reply@[domain]',
        from_lines:     Array.isArray(data.from_lines)     ? data.from_lines     : (data.from_name ? [String(data.from_name)] : ['']),
        subject_lines:  Array.isArray(data.subject_lines)  ? data.subject_lines  : (data.subject_lines  ? [String(data.subject_lines)]  : ['']),
        html_bodies:    Array.isArray(data.html_bodies)     ? data.html_bodies    : (data.html_template  ? [String(data.html_template)]  : ['']),
        header_sets:    Array.isArray(data.header_sets)     ? data.header_sets    : FORM_DEFAULTS.header_sets,
        placeholders:   Array.isArray(data.placeholders)    ? data.placeholders   : [],
        smtp_accounts:  Array.isArray(data.smtp_accounts)
            ? data.smtp_accounts.map(id => parseInt(id, 10)).filter(n => !Number.isNaN(n))
            : [],
        data_list_ids: Array.isArray(data.data_list_ids)
            ? data.data_list_ids.map(id => parseInt(id, 10)).filter(n => !Number.isNaN(n))
            : [],
    };
};

const SUBJECT_EXAMPLE_PLACEHOLDER = 'Hello {{name}} — Your message here\nSecond subject line for rotation';
const BODY_EXAMPLE_PLACEHOLDER = '<p>Hi {{name}},</p>\n<p>Email: {{email}} · {{date}}</p>\n<p>Code: {a,6}{n,4} · {user}</p>';

// ═══════════════════════════════════════════════════════════════════════════════
//  SMTP PAGE
// ═══════════════════════════════════════════════════════════════════════════════
function SMTPPage() {
    const blank = { email:'', host:'smtp.office365.com', port:587, username:'', password:'', from_name:'', daily_limit:500 };
    const [accounts, setAccounts] = useState([]);
    const [form,     setForm]     = useState({ ...blank });
    const [editId,   setEditId]   = useState(null);
    const [msg,      setMsg]      = useState('');
    const [testing,  setTesting]  = useState({});
    const [selected, setSelected] = useState([]);
    const [bulkGoing,setBulkGoing]= useState(false);
    const [healthFilter, setHealthFilter] = useState('all'); // all | healthy | unhealthy | pending

    const load = useCallback(async () => {
        const d = await apiFetch('/api/smtp-accounts');
        setAccounts(d.accounts || []);
    }, []);
    useEffect(() => { load(); }, [load]);

    const filtered = useMemo(() => {
        if (healthFilter === 'all') return accounts;
        return accounts.filter(a => a.health_status === healthFilter);
    }, [accounts, healthFilter]);

    const counts = useMemo(() => ({
        healthy: accounts.filter(a => a.health_status === 'healthy').length,
        unhealthy: accounts.filter(a => a.health_status === 'unhealthy').length,
        pending: accounts.filter(a => a.health_status === 'pending').length,
    }), [accounts]);

    const resetForm = () => { setForm({ ...blank }); setEditId(null); };

    const save = async () => {
        if (!form.email || !form.password) { setMsg('❌ Email and password required'); return; }
        if (editId) { await apiFetch(`/api/smtp-accounts/${editId}`, { method:'PUT',  body:JSON.stringify(form) }); setMsg('✅ Updated'); }
        else        { await apiFetch('/api/smtp-accounts',            { method:'POST', body:JSON.stringify(form) }); setMsg('✅ Added'); }
        resetForm(); load();
    };

    const startEdit = (acc) => {
        setEditId(acc.id);
        setForm({ email:acc.email, host:acc.host, port:acc.port, username:acc.username||'', password:acc.password, from_name:acc.from_name||'', daily_limit:acc.daily_limit });
    };

    const del = async (id) => {
        if (!window.confirm('Delete?')) return;
        await apiFetch(`/api/smtp-accounts/${id}`, { method:'DELETE' });
        setSelected(s => s.filter(x => x !== id));
        load();
    };

    const testOne = async (id) => {
        setTesting(t => ({ ...t, [id]:'testing' }));
        const d = await apiFetch(`/api/smtp-accounts/${id}/test`, { method:'POST' });
        setTesting(t => ({ ...t, [id]: d.success ? 'ok' : 'fail' }));
        if (d.success && window.Toast) window.Toast.success(d.message || 'Connection successful!');
        load();
    };

    const bulkTest = async () => {
        if (!selected.length) { setMsg('Select accounts first'); return; }
        setBulkGoing(true);
        for (const id of selected) {
            setTesting(t => ({ ...t, [id]:'testing' }));
            const d = await apiFetch(`/api/smtp-accounts/${id}/test`, { method:'POST' });
            setTesting(t => ({ ...t, [id]: d.success ? 'ok' : 'fail' }));
        }
        setBulkGoing(false);
        const successMsg = `Tested ${selected.length} accounts`;
        setMsg(`✅ ${successMsg}`);
        if (window.Toast) window.Toast.success(successMsg);
        load();
    };

    const bulkDel = async () => {
        if (!selected.length) { setMsg('Select accounts first'); return; }
        if (!window.confirm(`Delete ${selected.length} accounts?`)) return;
        await apiFetch('/api/smtp-accounts/bulk-delete', { method:'POST', body:JSON.stringify({ ids:selected }) });
        setMsg(`✅ Deleted ${selected.length}`); setSelected([]); load();
    };

    const toggleOne = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
    const toggleAllFiltered = () => {
        const ids = filtered.map(a => a.id);
        if (!ids.length) return;
        const everyOn = ids.every(id => selected.includes(id));
        if (everyOn) setSelected(s => s.filter(id => !ids.includes(id)));
        else setSelected(s => [...new Set([...s, ...ids])]);
    };

    const importCSV = async (e) => {
        const f = e.target.files[0]; if (!f) return; e.target.value = '';
        const fd = new FormData(); fd.append('file', f);
        const d = await apiFetch('/api/smtp-accounts/bulk-import', { method:'POST', body:fd });
        if (!d.success && d.error) setMsg('❌ ' + d.error);
        else setMsg(`✅ Imported: ${d.imported ?? 0} | Failed: ${d.failed ?? 0}`);
        load();
    };

    const hc = { healthy:'#22c55e', unhealthy:'#ef4444', pending:'#f59e0b' };
    const filterBtn = (key, label) => (
        <button key={key} type="button" onClick={() => setHealthFilter(key)}
            style={{
                padding:'8px 14px', borderRadius:8, border:'1px solid #e2e8f0', cursor:'pointer', fontWeight:700, fontSize:12,
                background: healthFilter === key ? 'linear-gradient(135deg,#4f46e5,#7c3aed)' : '#fff',
                color: healthFilter === key ? '#fff' : '#475569',
                boxShadow: healthFilter === key ? '0 6px 16px rgba(79,70,229,.35)' : 'none'
            }}>{label}</button>
    );

    return (
        <div className="zack-send-root" style={{ fontSize: 13, color: '#1e293b', paddingBottom: 40 }}>
            <div className="zack-send-hero" style={{ marginBottom: 20 }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap: 14 }}>
                    <div>
                        <div style={{ fontSize: 11, opacity: 0.88, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 6 }}>Hikari Mail</div>
                        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5 }}>SMTP Accounts</div>
                        <div style={{ fontSize: 13, opacity: 0.9, marginTop: 6 }}>Manage sender identities and server configurations</div>
                    </div>
                <div style={{ display:'flex', gap:10 }}>
                    <div style={{ background:'#f0fdf4', color:'#166534', border:'1px solid #bbf7d0', padding:'8px 16px', borderRadius:8, fontSize:13, fontWeight:600 }}>✅ {counts.healthy} Valid</div>
                    <div style={{ background:'#fef2f2', color:'#991b1b', border:'1px solid #fecaca', padding:'8px 16px', borderRadius:8, fontSize:13, fontWeight:600 }}>❌ {counts.unhealthy} Invalid</div>
                    <div style={{ background:'#f1f5f9', color:'#475569', border:'1px solid #cbd5e1', padding:'8px 16px', borderRadius:8, fontSize:13, fontWeight:600 }}>⏳ {counts.pending} Unchecked</div>
                </div>
            </div>
            </div>

            {msg && <div style={{ ...S.msg, background: msg.includes('❌') ? '#fef2f2' : '#f0fdf4', color: msg.includes('❌') ? '#991b1b' : '#166534', borderColor: msg.includes('❌') ? '#fecaca' : '#bbf7d0', marginBottom: 20 }}>
                {msg} <button type="button" onClick={() => setMsg('')} style={{ float:'right', background:'none', border:'none', cursor:'pointer', fontSize:16, color:'inherit' }}>✕</button>
            </div>}

            <div className="portlet light bordered zack-panel" style={{ marginBottom: 24, borderTop: '4px solid #6366f1' }}>
                <div className="portlet-title">
                    <span className="caption-subject uppercase" style={{ color: '#6366f1', fontWeight: 800 }}>
                        <i className="fa fa-plus-circle" /> {editId ? 'Edit Configuration' : 'Add New Server'}
                    </span>
                </div>
                <div className="portlet-body" style={{ padding: '20px 25px' }}>
                    <div style={{ ...S.grid2, gap: 16 }}>
                        <label style={{ ...S.lbl, flex: 1 }}>Email Address *
                            <input style={{ ...S.input, padding: 10 }} value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="sender@domain.com" />
                        </label>

                        <label style={{ ...S.lbl, flex: 1 }}>SMTP Host
                            <input style={{ ...S.input, padding: 10 }} value={form.host} onChange={e => setForm(p => ({ ...p, host: e.target.value }))} />
                        </label>
                        
                        <label style={{ ...S.lbl, flex: 1 }}>Port
                            <input style={{ ...S.input, padding: 10 }} type="number" value={form.port} onChange={e => setForm(p => ({ ...p, port: e.target.value }))} />
                        </label>
                        <label style={{ ...S.lbl, flex: 1 }}>Username (blank = email)
                            <input style={{ ...S.input, padding: 10 }} value={form.username} onChange={e => setForm(p => ({ ...p, username: e.target.value }))} />
                        </label>
                        
                        <label style={{ ...S.lbl, flex: 1 }}>Password *
                            <input style={{ ...S.input, padding: 10 }} type="password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} />
                        </label>
                        <label style={{ ...S.lbl, flex: 1 }}>Daily Limit
                            <input style={{ ...S.input, padding: 10 }} type="number" value={form.daily_limit} onChange={e => setForm(p => ({ ...p, daily_limit: e.target.value }))} />
                        </label>
                    </div>
                    
                    <div style={{ marginTop:24, display:'flex', gap:10, alignItems:'center', borderTop:'1px solid #e2e8f0', paddingTop: 20 }}>
                        <button style={{ ...S.btnP, padding: '10px 24px' }} onClick={save}><i className="fa fa-check" /> {editId ? 'Update Config' : 'Save Account'}</button>
                        {editId && <button style={{ ...S.btnG, padding: '10px 20px' }} onClick={resetForm}>Cancel</button>}
                        
                        <div style={{ width:1, height:30, background:'#cbd5e1', margin:'0 10px' }}></div>
                        
                        <label style={{ ...S.btnG, cursor:'pointer', padding: '10px 20px', margin: 0 }}><i className="fa fa-file-excel-o" /> Bulk Import CSV
                            <input type="file" accept=".csv" style={{ display:'none' }} onChange={importCSV} />
                        </label>
                        <span style={{ marginLeft:'auto', fontSize:12, color:'#94a3b8', fontStyle: 'italic' }}>CSV Format: email, host, port, username, password, from_name, daily_limit</span>
                    </div>
                </div>
            </div>

            {accounts.length > 0 && (
                <div style={{ display:'flex', flexWrap:'wrap', justifyContent: 'space-between', alignItems:'flex-end', marginBottom: 12 }}>
                    <div style={{ display:'flex', gap:10, alignItems:'center' }}>
                        <span style={{ fontSize:13, fontWeight:700, color:'#475569', letterSpacing: 0.5, textTransform: 'uppercase' }}>Filter By:</span>
                        {filterBtn('all', `All (${accounts.length})`)}
                        {filterBtn('healthy', `Valid (${counts.healthy})`)}
                        {filterBtn('unhealthy', `Invalid (${counts.unhealthy})`)}
                        {filterBtn('pending', `Unchecked (${counts.pending})`)}
                    </div>
                </div>
            )}

            <div className="portlet light bordered zack-panel" style={{ padding: 0, overflow: 'hidden', borderLeft: '4px solid #94a3b8' }}>
                <div className="portlet-title" style={{ background: '#f8fafc' }}>
                    <div className="caption">
                        <span className="caption-subject uppercase" style={{ color: '#1e293b', fontWeight: 800 }}>
                            <i className="fa fa-server" /> Network Accounts
                        </span>
                    </div>
                    <div className="actions" style={{ display:'flex', gap:10, alignItems:'center' }}>
                        <span style={{ fontSize:13, color:'#94a3b8', marginRight: 10 }}>
                            {selected.length ? `${selected.length} items selected` : `Showing ${filtered.length} row(s)`}
                        </span>
                        {selected.length > 0 && (
                            <>
                                <button style={{ ...S.btnG, padding: '6px 14px', fontSize: 13 }} onClick={toggleAllFiltered}>Deselect</button>
                                <button style={{ ...S.btnP, padding: '6px 14px', fontSize: 13, background: '#3b82f6', borderColor: '#3b82f6' }} onClick={bulkTest} disabled={bulkGoing}>
                                    {bulkGoing ? 'Testing…' : <span><i className="fa fa-plug" /> Test Selected</span>}
                                </button>
                                <button style={{ ...S.btnDel, padding: '6px 14px', fontSize: 13 }} onClick={bulkDel}><i className="fa fa-trash" /> Delete Selected</button>
                            </>
                        )}
                    </div>
                </div>
                
                <div className="portlet-body" style={{ padding: 0 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                        <thead>
                            <tr style={{ background:'#f1f5f9', borderBottom:'1px solid #cbd5e1', textAlign:'left', color:'#475569' }}>
                                <th style={{ ...S.th, width:50, padding: '16px 20px', textAlign: 'center' }}>
                                    <input type="checkbox" checked={filtered.length > 0 && filtered.every(a => selected.includes(a.id))} onChange={toggleAllFiltered} />
                                </th>
                                {['Email Account','Host','Port','Sent / Limit','Health','Actions'].map(h => <th key={h} style={{ padding: '16px 10px', fontWeight: 600 }}>{h}</th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(acc => (
                                <tr key={acc.id} style={{ borderBottom: '1px solid #f1f5f9', background: selected.includes(acc.id) ? '#f0f9ff' : '#fff' }}>
                                    <td style={{ ...S.td, padding: '16px 20px', textAlign: 'center' }}><input type="checkbox" checked={selected.includes(acc.id)} onChange={() => toggleOne(acc.id)} /></td>
                                    <td style={{ ...S.td, padding: '16px 10px' }}><span style={{ fontWeight:700, color: '#334155' }}>{acc.email}</span></td>

                                    <td style={{ ...S.td, padding: '16px 10px', color: '#64748b' }}>{acc.host}</td>
                                    <td style={{ ...S.td, padding: '16px 10px', color: '#64748b' }}>{acc.port}</td>
                                    <td style={{ ...S.td, padding: '16px 10px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <span style={{ fontWeight: 600, color: '#0f172a' }}>{acc.sent_today}</span>
                                            <span style={{ color: '#94a3b8' }}>/</span>
                                            <span style={{ color: '#64748b' }}>{acc.daily_limit}</span>
                                        </div>
                                    </td>
                                    <td style={{ ...S.td, padding: '16px 10px' }}>
                                        <div style={{ display:'inline-block', padding: '4px 10px', borderRadius: 20, background: acc.health_status === 'healthy' ? '#dcfce7' : acc.health_status === 'unhealthy' ? '#fee2e2' : '#fef3c7', color: hc[acc.health_status] || '#d97706', fontWeight:600, fontSize: 13 }}>
                                            {acc.health_status === 'healthy' && <i className="fa fa-check" style={{ marginRight: 4 }} />}
                                            {acc.health_status === 'unhealthy' && <i className="fa fa-times" style={{ marginRight: 4 }} />}
                                            {acc.health_status === 'pending' && <i className="fa fa-clock-o" style={{ marginRight: 4 }} />}
                                            {acc.health_status}
                                        </div>
                                        {acc.last_tested && <div style={{ fontSize:11, color:'#94a3b8', marginTop:4, marginLeft: 2 }}>Tested: {fmt24(acc.last_tested)}</div>}
                                    </td>
                                    <td style={{ ...S.td, padding: '16px 10px' }}>
                                        <div style={{ display:'flex', gap:6 }}>
                                            <button style={{ ...S.btnS, padding: '6px 12px', fontSize: 13,
                                                background: testing[acc.id]==='ok'?'#d1fae5':testing[acc.id]==='fail'?'#fee2e2':'#f8fafc',
                                                borderColor: testing[acc.id]==='ok'?'#10b981':testing[acc.id]==='fail'?'#f87171':'#cbd5e1',
                                                color:      testing[acc.id]==='ok'?'#065f46':testing[acc.id]==='fail'?'#ef4444':'#475569' }}
                                                onClick={() => testOne(acc.id)} disabled={testing[acc.id] === 'testing'}>
                                                {testing[acc.id]==='testing'?'...':testing[acc.id]==='ok'?'✅ OK':testing[acc.id]==='fail'?'❌ Fail':'Test'}
                                            </button>
                                            <button style={{ ...S.btnG, padding: '6px 12px', fontSize: 13, margin: 0 }} onClick={() => startEdit(acc)}>⚙️ Edit</button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {!accounts.length && <tr><td colSpan={7} style={{ textAlign:'center', padding:60, color:'#94a3b8', fontSize: 15 }}>No SMTP accounts provisioned. Add above or bulk import from CSV.</td></tr>}
                            {accounts.length > 0 && !filtered.length && <tr><td colSpan={7} style={{ textAlign:'center', padding:60, color:'#94a3b8', fontSize: 15 }}>No accounts match this filter criteria.</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DUAL SELECT  (SMTP picker)
// ═══════════════════════════════════════════════════════════════════════════════
function DualSelect({ allAccounts, selected, onChange, renderItem, emptyText = 'No accounts available' }) {
    const [leftSel,  setLeftSel]  = useState([]);
    const [rightSel, setRightSel] = useState([]);
    const selNums = (selected || []).map(id => parseInt(id, 10)).filter(n => !Number.isNaN(n));
    const selSet  = new Set(selNums);
    const available = allAccounts.filter(a => !selSet.has(Number(a.id)));
    const chosen    = allAccounts.filter(a =>  selSet.has(Number(a.id)));

    const toggle = (setFn, id) => {
        const n = Number(id);
        setFn(prev => (prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n]));
    };

    const rowList = (items, picked, setPicked, emptyHint) => (
        <div role="listbox" style={{ width:'100%', height:170, border:'1px solid #cbd5e1', borderRadius:6, overflowY:'auto', fontSize:12, background:'#fff', userSelect:'none' }}>
            {!items.length && <div style={{ padding:12, color:'#94a3b8' }}>{emptyHint}</div>}
            {items.map(a => {
                const id   = Number(a.id);
                const isOn = picked.includes(id);
                return (
                    <div key={a.id} role="option" aria-selected={isOn} 
                        onMouseDown={() => toggle(setPicked, id)}
                        onMouseEnter={(e) => {
                            if (e.buttons === 1) {
                                if (!isOn) setPicked(prev => [...prev, id]);
                            } else {
                                if (!isOn) setPicked(prev => [...prev, id]);
                            }
                        }}
                        style={{ padding:'6px 8px', cursor:'pointer', borderBottom:'1px solid #f1f5f9', background: isOn ? '#e0e7ff' : 'transparent', display:'flex', alignItems:'center', gap:8 }}>
                        <span style={{ width:16, height:16, borderRadius:4, border:'2px solid #6366f1', background: isOn ? '#6366f1' : 'transparent', flexShrink:0 }} />
                        <span style={{ flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis' }}>
                            {renderItem ? renderItem(a) : (
                                <>{a.email} {a.health_status==='healthy'?'✅':a.health_status==='unhealthy'?'❌':'⏳'} [{a.sent_today}/{a.daily_limit}]</>
                            )}
                        </span>
                    </div>
                );
            })}
        </div>
    );

    return (
        <div>
            <div style={{ fontSize:11, color:'#64748b', marginBottom:6 }}>Move mouse over rows to highlight (or click), then use ▶ / ◀ to move.</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 48px 1fr', gap:8, alignItems:'center' }}>
                <div>
                    <div style={{ marginBottom:4, fontSize:12, fontWeight:600, color:'#64748b' }}>Available ({available.length})</div>
                    {rowList(available, leftSel, setLeftSel, emptyText)}
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:4, alignItems:'center' }}>
                    <button type="button" style={{ ...S.btnS, width:36 }} onClick={() => { onChange([...selNums, ...leftSel]); setLeftSel([]); }}>▶</button>
                    <button type="button" style={{ ...S.btnS, width:36 }} onClick={() => onChange(allAccounts.map(a => Number(a.id)))}>▶▶</button>
                    <button type="button" style={{ ...S.btnS, width:36 }} onClick={() => { onChange(selNums.filter(id => !rightSel.includes(id))); setRightSel([]); }}>◀</button>
                    <button type="button" style={{ ...S.btnS, width:36 }} onClick={() => onChange([])}>◀◀</button>
                </div>
                <div>
                    <div style={{ marginBottom:4, fontSize:12, fontWeight:600, color:'#64748b' }}>Selected ({chosen.length})</div>
                    {rowList(chosen, rightSel, setRightSel, 'None selected')}
                </div>
            </div>
        </div>
    );
}

function SectionBlock({ title, children }) {
    return (
        <div style={{ marginBottom:22 }}>
            <div style={{ fontWeight:700, fontSize:12, color:'#475569', textTransform:'uppercase', letterSpacing:1, marginBottom:10, borderBottom:'2px solid #e2e8f0', paddingBottom:5 }}>{title}</div>
            {children}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CAMPAIGN FORM — SMTP send (matches backend: buildCampaignFields + startSending)
// ═══════════════════════════════════════════════════════════════════════════════
function CampaignForm({ initial, allSmtps, onSaved, onCancel }) {
    const [form, setForm] = useState(() => withDefaults(initial));
    const [previewMode, setPreviewMode] = useState({});
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState('');
    const [showTags, setShowTags] = useState(false);
    const [activeBodyIdx, setActiveBodyIdx] = useState(0);
    const [pasteEmails, setPasteEmails] = useState(initial ? (initial.test_recipient_emails || '') : '');
    const [shortlinkGen, setShortlinkGen] = useState({ url: '', provider: 'is.gd', loading: false, result: '' });
    const [dataLists, setDataLists] = useState([]);
    const [slSettings, setSlSettings] = useState(null);
    const [cpSettings, setCpSettings] = useState(null);
    const [scLogs, setScLogs] = useState([]);
    const [slLogs, setSlLogs] = useState([]);
    const [tagInsert, setTagInsert] = useState({ tag: '', encoding: 'none', bypass: 'none' });

    const healthySmtps = useMemo(
        () => (allSmtps || []).filter(a => a.health_status === 'healthy'),
        [allSmtps]
    );

    useEffect(() => {
        apiFetch('/api/data-lists').then(r => {
            if (r.success) setDataLists(r.lists || []);
        }).catch(() => {});
        
        apiFetch('/api/shortlink-settings').then(r => {
            if (r.success) setSlSettings(r.settings);
        });
        apiFetch('/api/click-protection-settings').then(r => {
            if (r.success) setCpSettings(r.settings);
        });
        apiFetch('/api/suspicious-clicks').then(r => {
            if (r.success) setScLogs(r.clicks || []);
        });
        apiFetch('/api/shortlink-logs').then(r => {
            if (r.success) setSlLogs(r.logs || []);
        });
    }, []);

    useEffect(() => {
        setForm(withDefaults(initial));
        setPasteEmails('');
    }, [initial?.id ?? 'new']);

    useEffect(() => {
        if (!(allSmtps && allSmtps.length)) return;
        const ok = new Set(healthySmtps.map(a => a.id));
        setForm(prev => {
            const cur = prev.smtp_accounts || [];
            let next = cur.filter(id => ok.has(id));
            if (healthySmtps.length === 0 && cur.length) next = [];
            return next.length === cur.length ? prev : { ...prev, smtp_accounts: next };
        });
    }, [healthySmtps, allSmtps]);

    const pasteLineCount = pasteEmails.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).length;

    const upd = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

    const encodeHeaderStr = (text, type) => {
        if (!text) return '';
        const charset = form.charset || 'UTF-8';
        if (type === 'base64') {
            const b64 = btoa(unescape(encodeURIComponent(text)));
            return `=?${charset}?B?${b64}?=`;
        }
        if (type === 'quoted-printable') {
            let q = '';
            for (let i = 0; i < text.length; i++) {
                const c = text.charCodeAt(i);
                if (c === 32) q += '_';
                else if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) q += text[i];
                else q += '=' + c.toString(16).toUpperCase().padStart(2, '0');
            }
            return `=?${charset}?Q?${q}?=`;
        }
        return text;
    };

    const decodeHeaderStr = (str) => {
        if (!str || typeof str !== 'string') return str;
        const match = str.match(/=\?([^?]+)\?([QB])\?([^?]+)\?=/i);
        if (!match) return str;
        const [_, charset, encoding, data] = match;
        if (encoding.toUpperCase() === 'B') {
            try { return decodeURIComponent(escape(atob(data))); } catch (e) { return str; }
        }
        if (encoding.toUpperCase() === 'Q') {
            return data.replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/_/g, ' ');
        }
        return str;
    };

    const applyEncodingHS = (field, type) => {
        const next = [...form.header_sets];
        const currentSet = next[form.active_header_set_idx];
        const val = currentSet[field] || '';
        
        if (type === 'placeholder') {
            currentSet[field + '_encoding'] = 'placeholder';
            // Placeholder value will be resolved during rotation
        } else if (type === 'none') {
            currentSet[field] = decodeHeaderStr(val);
            currentSet[field + '_encoding'] = 'none';
        } else {
            const hasTags = val.includes('{{') || (val.includes('[') && val.includes(']'));
            if (hasTags) {
                currentSet[field] = `[[${type}:none:${val}]]`;
                currentSet[field + '_encoding'] = 'none';
            } else {
                currentSet[field] = encodeHeaderStr(val, type);
                currentSet[field + '_encoding'] = type;
            }
        }
        upd('header_sets', next);
        setPreviewMode({ ...previewMode, fromNameMenu: false, subjectMenu: false });
    };


    const applyEncoding = (field, type) => {
        const current = form[field] || '';
        if (type === 'none') {
            const decoded = decodeHeaderStr(current);
            upd(field, decoded);
            upd(`${field}_encoding`, 'none');
            setPreviewMode(p => ({ ...p, [`${field}Menu`]: false }));
            return;
        }
        const hasTags = current.includes('{{') || (current.includes('[') && current.includes(']'));
        if (hasTags) {
            upd(field, `[[${type}:none:${current}]]`);
            upd(`${field}_encoding`, 'none');
        } else {
            const encoded = encodeHeaderStr(current, type);
            upd(field, encoded);
            upd(`${field}_encoding`, type); 
        }
        setPreviewMode(p => ({ ...p, [`${field}Menu`]: false }));
    };

    const toggleDataList = (id) => {
        const n = parseInt(id, 10);
        if (Number.isNaN(n)) return;
        setForm(prev => {
            const cur = prev.data_list_ids || [];
            const set = new Set(cur);
            if (set.has(n)) set.delete(n); else set.add(n);
            return { ...prev, data_list_ids: [...set] };
        });
    };

    const generateShortlink = async () => {
        if (!shortlinkGen.url) { setMsg('❌ Enter an original URL first'); return; }
        setShortlinkGen(p => ({ ...p, loading: true, result: '' }));
        const r = await apiFetch('/api/shorten', { method: 'POST', body: JSON.stringify({ url: shortlinkGen.url, provider: shortlinkGen.provider }) });
        setShortlinkGen(p => ({ ...p, loading: false }));
        if (r.success) {
            setShortlinkGen(p => ({ ...p, result: r.short_url }));
            const activeBody = (form.html_bodies && form.html_bodies[activeBodyIdx]) || '';
            let nextBody = activeBody;
            if (nextBody.includes('{link}') || nextBody.includes('[domain]') || nextBody.includes('[url]')) {
                nextBody = nextBody.replace(/\{link\}/g, r.short_url);
                nextBody = nextBody.replace(/\[domain\]/g, r.short_url);
                nextBody = nextBody.replace(/\[url\]/g, r.short_url);
            } else {
                const textarea = document.getElementById(`html_editor_${activeBodyIdx}`);
                if (textarea) {
                    const start = textarea.selectionStart;
                    const end = textarea.selectionEnd;
                    nextBody = activeBody.substring(0, start) + r.short_url + activeBody.substring(end);
                } else {
                    nextBody += (nextBody ? '\n' : '') + r.short_url;
                }
            }
            const nb = [...form.html_bodies];
            nb[activeBodyIdx] = nextBody;
            upd('html_bodies', nb);
        } else {
            setMsg('❌ Shortening failed: ' + (r.error || 'unknown'));
        }
    };
    const insertAdvancedTag = (targetId) => {
        if (!tagInsert.tag) return;
        
        // Link tags and random tags use [tag] instead of {{tag}}
        const isBracketTag = tagInsert.tag.includes('_') || ['open','url','unsub','optout','short_open','short_url','short_unsub','short_optout','a','al','au','an','anl','anu','n','hu','hl','sp','sca'].includes(tagInsert.tag);
        
        let tagStr = '';
        if (isBracketTag) {
            const cleanTag = tagInsert.tag.replace(/[\[\]]/g, '');
            if (tagInsert.encoding !== 'none' || tagInsert.bypass !== 'none') {
                tagStr = `[[${tagInsert.encoding}:${tagInsert.bypass}:[${cleanTag}]]]`;
            } else {
                tagStr = `[${cleanTag}]`;
            }
        } else {
            tagStr = `[[${tagInsert.encoding}:${tagInsert.bypass}:{{${tagInsert.tag}}}]]`;
            // Simplified if no special treatment needed
            if (tagInsert.encoding === 'none' && tagInsert.bypass === 'none') {
                tagStr = `{{${tagInsert.tag}}}`;
            }
        }

        const textarea = document.getElementById(targetId);
        if (!textarea) return;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const val = textarea.value;
        const nextVal = val.substring(0, start) + tagStr + val.substring(end);
        
        if (targetId.startsWith('html_editor_')) {
            const nb = [...form.html_bodies];
            nb[activeBodyIdx] = nextVal;
            upd('html_bodies', nb);
        } else if (targetId === 'subject_editor') {
            const next = [...form.header_sets];
            next[form.active_header_set_idx].subject = nextVal;
            upd('header_sets', next);
        } else if (targetId === 'from_name_editor') {
            const next = [...form.header_sets];
            next[form.active_header_set_idx].from_name = nextVal;
            upd('header_sets', next);
        }
        
        setTimeout(() => {
            textarea.focus();
            textarea.setSelectionRange(start + tagStr.length, start + tagStr.length);
        }, 10);
    };

    const save = async (isSilent = false) => {
        const name = (form.name || '').trim() || 'New Campaign ' + Date.now();
        if (!name) { setMsg('❌ Campaign name is required'); return; }
        if (!(form.smtp_accounts || []).length) { setMsg('❌ Select at least one healthy SMTP account'); return; }
        setSaving(true);
        setMsg('');
        const subject_lines = (form.subject_lines || [])
            .map(s => String(s))
            .filter(s => s.trim() !== '');
        const data_list_ids = (form.data_list_ids || []).map(id => parseInt(id, 10)).filter(n => !Number.isNaN(n));
        const payload = {
            ...form,
            name,
            from_lines: (form.from_lines || []).filter(Boolean),
            subject_lines: subject_lines.length ? subject_lines : [''],
            data_list_ids,
            test_recipient_emails: pasteEmails
        };
        delete payload._total_recipients;
        const d = form.id
            ? await apiFetch(`/api/campaigns/${form.id}`, { method:'PUT',  body:JSON.stringify(payload) })
            : await apiFetch('/api/campaigns',             { method:'POST', body:JSON.stringify(payload) });
        if (!d.success) {
            setSaving(false);
            setMsg('❌ ' + (d.error || 'Save failed'));
            return;
        }
        const camp = d.campaign;
        const parts = [];

        if (data_list_ids.length) {
            const imp = await apiFetch(`/api/campaigns/${camp.id}/import-from-data-lists`, {
                method: 'POST',
                body: JSON.stringify({ list_ids: data_list_ids })
            });
            if (imp.success) parts.push(`lists +${imp.imported} emails`);
        }

        if (pasteEmails.trim()) {
            const pl = await apiFetch(`/api/campaigns/${camp.id}/recipients/from-lines`, {
                method: 'POST',
                body: JSON.stringify({ text: pasteEmails })
            });
            if (pl.success) parts.push(`paste +${pl.imported}`);
        }

        setSaving(false);
        if (isSilent) return camp;

        setMsg(parts.length ? `✅ Saved. ${parts.join(' · ')}` : '✅ Campaign saved.');
        onSaved(camp);
        return camp;
    };

    const saveAndSend = async () => {
        const camp = await save();
        if (!camp) return; 
        
        setMsg('🚀 Triggering send logic...');
        try {
            const d = await apiFetch(`/api/campaigns/${camp.id}/send`, { method: 'POST' });
            if (d.success) {
                const isScheduled = !!d.scheduled;
                const finalStatus = isScheduled ? 'scheduled' : 'running';
                const successMsg = d.message || (isScheduled ? '📅 Campaign scheduled!' : '✅ Campaign started!');
                setMsg(successMsg);
                
                // Update local campaigns list state so it shows up immediately
                setCampaigns(prev => prev.map(c => c.id === camp.id ? { ...c, status: finalStatus } : c));
                
                // If we are in the form, update form status too
                setForm(prev => ({ ...prev, status: finalStatus }));
                
                // Explicitly notify user via global message if needed
                if (window.Toast) window.Toast.success(successMsg);
            } else {
                setMsg('❌ ' + (d.error || 'Send trigger failed'));
            }
        } catch (e) {
            setMsg('❌ Network error during send');
        }
    };

    const ta = {
        ...S.input,
        fontFamily: 'ui-monospace, monospace',
        fontSize: 13,
        resize: 'vertical',
        borderRadius: 10,
        border: '1px solid #cbd5e1',
        padding: '12px 14px',
        boxShadow: 'inset 0 2px 4px rgba(15,23,42,0.04)'
    };

    const saveCp = async (key, val) => {
        const next = { ...cpSettings, [key]: val };
        const r = await apiFetch('/api/click-protection-settings', { method: 'PUT', body: JSON.stringify(next) });
        if (r.success) setCpSettings(r.settings);
    };

    const saveSl = async () => {
        const r = await apiFetch('/api/shortlink-settings', { method: 'PUT', body: JSON.stringify(slSettings) });
        if (r.success) setMsg('✅ Shortlink API settings saved');
    };

    const updSlProvider = (p, k, v) => setSlSettings(prev => ({
        ...prev,
        providers: {
            ...prev.providers,
            [p]: { ...prev.providers[p], [k]: v }
        }
    }));

    const selLists = new Set(form.data_list_ids || []);

    return (
        <div className="zack-send-root" style={{ fontSize: 13, color: '#1e293b' }}>
            <div className="zack-send-hero" style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
                    <div>
                        <div style={{ fontSize: 11, opacity: 0.88, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 6 }}>Hikari Mail</div>
                        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5 }}>Send campaign</div>
                        <div style={{ fontSize: 13, opacity: 0.9, marginTop: 6 }}>SMTP pipeline · subjects rotate · recipients from lists or paste</div>
                    </div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <button type="button" className="btn btn-outline btn-sm dark" style={{ borderColor: 'rgba(255,255,255,0.45)', color: '#fff', background: 'rgba(255,255,255,0.08)' }} onClick={onCancel}>
                            <i className="fa fa-arrow-left" /> Back
                        </button>
                        <button type="button" className="btn btn-outline btn-sm green" style={{ background: '#fff', color: '#4f46e5', border: 'none', fontWeight: 800 }} onClick={save} disabled={saving}>
                            {saving ? 'Saving…' : <span><i className="fa fa-bolt" /> Save & apply</span>}
                        </button>
                    </div>
                </div>
            </div>

            {msg && <div className={msg.startsWith('❌') || msg.startsWith('⚠️') ? 'ir-msg ir-msg-err' : 'ir-msg'} style={{ marginBottom: 14 }}>{msg}</div>}

            <div className="portlet light bordered zack-panel" style={{ marginBottom: 18, borderTop: '4px solid #22c55e' }}>
                <div className="portlet-body" style={{ padding: '15px 25px' }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                        <div style={{ width: 140, textAlign: 'right', paddingRight: 15, fontWeight: 'bold', fontSize: 13, color: '#333' }}>Campaign Name:</div>
                        <input style={{ flex: 1, border: '1px solid #ccc', padding: '5px 10px', fontSize: 13, color: '#333', outline: 'none' }} 
                            value={form.name || ''} onChange={e => upd('name', e.target.value)} placeholder="e.g., Marketing Drop September" />
                    </div>
                </div>
            </div>

            <div className="portlet light bordered zack-panel" style={{ marginBottom: 18, borderTop: '4px solid #6366f1' }}>
                <div className="portlet-body" style={{ padding: '15px 25px' }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                        <div style={{ width: 140, textAlign: 'right', paddingRight: 15, fontWeight: 'bold', fontSize: 13, color: '#333' }}>SMTP accounts:</div>
                        <div style={{ flex: 1 }}>
                            <DualSelect 
                                allAccounts={healthySmtps} 
                                selected={form.smtp_accounts || []} 
                                onChange={v => upd('smtp_accounts', v)} 
                            />
                        </div>
                    </div>
                </div>
            </div>

            <div className="portlet light bordered zack-panel" style={{ marginBottom: 18, borderLeft: '4px solid #6366f1' }}>
                <div className="portlet-title">
                    <span className="caption-subject uppercase" style={{ color: '#6366f1', fontWeight: 800 }}>
                        <i className="fa fa-envelope-o" /> Email Structure
                    </span>
                </div>
                <div className="portlet-body" style={{ padding: '15px 25px' }}>
                    <div className="smtp-compact-form" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        
                        {/* Return Path */}
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                            <div style={{ width: 140, textAlign: 'right', paddingRight: 15, fontWeight: 'bold', fontSize: 13, color: '#333' }}>Return Path:</div>
                            <input style={{ flex: 1, border: '1px solid #ccc', padding: '5px 10px', fontSize: 13, color: '#333', outline: 'none' }} 
                                value={form.header_sets[form.active_header_set_idx]?.return_path || ''} 
                                onChange={e => {
                                    const next = [...form.header_sets];
                                    next[form.active_header_set_idx].return_path = e.target.value;
                                    upd('header_sets', next);
                                }} placeholder="bounce@[domain]" />
                        </div>

                        {/* From Name */}
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                            <div style={{ width: 140, textAlign: 'right', paddingRight: 15, fontWeight: 'bold', fontSize: 13, color: '#333' }}>From Name:</div>
                            <div style={{ flex: 1, position: 'relative', display: 'flex' }}>
                                <textarea 
                                    style={{ flex: 1, border: '1px solid #ccc', borderRight: 'none', padding: '5px 10px', fontSize: 13, color: '#333', outline: 'none', resize: 'vertical', minHeight: 32, fontFamily: 'sans-serif' }} 
                                    value={form.header_sets[form.active_header_set_idx]?.from_name || ''} 
                                    onChange={e => {
                                        const next = [...form.header_sets];
                                        next[form.active_header_set_idx].from_name = e.target.value;
                                        upd('header_sets', next);
                                    }} placeholder="Offer name (one per line for rotation)" />
                                <div style={{ width: 34, border: '1px solid #ccc', background: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                                    onClick={() => setPreviewMode(p => ({ ...p, fromNameMenu: !p.fromNameMenu }))}>
                                    <i className="fa fa-caret-down" style={{ color: '#666' }} />
                                </div>
                                {previewMode.fromNameMenu && (
                                    <div style={{ position: 'absolute', top: 32, right: 0, zIndex: 100, background: '#fff', border: '1px solid #ccc', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', width: 220 }}>
                                        <div style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, color: '#4b5563' }} 
                                            onClick={() => applyEncodingHS('from_name', 'base64')}>Base64 encoding</div>
                                        <div style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, color: '#4b5563', borderTop: '1px solid #eee' }} 
                                            onClick={() => applyEncodingHS('from_name', 'quoted-printable')}>Quoted-printable encoding</div>
                                        <div style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, color: '#4b5563', borderTop: '1px solid #eee' }} 
                                            onClick={() => applyEncodingHS('from_name', 'placeholder')}>Placeholder (Random)</div>
                                        <div style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, color: '#4b5563', borderTop: '1px solid #eee' }} 
                                            onClick={() => applyEncodingHS('from_name', 'none')}>Clear encoding</div>
                                    </div>
                                )}
                            </div>
                            {form.header_sets[form.active_header_set_idx]?.from_name_encoding === 'placeholder' && (
                                <select 
                                    style={{ marginLeft: 10, border: '1px solid #22c55e', padding: '2px 5px', fontSize: 11, background: '#f0fdf4', borderRadius: 4 }}
                                    value={form.header_sets[form.active_header_set_idx]?.from_name_placeholder || ''}
                                    onChange={e => {
                                        const next = [...form.header_sets];
                                        next[form.active_header_set_idx].from_name_placeholder = e.target.value;
                                        upd('header_sets', next);
                                    }}
                                >
                                    <option value="">Select Tag...</option>
                                    {[...new Set((form.placeholders || []).map(p => p.key))].map(tag => (
                                        <option key={tag} value={tag}>{tag}</option>
                                    ))}
                                </select>
                            )}
                        </div>

                        {/* From Email */}
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                            <div style={{ width: 140, textAlign: 'right', paddingRight: 15, fontWeight: 'bold', fontSize: 13, color: '#333' }}>From Email:</div>
                            <div style={{ flex: 1, display: 'flex', gap: 0 }}>
                                <select 
                                    style={{ width: 130, border: '1px solid #ccc', borderRight: 'none', padding: '4px 8px', fontSize: 12, background: '#f8fafc', color: '#1e293b', fontWeight: 600 }}
                                    value={form.header_sets[form.active_header_set_idx]?.from_email_source || 'custom'} 
                                    onChange={e => {
                                        const next = [...form.header_sets];
                                        next[form.active_header_set_idx].from_email_source = e.target.value;
                                        upd('header_sets', next);
                                    }}
                                >
                                    <option value="custom">Custom</option>
                                    <option value="smtp_user">SMTP User</option>
                                    <option value="smtp_from">SMTP Email</option>
                                </select>
                                <input 
                                    style={{ flex: 1, border: '1px solid #ccc', padding: '5px 10px', fontSize: 13, color: '#333', outline: 'none', background: (form.header_sets[form.active_header_set_idx]?.from_email_source && form.header_sets[form.active_header_set_idx]?.from_email_source !== 'custom') ? '#f1f5f9' : '#fff' }} 
                                    value={form.header_sets[form.active_header_set_idx]?.from_email_source === 'custom' ? (form.header_sets[form.active_header_set_idx]?.from_email || '') : `[${form.header_sets[form.active_header_set_idx]?.from_email_source === 'smtp_user' ? 'SMTP User' : 'SMTP Email'}]`} 
                                    onChange={e => {
                                        if (form.header_sets[form.active_header_set_idx]?.from_email_source === 'custom') {
                                            const next = [...form.header_sets];
                                            next[form.active_header_set_idx].from_email = e.target.value;
                                            upd('header_sets', next);
                                        }
                                    }} 
                                    disabled={form.header_sets[form.active_header_set_idx]?.from_email_source && form.header_sets[form.active_header_set_idx]?.from_email_source !== 'custom'}
                                    placeholder="contact@[domain]" 
                                />
                            </div>
                        </div>

                        {/* Reply To */}
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                            <div style={{ width: 140, textAlign: 'right', paddingRight: 15, fontWeight: 'bold', fontSize: 13, color: '#333' }}>Reply To:</div>
                            <input style={{ flex: 1, border: '1px solid #ccc', padding: '5px 10px', fontSize: 13, color: '#333', outline: 'none' }} 
                                value={form.header_sets[form.active_header_set_idx]?.reply_to || ''} 
                                onChange={e => {
                                    const next = [...form.header_sets];
                                    next[form.active_header_set_idx].reply_to = e.target.value;
                                    upd('header_sets', next);
                                }} placeholder="reply@[domain]" />
                        </div>

                        {/* Subject */}
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                            <div style={{ width: 140, textAlign: 'right', paddingRight: 15, fontWeight: 'bold', fontSize: 13, color: '#333' }}>Subject:</div>
                            <div style={{ flex: 1, position: 'relative', display: 'flex' }}>
                                <textarea 
                                    style={{ flex: 1, border: '1px solid #ccc', borderRight: 'none', padding: '5px 10px', fontSize: 13, color: '#333', outline: 'none', resize: 'vertical', minHeight: 32, fontFamily: 'sans-serif' }} 
                                    value={form.header_sets[form.active_header_set_idx]?.subject || ''} 
                                    onChange={e => {
                                        const next = [...form.header_sets];
                                        next[form.active_header_set_idx].subject = e.target.value;
                                        upd('header_sets', next);
                                    }} placeholder="Offer subject (one per line for rotation)" />
                                <div style={{ width: 34, border: '1px solid #ccc', background: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                                    onClick={() => setPreviewMode(p => ({ ...p, subjectMenu: !p.subjectMenu }))}>
                                    <i className="fa fa-caret-down" style={{ color: '#666' }} />
                                </div>
                                {previewMode.subjectMenu && (
                                    <div style={{ position: 'absolute', top: 32, right: 0, zIndex: 100, background: '#fff', border: '1px solid #ccc', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', width: 220 }}>
                                        <div style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, color: '#4b5563' }} 
                                            onClick={() => applyEncodingHS('subject', 'base64')}>Base64 encoding</div>
                                        <div style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, color: '#4b5563', borderTop: '1px solid #eee' }} 
                                            onClick={() => applyEncodingHS('subject', 'quoted-printable')}>Quoted-printable encoding</div>
                                        <div style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, color: '#4b5563', borderTop: '1px solid #eee' }} 
                                            onClick={() => applyEncodingHS('subject', 'placeholder')}>Placeholder (Random)</div>
                                        <div style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, color: '#4b5563', borderTop: '1px solid #eee' }} 
                                            onClick={() => applyEncodingHS('subject', 'none')}>Clear encoding</div>
                                    </div>
                                )}
                            </div>
                            {form.header_sets[form.active_header_set_idx]?.subject_encoding === 'placeholder' && (
                                <select 
                                    style={{ marginLeft: 10, border: '1px solid #22c55e', padding: '2px 5px', fontSize: 11, background: '#f0fdf4', borderRadius: 4 }}
                                    value={form.header_sets[form.active_header_set_idx]?.subject_placeholder || ''}
                                    onChange={e => {
                                        const next = [...form.header_sets];
                                        next[form.active_header_set_idx].subject_placeholder = e.target.value;
                                        upd('header_sets', next);
                                    }}
                                >
                                    <option value="">Select Tag...</option>
                                    {[...new Set((form.placeholders || []).map(p => p.key))].map(tag => (
                                        <option key={tag} value={tag}>{tag}</option>
                                    ))}
                                </select>
                            )}
                        </div>

                        {/* Content Type, Charset */}
                        <div style={{ display: 'flex', gap: 20 }}>
                            <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                                <div style={{ width: 140, textAlign: 'right', paddingRight: 15, fontWeight: 'bold', fontSize: 13, color: '#333' }}>Content Type:</div>
                                <select style={{ flex: 1, border: '1px solid #ccc', padding: '4px 8px', fontSize: 13, color: '#333', background: '#fff' }} 
                                    value={form.header_sets[form.active_header_set_idx]?.content_type || 'text/html'} 
                                    onChange={e => {
                                        const next = [...form.header_sets];
                                        next[form.active_header_set_idx].content_type = e.target.value;
                                        upd('header_sets', next);
                                    }}>
                                    <option>text/html</option>
                                    <option>text/plain</option>
                                </select>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                                <div style={{ width: 80, textAlign: 'right', paddingRight: 15, fontWeight: 'bold', fontSize: 13, color: '#333' }}>Charset:</div>
                                <select style={{ flex: 1, border: '1px solid #ccc', padding: '4px 8px', fontSize: 13, color: '#333', background: '#fff' }} 
                                    value={form.header_sets[form.active_header_set_idx]?.charset || 'UTF-8'} 
                                    onChange={e => {
                                        const next = [...form.header_sets];
                                        next[form.active_header_set_idx].charset = e.target.value;
                                        upd('header_sets', next);
                                    }}>
                                    <option>UTF-8</option>
                                    <option>ISO-8859-1</option>
                                </select>
                            </div>
                        </div>

                        {/* C.T Encoding */}
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                            <div style={{ width: 140, textAlign: 'right', paddingRight: 15, fontWeight: 'bold', fontSize: 13, color: '#333' }}>C.T Encoding:</div>
                            <select style={{ width: 300, border: '1px solid #ccc', padding: '4px 8px', fontSize: 13, color: '#333', background: '#fff' }} 
                                value={form.header_sets[form.active_header_set_idx]?.ct_encoding || '8Bit'} 
                                onChange={e => {
                                    const next = [...form.header_sets];
                                    next[form.active_header_set_idx].ct_encoding = e.target.value;
                                    upd('header_sets', next);
                                }}>
                                <option>8Bit Encoding</option>
                                <option>Base64</option>
                                <option>Quoted-printable</option>
                            </select>
                        </div>

                        {/* Header Processing */}
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                            <div style={{ width: 140, textAlign: 'right', paddingRight: 15, fontWeight: 'bold', fontSize: 13, color: '#333' }}>Header Processing:</div>
                            <select style={{ width: 300, border: '1px solid #ccc', padding: '4px 8px', fontSize: 13, color: '#333', background: '#fff' }} 
                                value={form.header_processing} onChange={e => upd('header_processing', e.target.value)}>
                                <option>Default Process</option>
                                <option>Randomize</option>
                            </select>
                        </div>

                        {/* Email Header Managed */}
                        <div style={{ borderTop: '1px solid #eee', marginTop: 10, paddingTop: 15 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 15 }}>
                                <div style={{ fontWeight: 'bold', fontSize: 13, color: '#333', width: 140, textAlign: 'right', paddingRight: 15 }}>Email Header: [Header {form.active_header_set_idx + 1}]</div>
                                <button type="button" style={{ width: 34, height: 32, background: '#666', border: 'none', color: '#fff', borderRadius: 2, cursor: 'pointer' }} 
                                    onClick={() => {
                                        const input = document.createElement('input');
                                        input.type = 'file';
                                        input.accept = '.txt,.header';
                                        input.onchange = (e) => {
                                            const file = e.target.files[0];
                                            if (!file) return;
                                            const reader = new FileReader();
                                            reader.onload = (re) => {
                                                const next = [...form.header_sets];
                                                next[form.active_header_set_idx].content = re.target.result;
                                                upd('header_sets', next);
                                            };
                                            reader.readAsText(file);
                                        };
                                        input.click();
                                    }} title="Upload Header (from TXT)"><i className="fa fa-upload" /></button>
                                <button type="button" style={{ width: 34, height: 32, background: '#00adef', border: 'none', color: '#fff', borderRadius: 2, cursor: 'pointer' }} 
                                    onClick={() => {
                                        // Use original default content for consistency across ALL headers
                                        const defaultHeader = FORM_DEFAULTS.header_sets[0];
                                        const original = { 
                                            ...defaultHeader, 
                                            id: Date.now(), 
                                            name: `Header ${form.header_sets.length + 1}`, 
                                            enabled: true 
                                        };
                                        const next = [...form.header_sets, original];
                                        upd('header_sets', next);
                                        upd('active_header_set_idx', next.length - 1);
                                    }} title="Add New Header"><i className="fa fa-plus" /></button>
                                <button type="button" style={{ width: 34, height: 32, background: '#f44336', border: 'none', color: '#fff', borderRadius: 2, cursor: 'pointer' }} 
                                  onClick={() => {
                                      if (form.header_sets.length <= 1) return;
                                      const next = [...form.header_sets];
                                      next.splice(form.active_header_set_idx, 1);
                                      upd('header_sets', next);
                                      upd('active_header_set_idx', Math.max(0, form.active_header_set_idx - 1));
                                  }}><i className="fa fa-trash" /></button>
                                
                                <select style={{ height: 32, border: '1px solid #ccc', padding: '0 10px', fontSize: 13, background: '#fff', color: '#333', borderRadius: 2, flex: 1, maxWidth: 120 }} 
                                    value={form.active_header_set_idx} onChange={e => upd('active_header_set_idx', parseInt(e.target.value, 10))}>
                                    {form.header_sets.map((s, idx) => <option key={s.id} value={idx}>Header {idx + 1}</option>)}
                                </select>
                                <div style={{ fontSize: 12, color: '#666' }}>use #### to separate between headers</div>
                            </div>

                            <div style={{ background: '#fff0f0', color: '#e51c23', padding: '10px 15px', fontSize: 13, marginBottom: 15, borderRadius: 2 }}>
                                You can use the 'return path' inside the 'header' directly for the fixed random feature. Example:
                                <br />
                                <span style={{ fontWeight: 'bold' }}>Return-Path: &lt;(an,5)@[domain]&gt;</span> 
                                <input type="checkbox" style={{ marginLeft: 15, verticalAlign: 'middle' }} checked /> Enable
                            </div>

                            <div style={{ position: 'relative' }}>
                                <textarea style={{ ...ta, width: '100%', height: 300, border: '1px solid #ccc', borderRadius: 0, fontSize: 13, fontFamily: 'monospace', padding: 15 }} 
                                    value={form.header_sets[form.active_header_set_idx]?.content || ''}
                                    onChange={e => {
                                        const next = [...form.header_sets];
                                        next[form.active_header_set_idx].content = e.target.value;
                                        upd('header_sets', next);
                                    }}
                                />
                                <div style={{ position: 'absolute', bottom: 10, right: 10, color: '#ccc' }}><i className="fa fa-expand" /></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="portlet light bordered zack-panel" style={{ marginBottom: 18 }}>
                <div className="portlet-title"><span className="caption-subject uppercase"><i className="fa fa-code" /> Email Body & HTML Editor</span></div>
                <div className="portlet-body">
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', background: '#f8fafc', padding: '10px 15px', border: '1px solid #e2e8f0', borderRadius: 6, marginBottom: 15 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>INSERT TAG:</div>
                        <select style={{ ...S.input, width: 220, height: 30, padding: '0 8px' }} value={tagInsert.tag} onChange={e => setTagInsert(p => ({ ...p, tag: e.target.value }))}>
                            <option value="">Select Tag...</option>
                            <optgroup label="Main Tags">
                                {['ip','rdns','ptr','domain','custom_domain','static_domain','smtp_user','server','email_id','email','email_b64','first_name','last_name','return_path','from_name','subject','mail_date','message_id','negative','auto_reply_mailbox'].map(t => <option key={t} value={t}>{t}</option>)}
                            </optgroup>
                            <optgroup label="Placeholders">
                                {[...new Set((form.placeholders || []).map(p => p.key))].map(tag => (
                                    <option key={tag} value={tag}>{tag}</option>
                                ))}
                            </optgroup>
                            <optgroup label="Unique Random Tags">
                                {['ua','ual','uau','uan','uanl','uanu','un','uhu','uhl','usp','usca'].map(t => <option key={t} value={`${t}_8`}>[{t}_8]</option>)}
                            </optgroup>
                            <optgroup label="Random Tags">
                                {['a','al','au','an','anl','anu','n','hu','hl','sp','sca'].map(t => <option key={t} value={t}>[{t}]</option>)}
                            </optgroup>
                            <optgroup label="Link Tags">
                                {['open','url','unsub','optout'].map(t => <option key={t} value={t}>[{t}]</option>)}
                            </optgroup>
                            <optgroup label="Short Link Tags">
                                {['short_open','short_url','short_unsub','short_optout'].map(t => <option key={t} value={t}>[{t}]</option>)}
                            </optgroup>
                        </select>
                        <select style={{ ...S.input, width: 110, height: 30, padding: '0 8px' }} value={tagInsert.encoding} onChange={e => setTagInsert(p => ({ ...p, encoding: e.target.value }))}>
                            <option value="none">No Encoding</option>
                            <option value="base64">Base64</option>
                            <option value="quoted-printable">Quoted-Printable</option>
                        </select>
                        <select style={{ ...S.input, width: 110, height: 30, padding: '0 8px' }} value={tagInsert.bypass} onChange={e => setTagInsert(p => ({ ...p, bypass: e.target.value }))}>
                            <option value="none">No Bypass</option>
                            <option value="dot">Dot (.)</option>
                        </select>
                        <button type="button" style={{ ...S.btnS, background: '#6366f1', color: '#fff', border: 'none', fontWeight: 700, height: 30 }} 
                            onClick={() => {
                                const subjectActive = document.activeElement && document.activeElement.id === 'subject_editor';
                                const fromActive = document.activeElement && document.activeElement.id === 'from_name_editor';
                                const bodyActive = document.activeElement && document.activeElement.id.startsWith('html_editor_');
                                
                                if (subjectActive) insertAdvancedTag('subject_editor');
                                else if (fromActive) insertAdvancedTag('from_name_editor');
                                else if (bodyActive) insertAdvancedTag(document.activeElement.id);
                                else insertAdvancedTag(`html_editor_${activeBodyIdx}`);
                            }}>Insert</button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.5fr)', gap: 16 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid #cbd5e1', borderRadius: 8, overflow: 'hidden' }}>
                            <div style={{ padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #cbd5e1', fontWeight: 600, color: '#334155' }}>HTML Viewer</div>
                            <div style={{ flex: 1, padding: 16, background: '#fff', minHeight: 350, overflowY: 'auto' }}
                                dangerouslySetInnerHTML={{ __html: (form.html_bodies && form.html_bodies.length > 0 ? form.html_bodies[0] : '') || '<p style="color:#94a3b8; font-style:italic">Preview...</p>' }} 
                            />
                            <div style={{ padding: '8px 14px', background: '#f8fafc', borderTop: '1px solid #cbd5e1' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                                    <input type="checkbox" checked={true} readOnly /> Enable preview
                                </label>
                            </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                {(form.html_bodies && form.html_bodies.length > 0 ? form.html_bodies : ['']).map((_, i) => (
                                    <button key={i} type="button" 
                                        onClick={() => setActiveBodyIdx(i)}
                                        style={{ ...S.btnS, background: i === activeBodyIdx ? '#4f46e5' : '#f1f5f9', color: i === activeBodyIdx ? '#fff' : '#475569', borderColor: i === activeBodyIdx ? '#4f46e5' : '#cbd5e1', borderRadius: '4px 4px 0 0', borderBottom: 'none', padding: '6px 12px' }}>
                                        Html {i + 1}
                                        {i > 0 && <span style={{ marginLeft: 8, cursor: 'pointer', color: '#fca5a5' }} onClick={(e) => { 
                                            e.stopPropagation(); 
                                            const nb = [...form.html_bodies]; 
                                            nb.splice(i, 1); 
                                            upd('html_bodies', nb); 
                                            if (activeBodyIdx >= nb.length) setActiveBodyIdx(Math.max(0, nb.length - 1));
                                        }}>✕</span>}
                                    </button>
                                ))}
                                <button type="button" style={{ ...S.btnS, background: '#10b981', color: '#fff', border: 'none', padding: '6px 10px', borderRadius: 4, marginLeft: 4 }} 
                                    onClick={() => {
                                        const nb = [...(form.html_bodies || ['']), ''];
                                        upd('html_bodies', nb);
                                        setActiveBodyIdx(nb.length - 1);
                                    }} title="Add Body">
                                    <i className="fa fa-plus" />
                                </button>
                                <button type="button" style={{ ...S.btnS, background: '#6366f1', color: '#fff', border: 'none', padding: '6px 10px', borderRadius: 4, marginLeft: 4 }} 
                                    onClick={() => {
                                        const input = document.createElement('input');
                                        input.type = 'file';
                                        input.accept = '.html,.htm,.txt';
                                        input.onchange = (e) => {
                                            const file = e.target.files[0];
                                            if (!file) return;
                                            const reader = new FileReader();
                                            reader.onload = (re) => {
                                                const nb = [...form.html_bodies];
                                                nb[activeBodyIdx] = re.target.result;
                                                upd('html_bodies', nb);
                                            };
                                            reader.readAsText(file);
                                        };
                                        input.click();
                                    }} title="Upload Body (HTML/TXT)">
                                    <i className="fa fa-upload" />
                                </button>
                                <div style={{ fontSize: 11, color: '#94a3b8', marginLeft: 'auto' }}>Spun/rotated randomly per recipient</div>
                            </div>
                            <textarea
                                className="form-control ir-input"
                                style={{ ...ta, flex: 1, minHeight: 300, borderTopLeftRadius: 0 }}
                                value={(form.html_bodies && form.html_bodies.length > activeBodyIdx ? form.html_bodies[activeBodyIdx] : '')}
                                id={`html_editor_${activeBodyIdx}`}
                                onChange={e => {
                                    const nb = [...(form.html_bodies && form.html_bodies.length > 0 ? form.html_bodies : [''])];
                                    nb[activeBodyIdx] = e.target.value;
                                    upd('html_bodies', nb);
                                }}
                                placeholder={BODY_EXAMPLE_PLACEHOLDER}
                            />
                            <div style={{ display: 'flex', gap: 14, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                                    <span style={{ fontWeight: 600 }}>Header Rotation:</span>
                                    <input style={{ ...S.input, width: 80, padding: '4px 8px' }} type="number" value="1" disabled />
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                                    <span style={{ fontWeight: 600 }}>Body Rotation:</span>
                                    <input style={{ ...S.input, width: 80, padding: '4px 8px' }} type="number" value={form.body_rotation || 1} onChange={e => upd('body_rotation', e.target.value)} />
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                                    <span style={{ fontWeight: 600 }}>URL Format:</span>
                                    <select style={{ ...S.input, padding: '4px 8px', width: 140 }}>
                                        <option>Format 1</option>
                                    </select>
                                </label>
                            </div>
                            
                            {/* Shortlink Generator UI */}
                            <div style={{ marginTop: 15, padding: 15, background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 8 }}>
                                <div style={{ fontWeight: 700, fontSize: 12, color: '#475569', textTransform: 'uppercase', marginBottom: 10 }}>🔗 Shortlink Generator</div>
                                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                                    <label style={{ ...S.lbl, flex: 2 }}>Original URL
                                        <input style={S.input} value={shortlinkGen.url} onChange={e => setShortlinkGen(p => ({ ...p, url: e.target.value }))} placeholder="https://your-offer.com" />
                                    </label>
                                    <label style={{ ...S.lbl, flex: 1 }}>Provider
                                        <select style={S.input} value={shortlinkGen.provider} onChange={e => setShortlinkGen(p => ({ ...p, provider: e.target.value }))}>
                                            <option>Random</option>
                                            <option>is.gd</option>
                                            <option>TinyURL</option>
                                            <option>Bitly</option>
                                            <option>Short.io</option>
                                            <option>Cutt.ly</option>
                                            <option>1pt.co</option>
                                        </select>
                                    </label>
                                    <button type="button" style={{ ...S.btnP, height: 36 }} onClick={generateShortlink} disabled={shortlinkGen.loading}>
                                        {shortlinkGen.loading ? '...' : <span><i className="fa fa-magic" /> Generate</span>}
                                    </button>
                                </div>
                                {shortlinkGen.result && (
                                    <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <span style={{ fontSize: 12, fontWeight: 700, color: '#22c55e' }}>Last Shortlink:</span>
                                        <input style={{ ...S.input, flex: 1, height: 28, fontSize: 12, background: '#f0fdf4' }} value={shortlinkGen.result} readOnly />
                                        <button type="button" style={{ ...S.btnG, padding: '4px 10px', fontSize: 11 }} onClick={() => navigator.clipboard.writeText(shortlinkGen.result)}>Copy</button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div style={{ marginTop: 24, padding: 18, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                        <div style={{ fontWeight: 800, color: '#334155', marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                            <i className="fa fa-cogs" style={{ color: '#6366f1' }}/> Settings under body (Throttle, Headers, Formatting)
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 16 }}>
                            <label style={S.lbl}>Content-Type
                                <select style={S.input} value={form.content_type || 'text/html'} onChange={e => upd('content_type', e.target.value)}>
                                    <option value="text/html">text/html</option>
                                    <option value="text/plain">text/plain</option>
                                </select>
                            </label>
                            <label style={S.lbl}>Charset
                                <select style={S.input} value={form.charset || 'UTF-8'} onChange={e => upd('charset', e.target.value)}>
                                    <option>UTF-8</option>
                                    <option>ISO-8859-1</option>
                                </select>
                            </label>
                            <label style={S.lbl}>Send mode
                                <select style={S.input} value={form.sending_script || 'queue'} onChange={e => upd('sending_script', e.target.value)}>
                                    <option value="queue">Queued</option>
                                    <option value="direct">Direct</option>
                                </select>
                            </label>
                            <label style={S.lbl}>Emails per speed
                                <div style={{ display: 'flex', gap: 6 }}>
                                    <input style={{ ...S.input, flex: 1 }} type="number" min={1} value={form.send_speed || 10} onChange={e => upd('send_speed', e.target.value)} />
                                    <select style={{ ...S.input, width: 100 }} value={form.send_speed_unit || 'minute'} onChange={e => upd('send_speed_unit', e.target.value)}>
                                        <option value="second">secs</option>
                                        <option value="minute">mins</option>
                                        <option value="hour">hours</option>
                                    </select>
                                </div>
                            </label>
                            <label style={S.lbl}>Batch size
                                <input style={S.input} type="number" min={1} value={form.batch_size || 100} onChange={e => upd('batch_size', e.target.value)} />
                            </label>
                            <label style={{ ...S.lbl, gridColumn: 'span 2' }}>Pause after batch (mins)
                                <div style={{ display: 'flex', gap: 6 }}>
                                    <input style={{ ...S.input, flex: 1 }} type="number" min={0} value={form.batch_pause || 1} onChange={e => upd('batch_pause', e.target.value)} />
                                    <select style={{ ...S.input, width: 100 }} value={form.batch_pause_unit || 'minute'} onChange={e => upd('batch_pause_unit', e.target.value)}>
                                        <option value="second">secs</option>
                                        <option value="minute">mins</option>
                                        <option value="hour">hours</option>
                                    </select>
                                </div>
                            </label>
                            <label style={S.lbl}>Test every N sends
                                <input style={S.input} type="number" min={0} value={form.test_after_emails ?? 100} onChange={e => upd('test_after_emails', e.target.value)} />
                            </label>
                            <label style={{ ...S.lbl, gridColumn: 'span 2' }}>Test message goes to
                                <div style={{ display: 'flex', gap: 6 }}>
                                    <input style={{ ...S.input, flex: 1 }} value={form.test_email_destination || ''} onChange={e => upd('test_email_destination', e.target.value)} placeholder="Leave empty for 1st SMTP" />
                                    <button type="button" style={{ ...S.btnP, background: '#f59e0b', borderColor: '#d97706', padding: '6px 12px' }} onClick={() => {
                                        if (!form.id) return setMsg('❌ Save campaign first before sending a test');
                                        const dest = form.test_email_destination || (healthySmtps.length ? healthySmtps[0].email : '');
                                        if(!dest) return setMsg('❌ No SMTP or test email set');
                                        setMsg('🧪 Sending test sequence...');
                                        apiFetch(`/api/campaigns/${form.id}/test-all`, { method: 'POST', body: JSON.stringify({ destination: dest }) })
                                            .then(r => {
                                                if (r.success) {
                                                    const m = 'Test sequence sent!';
                                                    setMsg(`✅ ${m}`);
                                                    if (window.Toast) window.Toast.success(m);
                                                }
                                                else setMsg('❌ Test failed: ' + (r.error || 'unknown error'));
                                            })
                                            .catch(e => setMsg('❌ Test failed: Network error'));
                                    }}>Send Test All</button>
                                </div>
                            </label>
                        </div>
                        
                        {/* Integrated Security & Shortlink Settings */}
                        <div style={{ marginTop: 20, paddingTop: 15, borderTop: '2px dashed #e2e8f0' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                                {cpSettings && (
                                    <div style={{ border: '1px solid #e2e8f0', padding: 12, borderRadius: 8, background: '#fff' }}>
                                        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span>🛡️ Clicks Protection</span>
                                            <button type="button" onClick={() => saveCp('enabled', !cpSettings.enabled)} style={{ ...S.btnG, fontSize: 10, padding: '2px 8px', background: cpSettings.enabled ? '#22c55e' : '#94a3b8', color: '#fff' }}>
                                                {cpSettings.enabled ? 'ENABLED' : 'DISABLED'}
                                            </button>
                                        </div>
                                        <div style={{ display: 'grid', gap: 8 }}>
                                            <label style={{ ...S.lbl, fontSize: 11 }}>Fallback Redirect URL
                                                <input style={{ ...S.input, height: 28 }} value={cpSettings.fallbackUrl} onChange={e => saveCp('fallbackUrl', e.target.value)} placeholder="https://safe-page.com" />
                                            </label>
                                            <div style={{ fontSize: 10, color: '#64748b' }}>
                                                Bot Score Threshold: <b>{cpSettings.botScoreThreshold}</b> · 
                                                Blocked ASN: <b>{cpSettings.blacklistProviders.length}</b>
                                            </div>
                                        </div>
                                    </div>
                                )}
                                
                                {slSettings && (
                                    <div style={{ border: '1px solid #e2e8f0', padding: 12, borderRadius: 8, background: '#fff' }}>
                                        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span>🔑 Shortlink API Keys</span>
                                            <button type="button" onClick={saveSl} style={{ ...S.btnP, fontSize: 10, padding: '2px 8px' }}>SAVE KEYS</button>
                                        </div>
                                        <div style={{ maxHeight: 150, overflowY: 'auto' }}>
                                            {['TinyURL', 'Bitly', 'Short.io', 'Cutt.ly'].map(p => (
                                                <div key={p} style={{ marginBottom: 10, borderBottom: '1px solid #f1f5f9', paddingBottom: 8 }}>
                                                    <div style={{ fontSize: 11, fontWeight: 800, color: '#334155', marginBottom: 4 }}>{p}</div>
                                                    {p === 'Bitly' ? (
                                                        <div style={{ display: 'grid', gap: 6 }}>
                                                            <label style={{ ...S.lbl, fontSize: 10, marginBottom: 0 }}>Client ID
                                                                <input style={{ ...S.input, height: 24, fontSize: 10 }} type="password" value={slSettings?.providers?.Bitly?.clientId || ''} onChange={e => updSlProvider('Bitly', 'clientId', e.target.value)} />
                                                            </label>
                                                            <label style={{ ...S.lbl, fontSize: 10, marginBottom: 0 }}>Client Secret
                                                                <input style={{ ...S.input, height: 24, fontSize: 10 }} type="password" value={slSettings?.providers?.Bitly?.clientSecret || ''} onChange={e => updSlProvider('Bitly', 'clientSecret', e.target.value)} />
                                                            </label>
                                                        </div>
                                                    ) : (
                                                        <label style={{ ...S.lbl, fontSize: 10, marginBottom: 0 }}>API Key / Token
                                                            <input style={{ ...S.input, height: 24, fontSize: 10 }} type="password" value={slSettings?.providers?.[p]?.apiKey || ''} onChange={e => updSlProvider(p, 'apiKey', e.target.value)} />
                                                        </label>
                                                    )}
                                                </div>
                                            ))}
                                            <div style={{ fontSize: 10, color: '#64748b', fontStyle: 'italic', marginTop: 5 }}>is.gd and 1pt.co do not require API keys.</div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Auto Reply & Placeholders */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 18 }}>
                <div className="portlet light bordered zack-panel" style={{ marginBottom: 0 }}>
                    <div className="portlet-body" style={{ padding: '15px 25px' }}>
                        <div style={{ fontWeight: 'bold', fontSize: 13, color: '#333', marginBottom: 15, display: 'flex', alignItems: 'center' }}>
                            <i className="fa fa-reply" style={{ marginRight: 8, color: '#6366f1' }} /> Auto Reply
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            <div style={{ display: 'flex', alignItems: 'center' }}>
                                <div style={{ width: 100, fontSize: 12, fontWeight: 'bold', color: '#666' }}>Status:</div>
                                <select style={{ ...S.input, height: 30, padding: '0 8px', flex: 1 }} value={form.auto_reply_status || 'Disable'} onChange={e => upd('auto_reply_status', e.target.value)}>
                                    <option>Disable</option><option>Enable</option>
                                </select>
                            </div>
                            <textarea style={{ ...ta, minHeight: 80, fontSize: 12, borderRadius: 4 }} value={form.auto_reply_accounts || ''} onChange={e => upd('auto_reply_accounts', e.target.value)} placeholder="Email accounts..." />
                        </div>
                    </div>
                </div>

                <div className="portlet light bordered zack-panel" style={{ marginBottom: 0 }}>
                    <div className="portlet-body" style={{ padding: '15px 25px' }}>
                        <div style={{ fontWeight: 'bold', fontSize: 13, color: '#333', marginBottom: 15, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span><i className="fa fa-tags" style={{ marginRight: 8, color: '#6366f1' }} /> Placeholders</span>
                            <button type="button" style={{ fontSize: 10, background: '#4f46e5', color: '#fff', border: 'none', padding: '2px 8px', borderRadius: 2 }} onClick={() => upd('placeholders', [...(form.placeholders || []), { key: '', values: [] }])}>+ ADD</button>
                        </div>
                        <div style={{ maxHeight: 130, overflowY: 'auto' }}>
                            {(form.placeholders || []).map((ph, i) => (
                                <div key={i} style={{ display: 'flex', gap: 5, marginBottom: 5 }}>
                                    <input style={{ ...S.input, flex: 1, height: 28, padding: '0 6px', fontSize: 12 }} placeholder="Tag" value={ph.key} onChange={e => {
                                        const np = [...form.placeholders]; np[i].key = e.target.value.replace(/[{}]/g, ''); upd('placeholders', np);
                                    }} />
                                    <input style={{ ...S.input, flex: 2, height: 28, padding: '0 6px', fontSize: 12 }} placeholder="Values..." value={(ph.values || []).join(',')} onChange={e => {
                                        const np = [...form.placeholders]; np[i].values = e.target.value.split(',').map(v => v.trim()).filter(Boolean); upd('placeholders', np);
                                    }} />
                                    <button type="button" style={{ border: 'none', background: '#f44336', color: '#fff', width: 28, height: 28, borderRadius: 2 }} onClick={() => {
                                        const np = [...form.placeholders]; np.splice(i, 1); upd('placeholders', np);
                                    }}>✕</button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Data (Lists & Logic) */}
            <div className="portlet light bordered zack-panel" style={{ marginBottom: 18, borderTop: '4px solid #10b981' }}>
                <div className="portlet-title">
                    <span className="caption-subject uppercase" style={{ color: '#10b981', fontWeight: 800 }}>
                        <i className="fa fa-users" /> Delivery Targets
                    </span>
                </div>
                <div className="portlet-body" style={{ padding: '15px 25px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
                        <div style={{ width: 140, textAlign: 'right', paddingRight: 15, fontWeight: 'bold', fontSize: 13, color: '#333' }}>Mail Lists:</div>
                        <div style={{ flex: 1 }}>
                            <DualSelect allAccounts={dataLists} selected={form.data_list_ids || []} onChange={v => upd('data_list_ids', v)} renderItem={l => `${l.name} (${l.record_count})`} emptyText="No lists" />
                        </div>
                    </div>
                    
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                        <div style={{ width: 140, textAlign: 'right', paddingRight: 15, fontWeight: 'bold', fontSize: 13, color: '#333' }}>Paste area:</div>
                        <div style={{ flex: 1 }}>
                            <textarea id="paste_recipients_area" className="form-control" style={{ ...ta, width: '100%', minHeight: 80, fontSize: 13, borderRadius: 4, boxSizing: 'border-box' }} value={pasteEmails} onChange={e => setPasteEmails(e.target.value)} placeholder="email@example.com (one per line)" />
                        </div>
                    </div>
                </div>
            </div>

            <div className="portlet light bordered zack-panel" style={{ marginBottom: 18, borderLeft: '4px solid #f43f5e' }}>
                <div className="portlet-title">
                    <span className="caption-subject uppercase" style={{ color: '#f43f5e', fontWeight: 800 }}>
                        <i className="fa fa-filter" /> Filters & Range
                    </span>
                </div>
                <div className="portlet-body" style={{ padding: '15px 25px' }}>
                    <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 13, fontWeight: 'bold', color: '#333' }}>Start:</span>
                            <input style={{ ...S.input, height: 32, width: 100 }} type="number" min={0} value={form.range_start_from ?? 0} onChange={e => upd('range_start_from', e.target.value)} />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 13, fontWeight: 'bold', color: '#333' }}>Count:</span>
                            <input style={{ ...S.input, height: 32, width: 100 }} type="number" min={0} value={form.range_count ?? 0} onChange={e => upd('range_count', e.target.value)} />
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 'bold', color: '#333' }}>Schedule Launch Date:
                            <input type="datetime-local" style={{ ...S.input, height: 32 }} value={form.launch_date ? form.launch_date.slice(0, 16) : ''} onChange={e => upd('launch_date', `${e.target.value}:00`)} />
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                            <input type="checkbox" checked={form.use_suppression_list !== false} onChange={e => upd('use_suppression_list', e.target.checked)} />
                            <span>Force bypass suppression blacklist</span>
                        </label>
                    </div>
                </div>
            </div>

            {/* Bottom Controls */}
            <div className="portlet light bordered zack-panel" style={{ marginBottom: 30, borderTop: '4px solid #f59e0b' }}>
                <div className="portlet-body" style={{ padding: '20px 25px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 20 }}>
                    <div style={{ display: 'flex', gap: 10 }}>
                        <button type="button" style={{ height: 40, padding: '0 30px', borderRadius: 4, fontWeight: 800, background: '#22c55e', color: '#fff', border: 'none', cursor: 'pointer' }} 
                            onClick={saveAndSend} disabled={saving}>
                            <i className="fa fa-paper-plane" style={{ marginRight: 8 }} /> {form.id ? 'UPDATE & SEND' : 'SEND CAMPAIGN'}
                        </button>
                    </div>
                    
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#f8fafc', padding: '10px 15px', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                        <div style={{ fontWeight: 'bold', fontSize: 13, color: '#334155' }}>Testing via Paste Area:</div>
                        <button type="button" style={{ height: 36, padding: '0 20px', borderRadius: 4, background: '#4f46e5', color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer' }}
                            onClick={async () => {
                                if (!pasteEmails || !pasteEmails.trim()) { 
                                    setMsg('❌ Paste at least one email in the Paste Area above to test.'); 
                                    const el = document.getElementById('paste_recipients_area');
                                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    return; 
                                }
                                setMsg('💾 Saving & Testing...');
                                try {
                                    // Auto-save silenty so test uses what you see in UI without switching views
                                    const saved = await save(true);
                                    if (!saved) return; 

                                    const r = await apiFetch(`/api/campaigns/${saved.id}/test-send`, { 
                                        method: 'POST', 
                                        body: JSON.stringify({ testEmails: pasteEmails }) 
                                    });
                                    if (r.success) {
                                        const m = `Test sent to ${pasteEmails.split('\n').filter(Boolean).length} emails!`;
                                        setMsg(`✅ ${m}`);
                                        if (window.Toast) window.Toast.success(m);
                                    }
                                    else setMsg('❌ Failed: ' + r.error);
                                } catch (e) {
                                    setMsg('❌ Network error');
                                }
                            }}>
                            <i className="fa fa-flask" style={{ marginRight: 8 }} /> TEST SEND
                        </button>
                    </div>
                </div>
            </div>

            <p style={{ fontSize: 12, color: '#64748b', textAlign: 'center' }}>Launch or pause from <strong>SMTP Drops</strong> monitor.</p>
        </div>
    );
}


// ═══════════════════════════════════════════════════════════════════════════════
//  RECIPIENTS PANEL
// ═══════════════════════════════════════════════════════════════════════════════
function RecipientsPanel({ campaign, onBack }) {
    const [recs,   setRecs]   = useState([]);
    const [total,  setTotal]  = useState(0);
    const [page,   setPage]   = useState(1);
    const [filter, setFilter] = useState('');
    const [email,  setEmail]  = useState('');
    const [msg,    setMsg]    = useState('');
    const limit = 100;

    const load = useCallback(async () => {
        const qs = `?page=${page}&limit=${limit}${filter ? `&status=${filter}` : ''}`;
        const d  = await apiFetch(`/api/campaigns/${campaign.id}/recipients${qs}`);
        setRecs(d.recipients || []); setTotal(d.total || 0);
    }, [campaign.id, page, filter]);
    useEffect(() => { load(); }, [load]);

    const addOne = async () => {
        if (!email.includes('@')) { setMsg('❌ Invalid email'); return; }
        const d = await apiFetch(`/api/campaigns/${campaign.id}/recipients`, { method:'POST', body:JSON.stringify({ email }) });
        if (d.success) { setEmail(''); setMsg(''); load(); } else setMsg('❌ ' + d.error);
    };

    const del = async (id) => { await apiFetch(`/api/recipients/${id}`, { method:'DELETE' }); load(); };

    const importFile = async (e) => {
        const f = e.target.files[0]; if (!f) return; e.target.value = '';
        const fd = new FormData(); fd.append('file', f);
        const d = await apiFetch(`/api/campaigns/${campaign.id}/recipients/bulk-import`, { method:'POST', body:fd });
        if (!d.success && d.error) setMsg('❌ ' + d.error);
        else setMsg(`✅ Imported: ${d.imported ?? 0} | Dupes skipped: ${d.duplicates_skipped ?? 0} | Errors: ${d.failed ?? 0}`);
        load();
    };

    const clearAll = async () => {
        if (!window.confirm('Clear ALL recipients?')) return;
        await apiFetch(`/api/campaigns/${campaign.id}/recipients`, { method:'DELETE' }); load();
    };

    const resetAll = async () => {
        if (!window.confirm('Reset all to pending?')) return;
        await apiFetch(`/api/campaigns/${campaign.id}/recipients/reset`, { method:'POST' }); load();
    };

    const sc = { pending:'#f59e0b', sent:'#22c55e', failed:'#ef4444', suppressed:'#8b5cf6' };

    return (
        <div className="zack-send-root" style={{ fontSize: 13, color: '#1e293b' }}>
            <div className="zack-send-hero" style={{ marginBottom: 20, borderRadius: 8 }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap: 14 }}>
                    <div>
                        <div style={{ fontSize: 11, opacity: 0.88, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 6 }}>Hikari Mail</div>
                        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5 }}>Recipients</div>
                        <div style={{ fontSize: 13, opacity: 0.9, marginTop: 6 }}>{campaign.name}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ background:'rgba(255,255,255,0.1)', color:'#fff', border:'1px solid rgba(255,255,255,0.2)', padding:'8px 16px', borderRadius:8, fontSize:13, fontWeight:600 }}>{total} total</span>
                        <button style={{ ...S.btnG, border: 'none', background: 'rgba(255,255,255,0.2)', color: '#fff' }} onClick={onBack}>← Back</button>
                    </div>
                </div>
            </div>
            {msg && <div style={S.msg}>{msg} <button onClick={() => setMsg('')} style={{ float:'right', background:'none', border:'none', cursor:'pointer', fontSize:16 }}>✕</button></div>}

            <div style={{ ...S.card, display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
                <input style={{ ...S.input, flex:1, minWidth:200 }} placeholder="email@domain.com" value={email}
                    onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && addOne()} />
                <button style={S.btnP} onClick={addOne}>+ Add</button>
                <label style={{ ...S.btnG, cursor:'pointer' }}>📂 Import CSV/TXT
                    <input type="file" accept=".csv,.txt" style={{ display:'none' }} onChange={importFile} />
                </label>
                <select style={{ ...S.input, width:150 }} value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }}>
                    <option value="">All statuses</option>
                    {['pending','sent','failed'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <button style={S.btnG} onClick={resetAll}>🔄 Reset Pending</button>
                <button style={S.btnDel} onClick={clearAll}>🗑 Clear All</button>
            </div>

            <div style={S.card}>
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                    <thead><tr style={{ background:'#f8fafc' }}>{['Email','Name','Status','Added',''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                    <tbody>
                        {recs.map(r => (
                            <tr key={r.id} style={{ borderBottom:'1px solid #e2e8f0' }}>
                                <td style={S.td}>{r.email}</td>
                                <td style={S.td}>{r.name}</td>
                                <td style={S.td}><span style={{ color: sc[r.status] || '#64748b', fontWeight:700 }}>● {r.status}</span></td>
                                <td style={S.td}>{new Date(r.created_at).toLocaleDateString()}</td>
                                <td style={S.td}><button style={S.btnDel} onClick={() => del(r.id)}>Del</button></td>
                            </tr>
                        ))}
                        {!recs.length && <tr><td colSpan={5} style={{ textAlign:'center', padding:32, color:'#94a3b8' }}>No recipients</td></tr>}
                    </tbody>
                </table>
                <div style={{ display:'flex', gap:8, justifyContent:'center', marginTop:12, alignItems:'center' }}>
                    <button style={S.btnG} disabled={page === 1} onClick={() => setPage(p => p - 1)}>◀</button>
                    <span style={{ fontSize:13, color:'#64748b' }}>Page {page} / {Math.max(1, Math.ceil(total / limit))} ({total})</span>
                    <button style={S.btnG} disabled={page * limit >= total} onClick={() => setPage(p => p + 1)}>▶</button>
                </div>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CAMPAIGNS PAGE  (SMTP Drops Monitor–style table + toolbar)
// ═══════════════════════════════════════════════════════════════════════════════
function CampaignsPage() {
    const [campaigns,    setCampaigns]    = useState([]);
    const [smtps,        setSmtps]        = useState([]);
    const [view,         setView]         = useState('list');
    const [editCampaign, setEditCampaign] = useState(null);
    const [recCampaign,  setRecCampaign]  = useState(null);
    const [msg,          setMsg]          = useState('');
    const [launching,    setLaunching]    = useState(new Set());
    const [selected,     setSelected]     = useState(() => new Set());
    const [detailsCampaign, setDetailsCampaign] = useState(null);

    useEffect(() => {
        const id = 'bulk-mailer-sending-keyframes';
        if (document.getElementById(id)) return;
        const el = document.createElement('style');
        el.id = id;
        el.textContent = '@keyframes sendingPulse{0%,100%{opacity:1;filter:brightness(1)}50%{opacity:.88;filter:brightness(1.08)}}';
        document.head.appendChild(el);
    }, []);

    const load = useCallback(async () => {
        const [cd, sd] = await Promise.all([apiFetch('/api/campaigns'), apiFetch('/api/smtp-accounts')]);
        setCampaigns(cd.campaigns || []); setSmtps(sd.accounts || []);
    }, []);

    const hasRunning = campaigns.some(c => c.status === 'running');
    useEffect(() => {
        if (view !== 'list') return undefined;
        load();
        const ms = hasRunning ? 1000 : 5000;
        const t = setInterval(load, ms);
        return () => clearInterval(t);
    }, [load, view, hasRunning]);

    const send = async (id) => {
        if (launching.has(id)) return;
        setLaunching(prev => new Set([...prev, id]));
        setMsg('🚀 Starting campaign...');
        try {
            const d = await apiFetch(`/api/campaigns/${id}/send`, { method:'POST' });
            if (d.success) {
                setMsg(d.message || (d.scheduled ? '📅 Campaign scheduled!' : '✅ Campaign started'));
                if (d.scheduled) {
                    setCampaigns(prev => prev.map(c => c.id === id ? { ...c, status:'scheduled' } : c));
                } else {
                    setCampaigns(prev => prev.map(c => c.id === id ? { ...c, status:'running' } : c));
                }
            } else {
                let err = d.error || 'Start failed';
                if (d.failures && d.failures.length)
                    err += ` (${d.failures.map(f => f.email || f.host).join(', ')})`;
                setMsg('❌ ' + err);
                setCampaigns(prev => prev.map(c => c.id === id ? { ...c, status:'draft' } : c));
            }
        } catch (e) {
            setMsg('❌ Network error');
            setCampaigns(prev => prev.map(c => c.id === id ? { ...c, status:'draft' } : c));
        } finally {
            setLaunching(prev => { const n = new Set(prev); n.delete(id); return n; });
            load();
        }
    };

    const pause  = async id => { await apiFetch(`/api/campaigns/${id}/pause`,  { method:'POST' }); load(); };
    const resume = async id => { await apiFetch(`/api/campaigns/${id}/resume`, { method:'POST' }); load(); };
    const stop   = async id => { await apiFetch(`/api/campaigns/${id}/stop`,   { method:'POST' }); load(); };
    const del    = async id => { if (!window.confirm('Delete campaign?')) return; await apiFetch(`/api/campaigns/${id}`, { method:'DELETE' }); load(); };
    const dup    = async id => { await apiFetch(`/api/campaigns/${id}/duplicate`, { method:'POST' }); setMsg('✅ Duplicated'); load(); };

    const openEdit = async (c) => {
        const [cd, rd] = await Promise.all([
            apiFetch(`/api/campaigns/${c.id}`),
            apiFetch(`/api/campaigns/${c.id}/recipients?limit=1`)
        ]);
        setEditCampaign({ ...withDefaults(cd.campaign), _total_recipients: rd.total || 0 });
        setView('form');
    };

    const selIds = useMemo(() => [...selected], [selected]);
    const allSelected = campaigns.length > 0 && campaigns.every(c => selected.has(c.id));

    const toggleSel = (id) => {
        setSelected(prev => {
            const n = new Set(prev);
            if (n.has(id)) n.delete(id); else n.add(id);
            return n;
        });
    };

    const toggleAll = () => {
        if (allSelected) setSelected(new Set());
        else setSelected(new Set(campaigns.map(c => c.id)));
    };

    const needSelection = () => {
        if (!selIds.length) { setMsg('Select one or more rows first'); return true; }
        return false;
    };

    const toolbarResend = async () => {
        if (needSelection()) return;
        const targets = campaigns.filter(c => selIds.includes(c.id) && (c.status === 'draft' || c.status === 'completed'));
        if (!targets.length) { setMsg('No draft/completed campaigns in selection to re-send'); return; }
        for (const c of targets) await send(c.id);
        setMsg(`✅ Re-send queued for ${targets.length} campaign(s)`);
    };

    const toolbarPause = async () => {
        if (needSelection()) return;
        for (const id of selIds) {
            const c = campaigns.find(x => x.id === id);
            if (c && c.status === 'running') await pause(id);
        }
        setSelected(new Set());
    };

    const toolbarResume = async () => {
        if (needSelection()) return;
        for (const id of selIds) {
            const c = campaigns.find(x => x.id === id);
            if (c && c.status === 'paused') await resume(id);
        }
        setSelected(new Set());
    };

    const toolbarStop = async () => {
        if (needSelection()) return;
        for (const id of selIds) {
            const c = campaigns.find(x => x.id === id);
            if (c && (c.status === 'running' || c.status === 'paused')) await stop(id);
        }
        setSelected(new Set());
    };

    const toolbarDelete = async () => {
        if (needSelection()) return;
        if (!window.confirm(`Delete ${selIds.length} campaign(s)?`)) return;
        for (const id of selIds) await apiFetch(`/api/campaigns/${id}`, { method:'DELETE' });
        setSelected(new Set());
        load();
    };

    const toolbarDetails = async () => {
        if (needSelection()) return;
        const id = selIds.length === 1 ? selIds[0] : selIds[0];
        const d = await apiFetch(`/api/campaigns/${id}`);
        if (d.campaign) setDetailsCampaign(d.campaign);
    };

    const tabStyle = (active) => ({
        ...S.btnG, 
        background: active ? '#4f46e5' : '#f8fafc', 
        color: active ? '#fff' : '#64748b', 
        border: '1px solid #e2e8f0',
        borderBottom: active ? 'none' : '1px solid #e2e8f0',
        padding: '10px 24px', 
        borderRadius: '8px 8px 0 0', 
        fontWeight: active ? 700 : 600,
        marginRight: 8,
        cursor: 'pointer',
        transform: active ? 'translateY(1px)' : 'none'
    });

    const renderView = () => {
        if (view === 'form') {
            return (
                <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderTop: 'none', padding: 20, borderRadius: '0 8px 8px 8px' }}>
                    <CampaignForm
                        key={editCampaign == null ? 'new' : String(editCampaign.id)}
                        initial={editCampaign}
                        allSmtps={smtps}
                        onSaved={() => { setView('list'); setEditCampaign(null); load(); }}
                        onCancel={() => { setView('list'); setEditCampaign(null); }} />
                </div>
            );
        }
        if (view === 'recipients') {
            return (
                <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderTop: 'none', padding: 20, borderRadius: '0 8px 8px 8px' }}>
                    <RecipientsPanel campaign={recCampaign} onBack={() => { setView('list'); setRecCampaign(null); load(); }} />
                </div>
            );
        }
        if (view === 'test_history') {
            return (
                <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderTop: 'none', padding: 20, borderRadius: '0 8px 8px 8px' }}>
                    <div className="portlet light bordered zack-panel" style={{ borderTop: '4px solid #8b5cf6' }}>
                        <div className="portlet-title">
                            <span className="caption-subject uppercase" style={{ color: '#8b5cf6', fontWeight: 800 }}>
                                <i className="fa fa-history" /> Test History
                            </span>
                        </div>
                        <div className="portlet-body" style={{ padding: '40px 25px', textAlign: 'center', color: '#94a3b8' }}>
                            <div style={{ fontSize: 48, marginBottom: 12 }}><i className="fa fa-history" /></div>
                            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: '#64748b' }}>No Recent Tests</div>
                            <div style={{ fontSize: 13 }}>Your test sends will appear here once you run a campaign test.</div>
                        </div>
                    </div>
                </div>
            );
        }

        const tbBtn = (style, onClick, title, children) => (
            <button type="button" title={title} onClick={onClick}
                style={{ ...S.btnS, padding:'6px 10px', fontSize:12, ...style }}>{children}</button>
        );

        return (
            <div className="zack-send-root" style={{ background: '#fff', border: '1px solid #e2e8f0', borderTop: 'none', padding: 20, borderRadius: '0 8px 8px 8px', fontSize: 13, color: '#1e293b' }}>
                <div className="zack-send-hero" style={{ marginBottom: 20, borderRadius: 8, padding: '20px 24px' }}>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap: 14 }}>
                        <div>
                            <div style={{ fontSize: 11, opacity: 0.88, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 6 }}>Hikari Mail</div>
                            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5 }}>SMTP Drops Monitor</div>
                            <div style={{ fontSize: 13, opacity: 0.9, marginTop: 6 }}>Campaign send queue — select rows and use the toolbar</div>
                        </div>
                    </div>
                </div>
                {msg && <div style={S.msg}>{msg} <button type="button" onClick={() => setMsg('')} style={{ float:'right', background:'none', border:'none', cursor:'pointer', fontSize:16 }}>✕</button></div>}

                {!!campaigns.length && (
                    <div className="portlet light bordered zack-panel" style={{ marginBottom: 12, borderLeft: '4px solid #3b82f6' }}>
                        <div className="portlet-body" style={{ padding: '12px 20px', display:'flex', flexWrap:'wrap', gap:8, alignItems:'center' }}>
                            {tbBtn({ background:'#ecfdf5', color:'#047857', borderColor:'#a7f3d0' }, toolbarResend, 'Re-send', '♻ Resend')}
                            {tbBtn({ background:'#fff', color:'#334155', borderColor:'#cbd5e1' }, toolbarDetails, 'Details', '🖥 Details')}
                            {tbBtn({ background:'#eff6ff', color:'#1d4ed8', borderColor:'#bfdbfe' }, toolbarResume, 'Resume', '▶ Resume')}
                            {tbBtn({ background:'#fffbeb', color:'#b45309', borderColor:'#fde68a' }, toolbarPause, 'Pause', '⏸ Pause')}
                            {tbBtn({ background:'#fef2f2', color:'#b91c1c', borderColor:'#fecaca' }, toolbarStop, 'Stop', '■ Stop')}
                            {tbBtn({ background:'#fef2f2', color:'#b91c1c', borderColor:'#fecaca' }, toolbarDelete, 'Delete', '✕ Delete')}
                            <span style={{ fontSize:11, fontWeight:700, color:'#6366f1', marginLeft:8 }}>{selIds.length} selected</span>
                        </div>
                    </div>
                )}

                {!!campaigns.length && (
                    <div className="portlet light bordered zack-panel" style={{ padding: 0, overflow:'hidden', borderLeft: '4px solid #22c55e' }}>
                        <div className="portlet-title" style={{ background: '#f8fafc' }}>
                            <span className="caption-subject uppercase" style={{ color: '#1e293b', fontWeight: 800 }}>
                                <i className="fa fa-paper-plane" /> Email Campaigns ({campaigns.length})
                            </span>
                        </div>
                        <div className="portlet-body" style={{ padding: 0 }}>
                        <div style={{ overflowX:'auto' }}>
                        <table style={{ width:'100%', borderCollapse:'collapse', minWidth:900 }}>
                            <thead>
                                <tr style={{ background:'#f1f5f9', borderBottom:'1px solid #cbd5e1' }}>
                                    <th style={{ ...S.th, width:36 }}>
                                        <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
                                    </th>
                                    <th style={{ ...S.th, width:48 }}>Id</th>
                                    <th style={S.th}>Campaign</th>
                                    <th style={{ ...S.th, width:100 }}>Status</th>
                                    <th style={{ ...S.th, width:120 }}>Progress</th>
                                    <th style={{ ...S.th, width:160 }}>Sent / Fail / Left</th>
                                    <th style={{ ...S.th, width:100 }}>SMTP</th>
                                    <th style={{ ...S.th, width:120 }}>Speed</th>
                                    <th style={{ ...S.th, width:140 }}>Created</th>
                                    <th style={{ ...S.th, width:200 }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {campaigns.map(c => {
                                    const pct = c.total_recipients ? Math.round((c.sent_count / c.total_recipients) * 100) : 0;
                                    const isLaunching = launching.has(c.id);
                                    const left = Math.max(0, c.total_recipients - c.sent_count - c.failed_count);
                                    return (
                                        <tr key={c.id} style={{ borderBottom:'1px solid #f1f5f9' }}>
                                            <td style={S.td}><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSel(c.id)} /></td>
                                            <td style={{ ...S.td, fontFamily:'monospace', color:'#64748b' }}>{c.id}</td>
                                            <td style={S.td}>
                                                <div style={{ fontWeight:700, color:'#1e293b' }}>{c.name}</div>
                                                <div style={{ fontSize:11, color:'#94a3b8' }}>
                                                    {c.use_smtp_email ? 'From: SMTP' : `From: ${c.custom_from_email || 'custom'}`}
                                                    {c.reply_to ? ` · R: ${c.reply_to}` : ''}
                                                </div>
                                            </td>
                                            <td style={S.td}><Badge status={c.status} /></td>
                                            <td style={S.td}>
                                                <div style={{ fontSize:11, fontWeight:700, color: c.status === 'running' ? '#16a34a' : '#6366f1' }}>{pct}%</div>
                                                <div style={{ background:'#e2e8f0', borderRadius:3, height:6, overflow:'hidden', marginTop:4, maxWidth:110 }}>
                                                    <div style={{
                                                        width:`${pct}%`,
                                                        minWidth: c.status === 'running' && pct > 0 ? '3px' : 0,
                                                        background: c.status === 'running' ? '#22c55e' : '#94a3b8',
                                                        animation: c.status === 'running' ? 'sendingPulse 1.2s ease-in-out infinite' : 'none',
                                                        borderRadius:3, height:6, transition:'width .35s ease-out'
                                                    }} />
                                                </div>
                                            </td>
                                            <td style={{ ...S.td, fontSize:12, fontFamily:'ui-monospace,monospace' }}>
                                                {c.sent_count} / {c.failed_count} / {left}
                                            </td>
                                            <td style={S.td}>{(c.smtp_accounts || []).length}</td>
                                            <td style={{ ...S.td, fontSize:12 }}>{c.send_speed}/{c.send_speed_unit}</td>
                                            <td style={{ ...S.td, fontSize:11, color:'#64748b' }}>{new Date(c.created_at).toLocaleString()}</td>
                                            <td style={{ ...S.td }}>
                                                <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                                                    {(c.status === 'draft' || c.status === 'scheduled') && (
                                                        <button type="button" style={{ ...S.btnP, padding:'4px 8px', fontSize:11, opacity: isLaunching ? 0.6 : 1 }}
                                                            onClick={() => send(c.id)} disabled={isLaunching}>{isLaunching ? '…' : '▶'}</button>
                                                    )}
                                                    {c.status === 'running' && (
                                                        <button type="button" style={{ ...S.btnS, padding:'4px 8px', fontSize:11 }} onClick={() => pause(c.id)}>⏸</button>
                                                    )}
                                                    {c.status === 'paused' && (
                                                        <button type="button" style={{ ...S.btnS, padding:'4px 8px', fontSize:11 }} onClick={() => resume(c.id)}>▶</button>
                                                    )}
                                                    {(c.status === 'running' || c.status === 'paused') && (
                                                        <button type="button" style={{ ...S.btnS, padding:'4px 8px', fontSize:11, background:'#fef2f2', color:'#b91c1c', borderColor:'#fecaca' }} onClick={() => stop(c.id)}>■</button>
                                                    )}
                                                    {c.status === 'completed' && (
                                                        <button type="button" style={{ ...S.btnS, padding:'4px 8px', fontSize:11, opacity: isLaunching ? 0.6 : 1 }}
                                                            onClick={() => send(c.id)} disabled={isLaunching}>↻</button>
                                                    )}
                                                    <button type="button" style={{ ...S.btnS, padding:'4px 8px', fontSize:11 }} onClick={() => { setRecCampaign(c); setView('recipients'); }}>👥</button>
                                                    <button type="button" style={{ ...S.btnS, padding:'4px 8px', fontSize:11 }} onClick={() => openEdit(c)}>✏️</button>
                                                    <button type="button" style={{ ...S.btnS, padding:'4px 8px', fontSize:11 }} onClick={() => dup(c.id)}>📋</button>
                                                    <button type="button" style={{ ...S.btnDel, padding:'4px 8px', fontSize:11 }} onClick={() => del(c.id)}>🗑</button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    </div>
                    </div>
                )}

                {!campaigns.length && (
                    <div style={{ textAlign:'center', padding:64, color:'#94a3b8' }}>
                        <div style={{ fontSize:48, marginBottom:12 }}>📭</div>
                        <div style={{ fontSize:18, fontWeight:600, marginBottom:8 }}>No campaigns yet</div>
                        <button style={S.btnP} onClick={() => { setEditCampaign(null); setView('form'); }}>Create your first</button>
                    </div>
                )}

                {detailsCampaign && (
                    <div style={{
                        position:'fixed', inset:0, background:'rgba(15,23,42,0.45)', zIndex:1000,
                        display:'flex', alignItems:'center', justifyContent:'center', padding:24
                    }} onClick={() => setDetailsCampaign(null)}>
                        <div style={{ background:'#fff', borderRadius:12, maxWidth:560, width:'100%', padding:24, boxShadow:'0 25px 50px -12px rgba(0,0,0,0.25)' }}
                            onClick={e => e.stopPropagation()}>
                            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16 }}>
                                <div>
                                    <div style={{ fontSize:12, color:'#64748b', fontWeight:600 }}>Process details</div>
                                    <div style={{ fontSize:18, fontWeight:800, color:'#1e293b' }}>{detailsCampaign.name}</div>
                                </div>
                                <button type="button" style={{ ...S.btnG, padding:'6px 12px' }} onClick={() => setDetailsCampaign(null)}>Close</button>
                            </div>
                            <div style={{ fontSize:13, color:'#334155', lineHeight:1.6 }}>
                                <div><strong>Id</strong> {detailsCampaign.id} · <strong>Status</strong> {detailsCampaign.status}</div>
                                <div><strong>Recipients</strong> {detailsCampaign.total_recipients} · <strong>Sent</strong> {detailsCampaign.sent_count} · <strong>Failed</strong> {detailsCampaign.failed_count}</div>
                                <div><strong>SMTP accounts</strong> {(detailsCampaign.smtp_accounts || []).length} · <strong>Speed</strong> {detailsCampaign.send_speed}/{detailsCampaign.send_speed_unit}</div>
                                <div><strong>Subject (first line)</strong> {(detailsCampaign.subject_lines || [])[0] || '—'}</div>
                                {detailsCampaign.repeat > 1 && (
                                    <div><strong>Repeat</strong> {detailsCampaign.repeat_current || 0}/{detailsCampaign.repeat}</div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div>
            <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', marginBottom: -1, zIndex: 1, position: 'relative' }}>
                <button type="button" style={tabStyle(view === 'list' || view === 'recipients')} onClick={() => { setView('list'); setEditCampaign(null); }}>
                    <i className="fa fa-list" style={{ marginRight: 6 }} /> Email Campaigns
                </button>
                <button type="button" style={tabStyle(view === 'form' && !editCampaign)} onClick={() => { setView('form'); setEditCampaign(null); }}>
                    <i className="fa fa-plus-circle" style={{ marginRight: 6 }} /> Create New
                </button>
                <button type="button" style={tabStyle(view === 'test_history')} onClick={() => setView('test_history')}>
                    <i className="fa fa-history" style={{ marginRight: 6 }} /> Test History
                </button>
            </div>
            {renderView()}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BOUNCES PAGE  (new — from Python SmartBounceManager)
// ═══════════════════════════════════════════════════════════════════════════════
function BouncesPage() {
    const [data,   setData]   = useState({ bounces: [], total: 0, counts: { hard:0, soft:0, policy:0, unknown:0 } });
    const [type,   setType]   = useState('');
    const [page,   setPage]   = useState(1);
    const [msg,    setMsg]    = useState('');
    const limit = 100;

    const load = useCallback(async () => {
        const q = new URLSearchParams({ page, limit, ...(type ? { type } : {}) });
        const d = await apiFetch(`/api/bounces?${q}`);
        setData(d);
    }, [page, type]);
    useEffect(() => { load(); }, [load]);

    const clearAll = async () => {
        if (!window.confirm('Clear all bounce records?')) return;
        await apiFetch('/api/bounces', { method:'DELETE' });
        setMsg('✅ Cleared'); load();
    };

    const typeColor = { hard:'#ef4444', soft:'#f59e0b', policy:'#8b5cf6', unknown:'#64748b' };

    return (
        <div className="zack-send-root" style={{ fontSize: 13, color: '#1e293b' }}>
            <div className="zack-send-hero" style={{ marginBottom: 20 }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap: 14 }}>
                    <div>
                        <div style={{ fontSize: 11, opacity: 0.88, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 6 }}>Hikari Mail</div>
                        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5 }}>Bounce Records</div>
                        <div style={{ fontSize: 13, opacity: 0.9, marginTop: 6 }}>{data.total} total bounces recorded</div>
                    </div>
                </div>
            </div>
            {msg && <div style={S.msg}>{msg}<button onClick={() => setMsg('')} style={{ float:'right', background:'none', border:'none', cursor:'pointer', fontSize:16 }}>✕</button></div>}

            {/* Bounce type summary cards */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:16 }}>
                {['hard','soft','policy','unknown'].map(t => (
                    <div key={t} onClick={() => { setType(type === t ? '' : t); setPage(1); }}
                        style={{ background: type === t ? typeColor[t] : '#fff', color: type === t ? '#fff' : '#1e293b',
                            border:`2px solid ${typeColor[t]}`, borderRadius:10, padding:'14px 16px', cursor:'pointer', transition:'all .15s',
                            boxShadow: type === t ? `0 4px 15px ${typeColor[t]}44` : 'none' }}>
                        <div style={{ fontSize:26, fontWeight:800 }}>{data.counts[t] || 0}</div>
                        <div style={{ fontSize:12, fontWeight:600, marginTop:2, opacity: type === t ? 1 : 0.7 }}>{t.toUpperCase()} BOUNCES</div>
                    </div>
                ))}
            </div>

            <div className="portlet light bordered zack-panel" style={{ marginBottom: 16 }}>
                <div className="portlet-body" style={{ padding: '15px 25px', display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                    <span style={{ fontSize:13, fontWeight: 700, color:'#475569', marginRight: 8 }}>Filter Results:</span>
                    {['','hard','soft','policy','unknown'].map(t => (
                        <button key={t} style={{ ...S.btnS, background: type === t ? '#6366f1' : '#f1f5f9', color: type === t ? '#fff' : '#374151', border: type === t ? '1px solid #6366f1' : '1px solid #e2e8f0' }}
                            onClick={() => { setType(t); setPage(1); }}>
                            {t || 'All Records'}
                        </button>
                    ))}
                    <button style={{ ...S.btnDel, marginLeft:'auto' }} onClick={clearAll}><i className="fa fa-trash-o" /> Clear All Records</button>
                </div>
            </div>

            <div className="portlet light bordered zack-panel" style={{ padding: 0, overflow: 'hidden', borderLeft: '4px solid #f43f5e' }}>
                <div className="portlet-title" style={{ background: '#f8fafc' }}>
                    <span className="caption-subject uppercase" style={{ color: '#1e293b', fontWeight: 800 }}>
                        <i className="fa fa-history" /> Bounce History ({data.total})
                    </span>
                </div>
                <div className="portlet-body" style={{ padding: 0 }}>
                    <div style={{ overflowX:'auto' }}>
                        <table style={{ width:'100%', borderCollapse:'collapse' }}>
                            <thead><tr style={{ background:'#f1f5f9', borderBottom: '1px solid #cbd5e1' }}>
                                {['Email','Type','Error','SMTP Used','Time'].map(h => <th key={h} style={S.th}>{h}</th>)}
                            </tr></thead>
                            <tbody>
                                {data.bounces.map(b => (
                                    <tr key={b.id} style={{ borderBottom:'1px solid #f1f5f9' }}>
                                        <td style={{ ...S.td, fontWeight:700 }}>{b.email}</td>
                                        <td style={S.td}><span style={{ color: typeColor[b.type] || '#64748b', fontWeight:800 }}>● {b.type.toUpperCase()}</span></td>
                                        <td style={{ ...S.td, color:'#64748b', fontSize:12, maxWidth:260, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{b.error}</td>
                                        <td style={{ ...S.td, fontSize:12 }}>{b.smtp_used}</td>
                                        <td style={{ ...S.td, fontSize:12, color:'#94a3b8' }}>{fmt24(b.ts)}</td>
                                    </tr>
                                ))}
                                {!data.bounces.length && <tr><td colSpan={5} style={{ textAlign:'center', padding:40, color:'#94a3b8' }}>No bounces recorded yet</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </div>
                <div style={{ display:'flex', gap:8, justifyContent:'center', padding: '15px', background: '#f8fafc', borderTop: '1px solid #e2e8f0', alignItems:'center' }}>
                    <button style={S.btnG} disabled={page===1} onClick={() => setPage(p => p-1)}>◀</button>
                    <span style={{ fontSize:13, fontWeight: 700, color:'#475569' }}>Page {page} of {Math.max(1, Math.ceil(data.total/limit))} ({data.total} records)</span>
                    <button style={S.btnG} disabled={page*limit >= data.total} onClick={() => setPage(p => p+1)}>▶</button>
                </div>
            </div>
        </div>
    );
}


// ═══════════════════════════════════════════════════════════════════════════════
//  SUPPRESSION PAGE (BLACKLIST)
// ═══════════════════════════════════════════════════════════════════════════════
function SuppressionPage() {
    const [info,  setInfo]  = useState({ total:0, emails:[] });
    const [email, setEmail] = useState('');
    const [msg,   setMsg]   = useState('');

    const load = useCallback(async () => { const d = await apiFetch('/api/suppression'); setInfo(d); }, []);
    useEffect(() => { load(); }, [load]);

    const add = async () => {
        if (!email.includes('@')) { setMsg('❌ Invalid email address'); return; }
        await apiFetch('/api/suppression', { method:'POST', body:JSON.stringify({ email }) });
        setEmail(''); setMsg(''); load();
    };
    const remove     = async e => { await apiFetch('/api/suppression', { method:'DELETE', body:JSON.stringify({ email:e }) }); load(); };
    const importFile = async e => {
        const f = e.target.files[0]; if (!f) return; e.target.value = '';
        const fd = new FormData(); fd.append('file', f);
        const d = await fetch(`${API}/api/suppression/import`, { method:'POST', body:fd }).then(r => r.json());
        setMsg(`✅ Import Complete. Added: ${d.added} | Total: ${d.total}`); load();
    };
    const clearAll = async () => {
        if (!window.confirm('Are you sure you want to completely clear the suppression blacklist?')) return;
        await apiFetch('/api/suppression/clear', { method:'DELETE' }); load();
    };

    return (
        <div className="zack-send-root" style={{ fontSize: 13, color: '#1e293b' }}>
            <div className="zack-send-hero" style={{ marginBottom: 20 }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap: 14 }}>
                    <div>
                        <div style={{ fontSize: 11, opacity: 0.88, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 6 }}>Hikari Mail</div>
                        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5 }}>Suppression List</div>
                        <div style={{ fontSize: 13, opacity: 0.9, marginTop: 6 }}>{info.total} blocked emails from campaigns</div>
                    </div>
                </div>
            </div>
            {msg && <div style={{ ...S.msg, background:'#f0fdf4', color:'#166534', borderColor:'#bbf7d0' }}>{msg} <button onClick={() => setMsg('')} style={{ float:'right', background:'none', border:'none', cursor:'pointer', fontSize:16, color:'#166534' }}>✕</button></div>}
            
            <div className="portlet light bordered zack-panel" style={{ marginBottom: 20, borderTop: '4px solid #f43f5e' }}>
                <div className="portlet-title">
                    <span className="caption-subject uppercase" style={{ color: '#f43f5e', fontWeight: 800 }}>
                        <i className="fa fa-plus-circle" /> Add to Blacklist
                    </span>
                </div>
                <div className="portlet-body" style={{ padding: '20px 25px' }}>
                    <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
                        <input style={{ ...S.input, flex:1, minWidth:250, padding:10, fontSize:14 }} placeholder="Block a single email address (e.g. abuse@domain.com)" value={email}
                            onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
                        <button style={{ ...S.btnP, padding:'10px 25px' }} onClick={add}><i className="fa fa-ban"/> Block Email</button>
                        <div style={{ width:1, height:36, background:'#cbd5e1', margin:'0 10px' }}></div>
                        <label style={{ ...S.btnG, cursor:'pointer', padding:'10px 25px', margin:0 }}>📂 Bulk Import (CSV/TXT)
                            <input type="file" accept=".csv,.txt" style={{ display:'none' }} onChange={importFile} />
                        </label>
                        <button style={{ ...S.btnDel, padding:'10px 25px', marginLeft:'auto' }} onClick={clearAll}><i className="fa fa-eraser" /> Clear All</button>
                    </div>
                </div>
            </div>

            <div className="portlet light bordered zack-panel" style={{ padding: 0, overflow:'hidden', borderLeft: '4px solid #1e293b' }}>
                <div className="portlet-title" style={{ background: '#f8fafc' }}>
                    <span className="caption-subject uppercase" style={{ color: '#1e293b', fontWeight: 800 }}>
                        <i className="fa fa-shield" /> Blocked Recipients ({info.total})
                    </span>
                </div>
                <div className="portlet-body" style={{ padding: 0 }}>
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:14 }}>
                    <thead>
                        <tr style={{ background:'#f1f5f9', borderBottom:'1px solid #cbd5e1', textAlign:'left', color:'#475569' }}>
                            <th style={{ padding:'14px 20px', fontWeight:600 }}>Blocked Email Address</th>
                            <th style={{ padding:'14px 20px', fontWeight:600, width:150, textAlign:'right' }}>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {info.emails.length
                            ? info.emails.map(e => (
                                <tr key={e} style={{ borderBottom:'1px solid #f1f5f9' }}>
                                    <td style={{ padding:'14px 20px', fontWeight:500 }}>{e}</td>
                                    <td style={{ padding:'14px 20px', textAlign:'right' }}>
                                        <button style={{ ...S.btnS, color:'#ef4444', borderColor:'#ef4444', padding:'6px 12px' }} onClick={() => remove(e)}>Unblock</button>
                                    </td>
                                </tr>
                            ))
                            : <tr><td colSpan="2" style={{ textAlign:'center', padding:40, color:'#94a3b8' }}>Suppression list is currently empty. No emails are bypassing campaigns.</td></tr>}
                    </tbody>
                </table>
                {info.total > 200 && <div style={{ textAlign:'center', color:'#94a3b8', fontSize:13, padding:15, background:'#f8fafc', borderTop:'1px solid #f1f5f9' }}>Showing last 200 of {info.total} blocked emails</div>}
                </div>
            </div>
        </div>
    );
}


// ═══════════════════════════════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════
function Dashboard() {
    const [data, setData] = useState({ smtpCount:0, campaignCount:0, activeCampaigns:[], totalSent:0 });
    const [bounces, setBounces] = useState({ counts:{ hard:0, soft:0, policy:0, unknown:0 }, total:0 });
    const [topDomains, setTopDomains] = useState([]);

    const load = useCallback(async () => {
        const [sm, ca, all, bo, dom] = await Promise.all([
            apiFetch('/api/smtp-accounts'),
            apiFetch('/api/campaigns/active'),
            apiFetch('/api/campaigns'),
            apiFetch('/api/bounces?limit=1'),
            apiFetch('/api/domain-stats'),
        ]);
        setData({
            smtpCount:       (sm.accounts  || []).length,
            campaignCount:   (all.campaigns || []).length,
            activeCampaigns: ca.campaigns   || [],
            totalSent:       (all.campaigns || []).reduce((s, c) => s + (c.sent_count || 0), 0),
        });
        setBounces({ counts: bo.counts || {}, total: bo.total || 0 });
        setTopDomains((dom.domains || []).slice(0, 5));
    }, []);
    useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, [load]);

    const StatCol = ({ label, val, bg, icon }) => (
        <div style={{ background: bg, color: '#fff', padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative', overflow: 'hidden', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
            <div style={{ position: 'relative', zIndex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, opacity: 0.9 }}>{label}</div>
                <div style={{ fontSize: 36, fontWeight: 800, lineHeight: 1 }}>{val}</div>
            </div>
            <i className={`fa fa-${icon}`} style={{ fontSize: 54, opacity: 0.2, position: 'relative', zIndex: 1 }} />
        </div>
    );

    const StatWhite = ({ label, val, color, icon }) => (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', padding: '20px 24px', position: 'relative', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 36, color: color || '#1e293b', fontWeight: 400, lineHeight: 1, marginBottom: 8 }}>{val}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>{label}</div>
            <i className={`fa fa-${icon}`} style={{ position: 'absolute', right: 20, bottom: 20, fontSize: 24, color: color || '#cbd5e1', opacity: 0.4 }} />
        </div>
    );

    return (
        <div className="zack-send-root" style={{ fontSize: 13, color: '#1e293b' }}>
            <div className="zack-send-hero" style={{ marginBottom: 20 }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap: 14 }}>
                    <div>
                        <div style={{ fontSize: 11, opacity: 0.88, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 6 }}>Hikari Mail</div>
                        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5 }}>Dashboard</div>
                        <div style={{ fontSize: 13, opacity: 0.9, marginTop: 6 }}>Overview of metrics and active campaigns</div>
                    </div>
                </div>
            </div>
            
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:10, marginBottom:10 }}>
                <StatCol label="Opens"      val="0" bg="#0ea5e9" icon="eye" />
                <StatCol label="Clicks"     val="0" bg="#22c55e" icon="external-link" />
                <StatCol label="Unsubscribes" val="0" bg="#f59e0b" icon="user-times" />
                <StatCol label="Active SMTPs" val={data.smtpCount} bg="#3b82f6" icon="server" />
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:10, marginBottom:24 }}>
                <StatCol label="Received"   val="0" bg="#06b6d4" icon="arrow-down" />
                <StatCol label="Delivered"  val={data.totalSent.toLocaleString()} bg="#10b981" icon="arrow-up" />
                <StatCol label="Defred"     val="0" bg="#f59e0b" icon="exclamation-triangle" />
                <StatCol label="Bounced"    val={bounces.total} bg="#ef4444" icon="times" />
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:10, marginBottom:24 }}>
                <StatWhite label="Daily Tests"     val="0" color="#0ea5e9" icon="flask" />
                <StatWhite label="Daily Drops"     val={data.activeCampaigns.length} color="#14b8a6" icon="envelope-o" />
                <StatWhite label="Daily Sent"      val={data.totalSent} color="#10b981" icon="paper-plane" />
                <StatWhite label="Daily Delivered" val="0" color="#3b82f6" icon="check-square-o" />
                <StatWhite label="Daily Hard Bounced" val={bounces.counts.hard || 0} color="#ef4444" icon="thumbs-o-down" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16 }}>
                <div>
                    {data.activeCampaigns.length > 0 ? (
                        <div className="portlet light bordered zack-panel" style={{ height: '100%' }}>
                            <div className="portlet-title"><span className="caption-subject uppercase"><i className="fa fa-rocket" /> Active Campaigns</span></div>
                            <div className="portlet-body">
                                {data.activeCampaigns.map(c => (
                                    <div key={c.id} style={{ marginBottom:14, background:'#f8fafc', padding:12, borderRadius:8, border:'1px solid #e2e8f0' }}>
                                        <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, marginBottom:4 }}>
                                            <span style={{ fontWeight:600, color:'#1e293b' }}>{c.name}</span>
                                            <span style={{ color:'#64748b' }}>{c.sent}/{c.total} ({c.progress}%)</span>
                                        </div>
                                        <div style={{ background:'#e2e8f0', borderRadius:4, height:8, overflow:'hidden' }}>
                                            <div style={{ width:`${c.progress}%`, background: c.status==='running'?'#22c55e':'#f59e0b', borderRadius:4, height:8, transition:'width .5s' }} />
                                        </div>
                                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:8 }}>
                                            <Badge status={c.status} />
                                            <span style={{ fontSize:11, color:'#94a3b8' }}>{c.send_speed}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="portlet light bordered zack-panel" style={{ height: '100%', display:'flex', alignItems:'center', justifyContent:'center', color:'#94a3b8', padding:40 }}>
                            No active campaigns
                        </div>
                    )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {bounces.total > 0 && (
                        <div className="portlet light bordered zack-panel">
                            <div className="portlet-title"><span className="caption-subject uppercase"><i className="fa fa-pie-chart" /> Bounce Summary ({bounces.total})</span></div>
                            <div className="portlet-body">
                                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10 }}>
                                    {[['hard','#ef4444'],['soft','#f59e0b'],['policy','#8b5cf6'],['unknown','#64748b']].map(([t, color]) => (
                                        <div key={t} style={{ textAlign:'center', background:'#f8fafc', borderRadius:8, padding:'10px 0', border:'1px solid #f1f5f9' }}>
                                            <div style={{ fontSize:20, fontWeight:800, color }}>{bounces.counts[t] || 0}</div>
                                            <div style={{ fontSize:10, color:'#64748b', textTransform:'uppercase', fontWeight:700 }}>{t}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {topDomains.length > 0 && (
                        <div className="portlet light bordered zack-panel">
                            <div className="portlet-title"><span className="caption-subject uppercase"><i className="fa fa-globe" /> Top Domains</span></div>
                            <div className="portlet-body" style={{ padding: 0 }}>
                                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                                    <thead><tr style={{ background:'#f8fafc', borderBottom:'1px solid #e2e8f0' }}>
                                        {['Domain','Sent','Fail','Rate'].map(h => <th key={h} style={S.th}>{h}</th>)}
                                    </tr></thead>
                                    <tbody>
                                        {topDomains.map(d => (
                                            <tr key={d.domain} style={{ borderBottom:'1px solid #f1f5f9' }}>
                                                <td style={S.td}>{d.domain}</td>
                                                <td style={{ ...S.td, color:'#22c55e', fontWeight:700 }}>{d.sent}</td>
                                                <td style={{ ...S.td, color:'#ef4444', fontWeight:700 }}>{d.failed}</td>
                                                <td style={{ ...S.td, fontWeight:700 }}>{d.rate}%</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DATA LISTS PAGE
// ═══════════════════════════════════════════════════════════════════════════════
const EMAIL_LIST_TYPES = ['Fresh List', 'Clean List', 'Openers List', 'Clickers List', 'Leads List', 'Unsubscribers List', 'Opt Outs List', 'Seeds List'];

function DataListsPage() {
    const [lists, setLists]     = useState([]);
    const [msg, setMsg]        = useState('');
    const [uploading, setUp]   = useState(false);
    const [form, setForm]      = useState({
        name: '', provider: '', isp: '', countries: '', verticals: '',
        initial_emails_type: 'Fresh List',
        allow_duplicates: 'Disabled',
        filter_data: 'Enabled',
    });

    const load = useCallback(() => {
        apiFetch('/api/data-lists').then(r => { if (r.success) setLists(r.lists || []); }).catch(() => {});
    }, []);
    useEffect(() => { load(); }, [load]);

    const upload = async (e) => {
        e.preventDefault();
        const fileInput = e.target.querySelector('input[type=file]');
        const f = fileInput && fileInput.files[0];
        if (!f) { setMsg('❌ Choose a CSV or TXT file'); return; }
        setUp(true);
        setMsg('');
        const fd = new FormData();
        fd.append('file', f);
        fd.append('name', form.name || f.name.replace(/\.[^.]+$/, ''));
        fd.append('provider', form.provider);
        fd.append('isp', form.isp);
        fd.append('countries', form.countries);
        fd.append('verticals', form.verticals);
        fd.append('initial_emails_type', form.initial_emails_type);
        fd.append('allow_duplicates', form.allow_duplicates);
        fd.append('filter_data', form.filter_data);
        const r = await fetch(`${API}/api/data-lists`, { method: 'POST', body: fd }).then(x => x.json());
        setUp(false);
        if (r.success) {
            setMsg(`✅ Uploaded “${r.list.name}”: ${r.list.record_count} emails stored`);
            fileInput.value = '';
            load();
        } else setMsg('❌ ' + (r.error || 'Upload failed'));
    };

    const del = async (id) => {
        if (!window.confirm('Delete this list and its stored emails?')) return;
        await apiFetch(`/api/data-lists/${id}`, { method: 'DELETE' });
        load();
    };

    const inp = (k, v) => setForm(p => ({ ...p, [k]: v }));

    return (
        <div className="zack-send-root" style={{ fontSize: 13, color: '#1e293b' }}>
            <div className="zack-send-hero" style={{ marginBottom: 20 }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap: 14 }}>
                    <div>
                        <div style={{ fontSize: 11, opacity: 0.88, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 6 }}>Hikari Mail</div>
                        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5 }}>Data lists</div>
                        <div style={{ fontSize: 13, opacity: 0.9, marginTop: 6 }}>Upload CSV (email column) or one email per line. Filter data drops invalid addresses. List type is used on the send page filters.</div>
                    </div>
                </div>
            </div>
            {msg && <div style={S.msg}>{msg} <button type="button" onClick={() => setMsg('')} style={{ float:'right', background:'none', border:'none', cursor:'pointer', fontSize:16 }}>✕</button></div>}

            <div className="portlet light bordered zack-panel" style={{ marginBottom: 24, borderTop: '4px solid #10b981' }}>
                <div className="portlet-title">
                    <span className="caption-subject uppercase" style={{ color: '#10b981', fontWeight: 800 }}>
                        <i className="fa fa-cloud-upload" /> Upload Data List
                    </span>
                </div>
                <div className="portlet-body" style={{ padding: '20px 25px' }}>
                    <form onSubmit={upload} style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(180px, 1fr))', gap:12, alignItems:'end' }}>
                        <label style={S.lbl}>List name
                            <input style={S.input} value={form.name} onChange={e => inp('name', e.target.value)} placeholder="My fresh leads" />
                        </label>
                        <label style={S.lbl}>Provider
                            <input style={S.input} value={form.provider} onChange={e => inp('provider', e.target.value)} />
                        </label>
                        <label style={S.lbl}>ISP
                            <input style={S.input} value={form.isp} onChange={e => inp('isp', e.target.value)} />
                        </label>
                        <label style={S.lbl}>Countries
                            <input style={S.input} value={form.countries} onChange={e => inp('countries', e.target.value)} placeholder="US, UK" />
                        </label>
                        <label style={S.lbl}>Verticals
                            <input style={S.input} value={form.verticals} onChange={e => inp('verticals', e.target.value)} />
                        </label>
                        <label style={S.lbl}>Initial type (Fresh/Clean/…)
                            <select style={S.input} value={form.initial_emails_type} onChange={e => inp('initial_emails_type', e.target.value)}>
                                {EMAIL_LIST_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                        </label>
                        <label style={S.lbl}>Filter invalid emails
                            <select style={S.input} value={form.filter_data} onChange={e => inp('filter_data', e.target.value)}>
                                <option value="Enabled">Enabled</option>
                                <option value="Disabled">Disabled</option>
                            </select>
                        </label>
                        <label style={S.lbl}>Allow duplicates
                            <select style={S.input} value={form.allow_duplicates} onChange={e => inp('allow_duplicates', e.target.value)}>
                                <option value="Disabled">Disabled</option>
                                <option value="Enabled">Enabled</option>
                            </select>
                        </label>
                        <label style={S.lbl}>File (.csv / .txt)
                            <input type="file" accept=".csv,.txt" style={{ ...S.input, padding:6 }} />
                        </label>
                        <button type="submit" style={{ ...S.btnP, height: 38 }} disabled={uploading}>{uploading ? 'Uploading…' : '📤 Upload list'}</button>
                    </form>
                </div>
            </div>

            <div className="portlet light bordered zack-panel" style={{ padding: 0, overflow: 'hidden', borderLeft: '4px solid #3b82f6' }}>
                <div className="portlet-title" style={{ background: '#f8fafc' }}>
                    <span className="caption-subject uppercase" style={{ color: '#1e293b', fontWeight: 800 }}>
                        <i className="fa fa-th-list" /> Stored lists ({lists.length})
                    </span>
                </div>
                <div className="portlet-body" style={{ padding: 0 }}>
                    <div style={{ overflowX:'auto' }}>
                        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                            <thead>
                                <tr style={{ background:'#f1f5f9', textAlign:'left', borderBottom: '1px solid #cbd5e1' }}>
                                    {['Id', 'Name', 'Type', 'Emails', 'MX dropped', 'File', 'Created', ''].map(h => <th key={h} style={S.th}>{h}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {lists.map(l => (
                                    <tr key={l.id} style={{ borderBottom:'1px solid #f1f5f9' }}>
                                        <td style={S.td}>{l.id}</td>
                                        <td style={S.td}><span style={{ fontWeight: 700 }}>{l.name}</span></td>
                                        <td style={S.td}>{l.initial_emails_type}</td>
                                        <td style={S.td}>{l.record_count ?? 0}</td>
                                        <td style={S.td}>{l.mx_rejected ?? '—'}</td>
                                        <td style={S.td}>{l.has_emails ? '✓' : '—'}</td>
                                        <td style={S.td}>{l.created_at ? fmt24(l.created_at) : '—'}</td>
                                        <td style={S.td}><button type="button" style={S.btnDel} onClick={() => del(l.id)}>Delete</button></td>
                                    </tr>
                                ))}
                                {!lists.length && (
                                    <tr><td colSpan={8} style={{ textAlign:'center', padding:24, color:'#94a3b8' }}>No lists yet</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SHORTLINK SETTINGS PAGE
// ═══════════════════════════════════════════════════════════════════════════════
function ShortlinkPage() {
    const [settings, setSettings] = useState(null);
    const [clickProtectionSettings, setClickProtectionSettings] = useState(null);
    const [suspiciousClicks, setSuspiciousClicks] = useState([]);
    const [logs, setLogs]         = useState([]);
    const [msg, setMsg]           = useState('');
    const [activeTab, setActiveTab] = useState('settings');

    const load = useCallback(async () => {
        const [s, l, cp, sc] = await Promise.all([
            apiFetch('/api/shortlink-settings'),
            apiFetch('/api/shortlink-logs'),
            apiFetch('/api/click-protection-settings'),
            apiFetch('/api/suspicious-clicks')
        ]);
        if (s.success) setSettings(s.settings);
        if (l.success) setLogs(l.logs || []);
        if (cp.success) setClickProtectionSettings(cp.settings);
        if (sc.success) setSuspiciousClicks(sc.clicks || []);
    }, []);

    useEffect(() => { load(); }, [load]);

    const saveSettings = async () => {
        const r = await apiFetch('/api/shortlink-settings', { method: 'PUT', body: JSON.stringify(settings) });
        if (r.success) setMsg('✅ Settings saved');
        else setMsg('❌ Failed to save settings');
    };

    const saveClickSetting = async (key, val) => {
        const next = { ...clickProtectionSettings, [key]: val };
        const r = await apiFetch('/api/click-protection-settings', { method: 'PUT', body: JSON.stringify(next) });
        if (r.success) setClickProtectionSettings(r.settings);
    };

    const upd = (key, val) => setSettings(prev => ({ ...prev, [key]: val }));
    const updProvider = (p, k, v) => setSettings(prev => ({
        ...prev,
        providers: {
            ...prev.providers,
            [p]: { ...prev.providers[p], [k]: v }
        }
    }));

    if (!settings) return <div style={{ padding: 40, textAlign: 'center' }}>Loading shortlink settings...</div>;

    return (
        <div className="zack-send-root" style={{ fontSize: 13, color: '#1e293b' }}>
            <div className="zack-send-hero" style={{ marginBottom: 20 }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap: 14 }}>
                    <div>
                        <div style={{ fontSize: 11, opacity: 0.88, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 6 }}>Hikari Mail</div>
                        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5 }}>Shortlink & Security</div>
                        <div style={{ fontSize: 13, opacity: 0.9, marginTop: 6 }}>Manage your redirectors, API keys, and click protection</div>
                    </div>
                </div>
            </div>
            
            <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
                <button style={{ ...S.btnG, background: activeTab === 'settings' ? '#4f46e5' : '#fff', color: activeTab === 'settings' ? '#fff' : '#334155' }} onClick={() => setActiveTab('settings')}>API Settings</button>
                <button style={{ ...S.btnG, background: activeTab === 'protection' ? '#4f46e5' : '#fff', color: activeTab === 'protection' ? '#fff' : '#334155' }} onClick={() => setActiveTab('protection')}>Clicks Protection</button>
                <button style={{ ...S.btnG, background: activeTab === 'logs' ? '#4f46e5' : '#fff', color: activeTab === 'logs' ? '#fff' : '#334155' }} onClick={() => setActiveTab('logs')}>Recent Logs</button>
            </div>

            {msg && <div style={S.msg}>{msg} <button onClick={() => setMsg('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button></div>}

            {activeTab === 'settings' && (
                <div className="portlet light bordered zack-panel" style={{ borderTop: '4px solid #6366f1' }}>
                    <div className="portlet-title">
                        <span className="caption-subject uppercase" style={{ color: '#6366f1', fontWeight: 800 }}>
                            <i className="fa fa-cogs" /> Provider Configurations
                        </span>
                    </div>
                    <div className="portlet-body" style={{ padding: '20px 25px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                            {Object.keys(settings.providers).map(p => (
                                <div key={p} style={{ border: '1px solid #e2e8f0', padding: 15, borderRadius: 8, background: '#fff' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: 8 }}>
                                        <strong style={{ fontSize: 14, color: '#1e293b' }}>{p}</strong>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                                            <input type="checkbox" checked={settings.providers[p].enabled} onChange={e => updProvider(p, 'enabled', e.target.checked)} /> 
                                            <span style={{ color: settings.providers[p].enabled ? '#22c55e' : '#94a3b8' }}>{settings.providers[p].enabled ? 'ENABLED' : 'DISABLED'}</span>
                                        </label>
                                    </div>
                                    {p !== 'is.gd' && p !== '1pt.co' && (
                                        <label style={S.lbl}>API Key / Token
                                            <input style={S.input} type="password" value={settings.providers[p].apiKey} onChange={e => updProvider(p, 'apiKey', e.target.value)} placeholder="Enter API Key" />
                                        </label>
                                    )}
                                    {(p === 'is.gd' || p === '1pt.co') && <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>No API key required for this provider.</div>}
                                </div>
                            ))}
                        </div>
                        <div style={{ marginTop: 20, paddingTop: 15, borderTop: '2px dashed #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <label style={{ ...S.lbl, flexDirection: 'row', alignItems: 'center', gap: 8, margin: 0, cursor: 'pointer' }}>
                                <input type="checkbox" style={{ width: 18, height: 18 }} checked={settings.fallbackEnabled} onChange={e => upd('fallbackEnabled', e.target.checked)} /> 
                                <span style={{ fontWeight: 700 }}>Enable Fallback Support</span>
                                <span style={{ fontSize: 12, color: '#64748b', fontWeight: 400 }}>(Try another provider if the primary one fails)</span>
                            </label>
                            <button style={{ ...S.btnP, padding: '10px 30px' }} onClick={saveSettings}><i className="fa fa-save" /> Save Configurations</button>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'protection' && (
                <div className="portlet light bordered zack-panel" style={{ borderTop: '4px solid #f43f5e' }}>
                    <div className="portlet-title">
                        <span className="caption-subject uppercase" style={{ color: '#f43f5e', fontWeight: 800 }}>
                            <i className="fa fa-shield" /> Bot & Security Filter
                        </span>
                    </div>
                    <div className="portlet-body" style={{ padding: '20px 25px' }}>
                        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>Monitor click activity and block suspicious bot traffic automatically.</div>
                        
                        <div style={{ display: 'grid', gap: 20 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 15, padding: '15px 20px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 800, fontSize: 14, color: '#1e293b' }}>Enable Clicks Protection</div>
                                    <div style={{ fontSize: 12, color: '#64748b' }}>Automatically filter out bot clicks and security scanners.</div>
                                </div>
                                <button onClick={() => {
                                    const next = !clickProtectionSettings.enabled;
                                    fetch(`${API}/api/click-protection-settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...clickProtectionSettings, enabled: next }) })
                                        .then(r => r.json()).then(d => { if (d.success) setClickProtectionSettings(d.settings); });
                                }} style={{ ...S.btnP, padding: '8px 25px', background: clickProtectionSettings.enabled ? '#22c55e' : '#64748b', borderColor: clickProtectionSettings.enabled ? '#22c55e' : '#64748b', fontWeight: 800 }}>
                                    {clickProtectionSettings.enabled ? 'PROTECTION ON' : 'PROTECTION OFF'}
                                </button>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                                <label style={S.lbl}>Max Clicks Per Minute
                                    <input style={S.input} type="number" value={clickProtectionSettings.maxClicksPerMinute} onChange={e => saveClickSetting('maxClicksPerMinute', e.target.value)} />
                                </label>
                                <label style={S.lbl}>Bot Score Threshold (0-1)
                                    <input style={S.input} type="number" step="0.1" value={clickProtectionSettings.botScoreThreshold} onChange={e => saveClickSetting('botScoreThreshold', e.target.value)} />
                                </label>
                                <label style={{ ...S.lbl, gridColumn: 'span 2' }}>Fallback URL (Redirect bots here)
                                    <input style={S.input} value={clickProtectionSettings.fallbackUrl} onChange={e => saveClickSetting('fallbackUrl', e.target.value)} placeholder="https://google.com" />
                                </label>
                            </div>

                            <div style={{ borderTop: '2px dashed #e2e8f0', pt: 20 }}>
                                <div style={{ fontWeight: 800, fontSize: 13, color: '#334155', marginBottom: 12 }}>Provider Blacklist (ASN/Name)</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                    {clickProtectionSettings.blacklistProviders.map(p => (
                                        <span key={p} style={{ ...S.tagBadge, padding: '6px 12px', borderRadius: 20, display: 'flex', alignItems: 'center', gap: 8, background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#1e293b', fontWeight: 600 }}>
                                            {p} <i className="fa fa-times" style={{ cursor: 'pointer', color: '#ef4444', fontSize: 10 }} onClick={() => {
                                                const next = clickProtectionSettings.blacklistProviders.filter(x => x !== p);
                                                saveClickSetting('blacklistProviders', next);
                                            }} />
                                        </span>
                                    ))}
                                    <button style={{ ...S.btnG, padding: '4px 15px', borderRadius: 20, fontSize: 11, fontWeight: 700 }} onClick={() => {
                                        const p = window.prompt('Enter Provider Name (e.g. Amazon):');
                                        if (p) saveClickSetting('blacklistProviders', [...clickProtectionSettings.blacklistProviders, p]);
                                    }}><i className="fa fa-plus" /> Add Provider</button>
                                </div>
                            </div>

                            <div style={{ marginTop: 10 }}>
                                <div style={{ fontWeight: 800, fontSize: 13, color: '#334155', marginBottom: 10 }}>Suspicious Clicks Log</div>
                                <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                                    <table style={{ width: '100%', fontSize: 12 }}>
                                        <thead style={{ background: '#f8fafc', position: 'sticky', top: 0, borderBottom: '1px solid #e2e8f0' }}>
                                            <tr><th style={S.th}>IP</th><th style={S.th}>Reason</th><th style={S.th}>Date</th></tr>
                                        </thead>
                                        <tbody>
                                            {suspiciousClicks.map(c => (
                                                <tr key={c.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                    <td style={{ ...S.td, fontWeight: 700 }}>{c.ip}</td>
                                                    <td style={S.td}><span style={{ color: '#ef4444', fontWeight: 600 }}>{c.reason}</span></td>
                                                    <td style={{ ...S.td, color: '#94a3b8' }}>{fmt24(c.ts)}</td>
                                                </tr>
                                            ))}
                                            {!suspiciousClicks.length && <tr><td colSpan={3} style={{ padding: 20, textAlign: 'center', color: '#94a3b8' }}>No suspicious activity logged</td></tr>}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'logs' && (
                <div className="portlet light bordered zack-panel" style={{ padding: 0, overflow: 'hidden', borderLeft: '4px solid #f59e0b' }}>
                    <div className="portlet-title" style={{ background: '#f8fafc' }}>
                        <span className="caption-subject uppercase" style={{ color: '#1e293b', fontWeight: 800 }}>
                            <i className="fa fa-history" /> Shortlink Generation History
                        </span>
                    </div>
                    <div className="portlet-body" style={{ padding: 0 }}>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead><tr style={{ background: '#f1f5f9', textAlign: 'left', borderBottom: '1px solid #cbd5e1' }}>
                                    <th style={S.th}>Provider</th>
                                    <th style={S.th}>Original URL</th>
                                    <th style={S.th}>Short URL</th>
                                    <th style={S.th}>Date</th>
                                </tr></thead>
                                <tbody>
                                    {logs.map(l => (
                                        <tr key={l.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                            <td style={{ ...S.td, fontWeight: 700 }}>{l.provider}</td>
                                            <td style={{ ...S.td, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#64748b' }}>{l.original_url}</td>
                                            <td style={S.td}><a href={l.short_url} target="_blank" rel="noreferrer" style={{ color: '#4f46e5', fontWeight: 700 }}>{l.short_url}</a></td>
                                            <td style={{ ...S.td, color: '#94a3b8' }}>{fmt24(l.ts)}</td>
                                        </tr>
                                    ))}
                                    {!logs.length && <tr><td colSpan={4} style={{ padding: 30, textAlign: 'center', color: '#94a3b8' }}>No generation logs yet</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  APP SHELL
// ═══════════════════════════════════════════════════════════════════════════════
const PAGES = [
    { key:'dashboard',   label:'📊 Dashboard'    },
    { key:'campaigns',   label:'🚀 Campaigns'    },
    { key:'datalists',   label:'🗃️ Data Lists'   },
    { key:'smtp',        label:'🔌 SMTP Accounts' },
    { key:'shortlink',   label:'🔗 Shortlink Settings' },
    { key:'suppression', label:'🚫 Suppression'   },
    { key:'bounces',     label:'⚠️ Bounces'       },
];

export default function App() {
    const [page, setPage] = useState('dashboard');
    const [toasts, setToasts] = useState([]);

    useEffect(() => {
        window.Toast = {
            success: (msg) => {
                const id = Date.now() + Math.random();
                setToasts(prev => [...prev, { id, msg }]);
                setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
            }
        };
        return () => { delete window.Toast; };
    }, []);

    return (
        <div className="ir-layout">
            <div style={{ position: 'fixed', top: 20, right: 20, zIndex: 99999, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {toasts.map(t => (
                    <div key={t.id} style={{
                        background: '#5cb85c',
                        color: '#fff',
                        padding: '16px 20px',
                        borderRadius: 4,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 15,
                        minWidth: 320,
                        position: 'relative'
                    }}>
                        <i className="fa fa-check" style={{ fontSize: 24, marginTop: 4, color: 'rgba(255,255,255,0.9)' }} />
                        <div style={{ flex: 1, paddingRight: 40 }}>
                            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Information Message !</div>
                            <div style={{ fontSize: 13, opacity: 0.95 }}>{t.msg}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'absolute', top: 12, right: 12 }}>
                            <i className="fa fa-user" style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', marginRight: 5 }} />
                            <i className="fa fa-times" style={{ fontSize: 14, cursor: 'pointer', color: 'rgba(255,255,255,0.7)' }} onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))} />
                        </div>
                    </div>
                ))}
            </div>
            <aside className="ir-sidebar">
                <div className="ir-sidebar-brand">
                    <h1><i className="fa fa-envelope-o" /> Zack</h1>
                    <span>Hikari Mail</span>
                </div>
                <nav className="ir-sidebar-nav">
                    {PAGES.map(p => (
                        <button key={p.key} type="button" className={page === p.key ? 'ir-active' : ''} onClick={() => setPage(p.key)}>
                            {p.label}
                        </button>
                    ))}
                </nav>
            </aside>
            <main className="ir-main">
                {page === 'dashboard'   && <Dashboard />}
                {page === 'campaigns'   && <CampaignsPage />}
                {page === 'datalists'   && <DataListsPage />}
                {page === 'smtp'        && <SMTPPage />}
                {page === 'shortlink'   && <ShortlinkPage />}
                {page === 'suppression' && <SuppressionPage />}
                {page === 'bounces'     && <BouncesPage />}
            </main>
        </div>
    );
}