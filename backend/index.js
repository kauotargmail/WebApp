const express = require('express');
const cors = require('cors');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const dns = require('dns');
const nodemailer = require('nodemailer');
const axios = require('axios');

// Public DNS is set globally in the MX validation section below

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const upload = multer({ dest: 'uploads/' });
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

// ─── In-memory store ────────────────────────────────────────────────────────
let smtpAccounts    = [];
let campaigns       = [];
let recipients      = [];
let sendingLogs     = [];
let suppressionList = [];
let bounceRecords   = [];   // { id, email, type, error, campaign_id, smtp_used, ts }
let dataLists       = [];   // uploaded email lists
let affiliateNetworks = []; // registered affiliate networks
let offers            = []; // saved offer templates (subjects + HTML)
let shortlinkSettings = {
    providers: {
        'is.gd': { enabled: true, apiKey: '' },
        'TinyURL': { enabled: true, apiKey: '' },
        'Bitly': { enabled: true, apiKey: '', clientId: '914e6033cd2cff3d3070541abaefa7d2cd15e658', clientSecret: '680f3ff7e269d17a6c63f1276859a330ce73b868' },
        'Short.io': { enabled: true, apiKey: '' },
        'Cutt.ly': { enabled: true, apiKey: '' },
        '1pt.co': { enabled: true, apiKey: '' }
    },
    defaultProvider: 'is.gd',
    fallbackEnabled: true,
    randomEnabled: false
};
let shortlinkLogs     = []; // { id, original_url, short_url, provider, ts }
let clickProtectionSettings = {
    enabled: false,
    blacklistProviders: [
        'CloudFlare', 'Microsoft Corporation', 'Akamai Technologies', 'Google',
        'Microsoft Corp', 'OVH SAS', 'CLOUDFLARENET', 'AKAMAI-AS', 'FASTLY',
        'PAN0001', 'OPENDNS', 'MICROSOFT-CORP-MSN-AS-BLOCK', 'AMAZON-AES',
        'AMAZON-02', 'Leaseweb Deutschland GmbH', 'GOOGLE-CLOUD-PLATFORM',
        'YAHOO-BCST-AC2', 'YAHOO'
    ],
    whitelistIPs: [],
    maxClicksPerMinute: 10,
    maxClicksPerIP: 50,
    botScoreThreshold: 0.7,
    fallbackUrl: 'https://google.com'
};
let suspiciousClicks  = []; // { id, ip, provider, reason, ts, shortId }
let nextId          = 1;

// ─── MX record cache (domain → true/false) ──────────────────────────────────
const mxCache = { valid: new Set(), invalid: new Set() };
const smtpTransporters = new Map(); // Cache transporters by account ID or host:port:user

// ─── Domain send stats (populated during sending) ───────────────────────────
// { 'gmail.com': { sent:10, failed:2 }, ... }
let domainStats = {};

// ─── Bounce classifier (ported from Python SmartBounceManager) ───────────────
function classifyBounce(errorMsg) {
    const m = (errorMsg || '').toLowerCase();
    if (/user unknown|no such user|mailbox not found|invalid address|does not exist|recipient rejected/.test(m))
        return 'hard';
    if (/mailbox full|quota exceeded|temporarily|try again later|service unavailable|greylist/.test(m))
        return 'soft';
    if (/spam|blocked|policy violation|rejected|blacklist|abuse/.test(m))
        return 'policy';
    return 'unknown';
}

// ─── MX validation (ported from Python EmailValidator) ───────────────────────
function isValidEmailSyntax(email) {
    return email && email.includes('@');
}

const RANDOM_NAMES = [
    'Eloise Dare', 'John Smith', 'Jane Doe', 'Michael Brown', 'Sarah Wilson',
    'David Miller', 'James Taylor', 'Robert Jones', 'Mary Williams', 'Patricia Moore',
    'Linda Taylor', 'Barbara Anderson', 'Elizabeth Thomas', 'Jennifer Jackson',
    'Maria Garcia', 'Susan Martinez', 'Margaret Robinson', 'Dorothy Clark',
    'Lisa Rodriguez', 'Nancy Lewis', 'Karen Lee', 'Betty Walker', 'Helen Hall',
    'Sandra Young', 'Donna Allen', 'Carol King', 'Ruth Wright', 'Sharon Scott',
    'Michelle Green', 'Laura Baker', 'Sarah Adams', 'Kimberly Nelson', 'Deborah Hill'
];

function getRandomName() {
    return RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)];
}

function isFieldEmpty(val) {
    if (!val) return true;
    const s = String(val).trim().toLowerCase();
    // Treat frontend default strings and common placeholder text as empty
    const defaults = ['offer name', 'offer subject', 'no subject', '(one per line for rotation)'];
    if (defaults.some(d => s.includes(d))) return true;
    return s === '';
}

// ─── Tag Randomizer (ported from Python TagRandomizer) ──────────────────────
function randomizeTags(text, context = {}) {
    if (!text) return '';
    let res = text;

    // Bracket-based fixed context tags
    const fixedTags = [
        'ip', 'rdns', 'ptr', 'domain', 'custom_domain', 'static_domain', 
        'smtp_user', 'server', 'email_id', 'email', 'email_b64', 
        'name', 'first_name', 'last_name', 'return_path', 'from_name', 
        'subject', 'mail_date', 'message_id', 'negative', 'auto_reply_mailbox',
        'open', 'url', 'unsub', 'optout', 
        'short_open', 'short_url', 'short_unsub', 'short_optout'
    ];

    // Caching for unique tags within the same recipient context
    if (!context._uniqueCache) context._uniqueCache = {};

    res = res.replace(/\[([a-zA-Z0-9_]+)\]/g, (match, tag) => {
        const lowerTag = tag.toLowerCase();
        
        // 1. Check fixed tags from context
        if (['from_name', 'name', 'first_name'].includes(lowerTag)) {
            const val = context[lowerTag];
            // Prevent recursion and bracketed fallbacks: if value involves brackets of its own tag, provide a random name
            if (!val || val.includes(`[${lowerTag}]`) || (typeof val === 'string' && val.startsWith('[') && val.endsWith(']'))) {
                return getRandomName();
            }
            return val;
        }

        if (context.hasOwnProperty(lowerTag)) {
            return context[lowerTag];
        }
        if (fixedTags.includes(lowerTag) && context.hasOwnProperty(lowerTag)) {
            return context[lowerTag];
        }

        // 2. Random / Unique Tags
        let isUnique = lowerTag.startsWith('u');
        let type = isUnique ? lowerTag.substring(1) : lowerTag;
        
        // For unique tags, if already generated for this recipient, return cached version
        if (isUnique && context._uniqueCache[lowerTag]) {
            return context._uniqueCache[lowerTag];
        }
        
        let p = type.split('_');
        let t = p[0]; // e.g., 'a', 'al', 'an', 'n', 'hu', 'hl', 'sp', 'sca'
        let minSize = 8;
        let maxSize = 8; 
        if (p.length === 2) {
            minSize = maxSize = parseInt(p[1]) || 8;
        } else if (p.length === 3) {
            minSize = parseInt(p[1]) || 5;
            maxSize = parseInt(p[2]) || 15;
            if (minSize > maxSize) maxSize = minSize;
        }
        
        let length = Math.floor(Math.random() * (maxSize - minSize + 1)) + minSize;
        
        let chars = '';
        const low = 'abcdefghijklmnopqrstuvwxyz';
        const up  = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const num = '0123456789';

        if (t === 'a')   chars = low + up;
        if (t === 'al')  chars = low;
        if (t === 'au')  chars = up;
        if (t === 'an')  chars = low + up + num;
        if (t === 'anl') chars = low + num;
        if (t === 'anu') chars = up + num;
        if (t === 'n')   chars = num;
        if (t === 'hu')  chars = '0123456789ABCDEF';
        if (t === 'hl')  chars = '0123456789abcdef';
        if (t === 'sp')  chars = ' \t\n';
        if (t === 'sca') chars = '!@#$%^&*()_+~`|}{[]:;?><,./-=';
        
        if (chars) {
            let out = '';
            for (let i = 0; i < length; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
            if (isUnique) context._uniqueCache[lowerTag] = out;
            return out;
        }
        
        // 2. Handle [placeholderN]
        if (lowerTag.startsWith('placeholder')) {
            const val = context[lowerTag];
            if (val !== undefined) return val;
        }

        // 3. If a known person-tag was not found in context, don't return [tag]. Return a random name.
        if (['from_name', 'name', 'first_name', 'last_name'].includes(lowerTag)) {
            return getRandomName();
        }

        return '';
    });

    res = res.replace(/\{([aAn,\d]+|user)\}/g, (match, tag) => {
        if (tag === 'user' && context.email) return context.email.split('@')[0];
        const parts = tag.split(',');
        const length = parseInt(parts[parts.length - 1]);
        if (isNaN(length)) return match;
        let chars = '';
        if (parts.includes('a')) chars += 'abcdefghijklmnopqrstuvwxyz';
        if (parts.includes('A')) chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        if (parts.includes('n')) chars += '0123456789';
        if (!chars) return match;
        let pRes = '';
        for (let i = 0; i < length; i++) pRes += chars.charAt(Math.floor(Math.random() * chars.length));
        return pRes;
    });

    return res;
}

function format24h(date) {
    const d = new Date(date);
    const yr = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    const hr = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const se = String(d.getSeconds()).padStart(2, '0');
    return `${yr}-${mo}-${da} ${hr}:${mi}:${se}`;
}

// Always use public DNS for reliable MX lookups
dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);

async function hasMXRecord(domain) {
    if (mxCache.valid.has(domain))   return true;
    if (mxCache.invalid.has(domain)) return false;
    return new Promise(resolve => {
        dns.resolveMx(domain, (err, addrs) => {
            if (!err && addrs && addrs.length > 0) {
                mxCache.valid.add(domain);
                resolve(true);
            } else {
                mxCache.invalid.add(domain);
                resolve(false);
            }
        });
    });
}

async function validateEmailFull(email) {
    if (!isValidEmailSyntax(email)) return { valid: false, reason: 'Invalid syntax' };
    const domain = email.split('@')[1];
    const ok = await hasMXRecord(domain);
    if (!ok) return { valid: false, reason: `No MX record for ${domain}` };
    return { valid: true };
}



// Guard against double-launch (one running instance per campaign)
const campaignSendTimers = {};
// Track campaigns that are actively being launched (prevents double-click race)
const launchLocks = new Set();

function normalizeSmtpAccountIds(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map(id => parseInt(id, 10)).filter(n => !Number.isNaN(n));
}

function normalizeIntIds(arr) {
    return normalizeSmtpAccountIds(arr);
}

/** Stricter than legacy “has @” — aligns with iResponse recipient checks (FILTER_VALIDATE_EMAIL–style). */
function isValidEmailStrict(email) {
    if (!email || typeof email !== 'string') return false;
    const s = email.replace(/\r|\n/g, '').trim();
    if (!s || s.length > 254) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function bounceEmailLowerSet() {
    return new Set(bounceRecords.map(b => String(b.email || '').toLowerCase().trim()).filter(Boolean));
}

function sanitizeListForClient(l) {
    const { storage_path, ...rest } = l;
    const abs = storage_path ? path.join(__dirname, storage_path) : '';
    const has_emails = !!(storage_path && fs.existsSync(abs));
    return { ...rest, has_emails };
}

function readEmailsFromListFile(list) {
    if (!list.storage_path) return [];
    const abs = path.join(__dirname, list.storage_path);
    if (!fs.existsSync(abs)) return [];
    return fs.readFileSync(abs, 'utf8').split(/\r?\n/).map(e => e.trim()).filter(Boolean);
}

async function verifySmtpAccountNow(acc) {
    const t = nodemailer.createTransport({
        host:   acc.host,
        port:   acc.port,
        secure: acc.port === 465,
        auth:   { user: acc.username, pass: acc.password },
        tls:    { rejectUnauthorized: false },
        connectionTimeout: 25000,
        greetingTimeout:   25000,
        socketTimeout:     25000,
    });
    await t.verify();
    acc.health_status = 'healthy';
    acc.is_active     = true;
    acc.last_tested   = new Date();
    return true;
}

// ─── Persistence ─────────────────────────────────────────────────────────────
function saveData() {
    fs.writeFileSync('data.json', JSON.stringify(
        { smtpAccounts, campaigns, recipients, sendingLogs, suppressionList,
          bounceRecords, dataLists, affiliateNetworks, offers, domainStats, 
          shortlinkSettings, shortlinkLogs, clickProtectionSettings, suspiciousClicks, nextId },
        null, 2
    ));
}

function createTransporter(smtp) {
    let t = smtpTransporters.get(smtp.id);
    if (!t) {
        t = nodemailer.createTransport({
            host: smtp.host, port: smtp.port, secure: smtp.port === 465,
            auth: { user: smtp.username, pass: smtp.password },
            tls:  { rejectUnauthorized: false },
            connectionTimeout: 30000, greetingTimeout: 30000, socketTimeout: 30000,
            pool: true, maxConnections: 1 
        });
        smtpTransporters.set(smtp.id, t);
    }
    return t;
}

try {
    if (fs.existsSync('data.json')) {
        const d = JSON.parse(fs.readFileSync('data.json', 'utf8'));
        smtpAccounts    = d.smtpAccounts    || [];
        campaigns       = (d.campaigns || []).map(c => ({
            ...c,
            smtp_accounts: normalizeSmtpAccountIds(c.smtp_accounts)
        }));
        recipients      = d.recipients      || [];
        sendingLogs     = d.sendingLogs     || [];
        suppressionList = d.suppressionList || [];
        bounceRecords   = d.bounceRecords   || [];
        dataLists       = d.dataLists       || [];
        affiliateNetworks = d.affiliateNetworks || [];
        offers            = d.offers            || [];
        domainStats     = d.domainStats     || {};
        shortlinkSettings = d.shortlinkSettings || shortlinkSettings;
        shortlinkLogs     = d.shortlinkLogs     || [];
        clickProtectionSettings = d.clickProtectionSettings || clickProtectionSettings;
        suspiciousClicks  = d.suspiciousClicks  || [];
        nextId          = d.nextId          || 1;
        console.log(`Loaded: ${smtpAccounts.length} SMTPs, ${campaigns.length} campaigns, ${suppressionList.length} suppressed, ${bounceRecords.length} bounces`);
    }
} catch (e) { console.log('Fresh start'); }

// ─── Health ──────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'healthy', timestamp: new Date() }));

// ════════════════════════════════════════════════════════════════════════════
//  AFFILIATE NETWORKS
// ════════════════════════════════════════════════════════════════════════════
app.get('/api/affiliate-networks', (req, res) =>
    res.json({ success: true, networks: affiliateNetworks })
);

app.post('/api/affiliate-networks', (req, res) => {
    const { affiliate_id, name, status, website, username, password,
            api_platform, network_id, company_name, api_key,
            sub1, sub2, sub3 } = req.body;
    const net = {
        id: nextId++,
        affiliate_id: affiliate_id || '',
        name: name || 'Unnamed Network',
        status: status || 'Activated',
        website: website || '',
        username: username || '',
        password: password || '',
        api_platform: api_platform || 'None',
        network_id: network_id || '',
        company_name: company_name || '',
        api_key: api_key || '',
        sub1: sub1 || {},
        sub2: sub2 || {},
        sub3: sub3 || {},
        created_at: new Date()
    };
    affiliateNetworks.push(net);
    saveData();
    res.json({ success: true, network: net });
});

app.delete('/api/affiliate-networks/:id', (req, res) => {
    const idx = affiliateNetworks.findIndex(n => n.id === parseInt(req.params.id));
    if (idx === -1) return res.status(404).json({ success: false });
    affiliateNetworks.splice(idx, 1);
    saveData();
    res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════════
//  OFFERS (templates for campaigns)
// ════════════════════════════════════════════════════════════════════════════
app.get('/api/offers', (req, res) =>
    res.json({ success: true, offers })
);

function parseOfferBody(body) {
    const { name, affiliate_network_id, subject_lines, from_lines, html_bodies,
        production_id, campaign_id, network_offer_id } = body;
    const subj = Array.isArray(subject_lines)
        ? subject_lines.map(s => String(s).trim()).filter(Boolean)
        : String(subject_lines || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const from = Array.isArray(from_lines)
        ? from_lines.map(s => String(s).trim()).filter(Boolean)
        : String(from_lines || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    let html;
    if (Array.isArray(html_bodies)) {
        html = html_bodies.map(s => String(s)).filter(Boolean);
    } else {
        const t = String(html_bodies || '').trim();
        html = t ? [t] : [];
    }
    const aid = affiliate_network_id !== undefined && affiliate_network_id !== '' && affiliate_network_id != null
        ? parseInt(affiliate_network_id, 10) : null;
    const nidRaw = network_offer_id;
    let nid = nidRaw !== undefined && nidRaw !== '' && nidRaw != null
        ? parseInt(nidRaw, 10) : null;
    if (Number.isNaN(nid) && production_id != null && String(production_id).trim() !== '') {
        const p = parseInt(String(production_id).trim(), 10);
        nid = Number.isFinite(p) ? p : null;
    } else if (Number.isNaN(nid)) nid = null;
    return {
        name:                 name || 'Unnamed offer',
        affiliate_network_id: Number.isNaN(aid) ? null : aid,
        subject_lines:        subj.length ? subj : [''],
        from_lines:           from,
        html_bodies:          html.length ? html : ['<p></p>'],
        production_id:        production_id != null && String(production_id).trim() !== '' ? String(production_id).trim() : null,
        campaign_id:          campaign_id != null && String(campaign_id).trim() !== '' ? String(campaign_id).trim() : null,
        network_offer_id:     nid,
    };
}

const EVERFLOW_DEFAULT_BASE = process.env.EVERFLOW_API_BASE || 'https://api.eflow.team/v1';

function affiliateIsEverflow(net) {
    if (!net) return false;
    const p = String(net.api_platform || '').toLowerCase();
    return p.includes('everflow');
}

async function everflowRequest(path, apiKey, baseUrl) {
    const base = (baseUrl || EVERFLOW_DEFAULT_BASE).replace(/\/$/, '');
    const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`;
    const r = await fetch(url, { headers: { 'X-Eflow-Api-Key': String(apiKey).trim(), Accept: 'application/json' } });
    let json = null;
    const text = await r.text();
    try { json = JSON.parse(text); } catch (_) { /* ignore */ }
    return { ok: r.ok, status: r.status, json, text };
}

function extractEverflowSubjects(relEmail) {
    if (!relEmail || typeof relEmail !== 'object') return null;
    const subj = relEmail.subject || relEmail.subject_line || relEmail.default_subject;
    if (typeof subj === 'string' && subj.trim()) return [subj.trim()];
    const arr = relEmail.subjects;
    if (Array.isArray(arr)) return arr.map(s => String(s).trim()).filter(Boolean);
    return null;
}

function extractEverflowCreativeHtmls(relationship, maxCreatives, getAllCreatives) {
    const creatives = relationship && relationship.creatives && relationship.creatives.entries;
    if (!Array.isArray(creatives) || !creatives.length) return [];
    const cap = getAllCreatives ? creatives.length : Math.min(Math.max(1, maxCreatives || 1), creatives.length);
    const out = [];
    for (let i = 0; i < cap; i++) {
        const c = creatives[i];
        const h = c && (c.html_body || c.body || c.html || c.content_html || c.html_code);
        if (h) out.push(String(h));
    }
    return out;
}

function mapEverflowOfferToStore(ef, affiliateNetworkId, opts) {
    const maxC = opts && opts.max_creatives != null ? parseInt(opts.max_creatives, 10) : 1;
    const getAllCr = opts && opts.get_all_creatives;
    const networkOfferId = ef.network_offer_id;
    const name = ef.name || (networkOfferId != null ? `Offer ${networkOfferId}` : 'Unnamed offer');
    const rel = ef.relationship || {};
    let subjects = extractEverflowSubjects(rel.email);
    if (!subjects || !subjects.length) subjects = [name];
    let htmlBodies = extractEverflowCreativeHtmls(rel, maxC, getAllCr);
    if (!htmlBodies.length && ef.html_description && String(ef.html_description).trim())
        htmlBodies = [String(ef.html_description)];
    if (!htmlBodies.length && ef.tracking_url)
        htmlBodies = [`<p><a href="${ef.tracking_url}">${name}</a></p>`];
    if (!htmlBodies.length) htmlBodies = ['<p></p>'];
    return {
        name,
        affiliate_network_id: affiliateNetworkId,
        production_id:        networkOfferId != null ? String(networkOfferId) : null,
        campaign_id:            null,
        network_offer_id:       networkOfferId != null ? networkOfferId : null,
        subject_lines:          subjects,
        from_lines:             [],
        html_bodies:            htmlBodies,
    };
}

app.post('/api/offers', (req, res) => {
    const parsed = parseOfferBody(req.body);
    const o = {
        id:                   nextId++,
        ...parsed,
        created_at:           new Date()
    };
    offers.push(o);
    saveData();
    res.json({ success: true, offer: o });
});

app.post('/api/offers/import-everflow', async (req, res) => {
    const { affiliate_network_id, production_ids, get_all, max_creatives, get_all_creatives } = req.body || {};
    const aid = parseInt(affiliate_network_id, 10);
    const net = affiliateNetworks.find(n => n.id === aid);
    if (!net) return res.status(400).json({ success: false, error: 'Affiliate network not found' });
    if (!affiliateIsEverflow(net))
        return res.status(400).json({ success: false, error: 'Selected network must use EverFlow API as its API platform' });
    const apiKey = String(net.api_key || '').trim();
    if (!apiKey) return res.status(400).json({ success: false, error: 'Affiliate API key is required for Everflow import' });

    const base = EVERFLOW_DEFAULT_BASE;
    const opts = { max_creatives: max_creatives != null ? parseInt(max_creatives, 10) : 1, get_all_creatives: !!get_all_creatives };
    if (Number.isNaN(opts.max_creatives) || opts.max_creatives < 1) opts.max_creatives = 1;

    const toUpsert = [];

    try {
        if (get_all) {
            let page = 1;
            const pageSize = 100;
            for (;;) {
                const { ok, status, json } = await everflowRequest(
                    `/affiliates/offersrunnable?page=${page}&page_size=${pageSize}`,
                    apiKey,
                    base
                );
                if (!ok) {
                    return res.status(502).json({
                        success: false,
                        error: `Everflow list failed (HTTP ${status})`,
                        detail: json || null
                    });
                }
                const rows = (json && json.offers) || [];
                for (const row of rows) toUpsert.push(mapEverflowOfferToStore(row, aid, opts));
                if (rows.length < pageSize) break;
                page += 1;
                if (page > 500) break;
            }
        } else {
            const lines = String(production_ids || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
            if (!lines.length) {
                return res.status(400).json({
                    success: false,
                    error: 'Enter one production ID per line, or enable Get all offers'
                });
            }
            for (const line of lines) {
                const oid = parseInt(line, 10);
                if (!Number.isFinite(oid)) {
                    return res.status(400).json({ success: false, error: `Invalid production ID: ${line}` });
                }
                const { ok, status, json } = await everflowRequest(`/affiliates/offers/${oid}`, apiKey, base);
                if (!ok) {
                    return res.status(502).json({
                        success: false,
                        error: `Everflow offer ${oid} failed (HTTP ${status})`,
                        detail: json || null
                    });
                }
                toUpsert.push(mapEverflowOfferToStore(json, aid, opts));
            }
        }
    } catch (e) {
        console.error('Everflow import:', e);
        return res.status(502).json({ success: false, error: e.message || 'Everflow request failed' });
    }

    let created = 0;
    let updated = 0;
    const out = [];
    for (const parsed of toUpsert) {
        const nid = parsed.network_offer_id;
        const idx = offers.findIndex(o =>
            o.affiliate_network_id === aid && nid != null && o.network_offer_id === nid
        );
        if (idx >= 0) {
            const prev = offers[idx];
            offers[idx] = {
                ...prev,
                ...parsed,
                id: prev.id,
                created_at: prev.created_at || new Date()
            };
            updated += 1;
            out.push(offers[idx]);
        } else {
            const o = { id: nextId++, ...parsed, created_at: new Date() };
            offers.push(o);
            created += 1;
            out.push(o);
        }
    }
    saveData();
    res.json({ success: true, created, updated, total: out.length, offers: out });
});

app.delete('/api/offers/:id', (req, res) => {
    const idx = offers.findIndex(o => o.id === parseInt(req.params.id, 10));
    if (idx === -1) return res.status(404).json({ success: false });
    offers.splice(idx, 1);
    saveData();
    res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════════
//  DATA LISTS  (file-backed emails; Fresh/Clean/etc. = list category like iResponse)
// ════════════════════════════════════════════════════════════════════════════
app.get('/api/data-lists', (req, res) =>
    res.json({ success: true, lists: dataLists.map(sanitizeListForClient) })
);

app.post('/api/data-lists', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'Upload a CSV or TXT file with emails.' });

    const {
        name, provider, isp, countries, verticals, initial_emails_type,
        allow_duplicates, filter_data, verify_mx
    } = req.body;

    const allowDup =
        allow_duplicates === true || allow_duplicates === 'true' ||
        allow_duplicates === 'Enabled' || allow_duplicates === 'enabled';
    const doFilter =
        filter_data === true || filter_data === 'true' ||
        filter_data === 'Enabled' || filter_data === 'enabled';
    const doMx =
        verify_mx === true || verify_mx === 'true' ||
        verify_mx === 'Enabled' || verify_mx === 'enabled';

    const listId  = nextId++;
    const listsDir = path.join(__dirname, 'uploads', 'lists');
    if (!fs.existsSync(listsDir)) fs.mkdirSync(listsDir, { recursive: true });
    const storage_rel = path.join('uploads', 'lists', `${listId}.txt`);

    let rawSeen = 0;
    const collected = [];
    const seen = new Set();

    const pushEmail = (raw) => {
        if (!raw) return;
        rawSeen++;
        let e = String(raw).trim();
        if (!e) return;
        e = e.split(/[;,]/)[0].trim();
        if (!e) return;
        const lower = e.toLowerCase();
        if (doFilter) {
            if (!isValidEmailStrict(lower)) return;
        } else if (!lower.includes('@') || lower.length > 320) {
            return;
        }
        if (!allowDup) {
            if (seen.has(lower)) return;
            seen.add(lower);
        }
        collected.push(lower);
    };

    if (req.file) {
        const ext = path.extname(req.file.originalname).toLowerCase();
        if (ext === '.csv') {
            await new Promise((resolve, reject) => {
                fs.createReadStream(req.file.path).pipe(csv())
                    .on('data', row => {
                        const em =
                            (row.email || row.Email || row.EMAIL || Object.values(row)[0] || '').trim();
                        pushEmail(em);
                    })
                    .on('end', resolve).on('error', reject);
            });
        } else {
            const lines = fs.readFileSync(req.file.path, 'utf8').split(/\r?\n/);
            for (const line of lines) pushEmail(line);
        }
        fs.unlinkSync(req.file.path);
    }

    let mxRejected = 0;
    let finalEmails = collected;
    if (doMx && finalEmails.length) {
        const domainOk = new Map();
        const withDomain = finalEmails.map(e => ({ e, d: e.split('@')[1] }));
        const uniqDomains = [...new Set(withDomain.map(x => x.d))];
        await Promise.all(uniqDomains.map(async (d) => {
            domainOk.set(d, await hasMXRecord(d));
        }));
        finalEmails = [];
        for (const { e, d } of withDomain) {
            if (domainOk.get(d)) finalEmails.push(e);
            else mxRejected++;
        }
        if (!allowDup) {
            const s = new Set(finalEmails);
            finalEmails = [...s];
        }
    }

    fs.writeFileSync(path.join(__dirname, storage_rel), finalEmails.join('\n'), 'utf8');

    const list = {
        id: listId,
        name: name || 'Unnamed List',
        provider:  provider  || '',
        isp:       isp       || '',
        countries: countries || '',
        verticals: verticals || '',
        initial_emails_type: initial_emails_type || 'Fresh List',
        allow_duplicates: allowDup,
        filter_data:      doFilter,
        verify_mx:        doMx,
        lines_processed: rawSeen,
        record_count:    finalEmails.length,
        mx_rejected:     doMx ? mxRejected : 0,
        storage_path:    storage_rel,
        status:          'Active',
        created_at:      new Date()
    };

    dataLists.push(list);
    saveData();
    res.json({ success: true, list: sanitizeListForClient(list) });
});

app.delete('/api/data-lists/:id', (req, res) => {
    const idx = dataLists.findIndex(l => l.id === parseInt(req.params.id));
    if (idx === -1) return res.status(404).json({ success: false });
    const l = dataLists[idx];
    if (l.storage_path) {
        const abs = path.join(__dirname, l.storage_path);
        try { if (fs.existsSync(abs)) fs.unlinkSync(abs); } catch (_) {}
    }
    dataLists.splice(idx, 1);
    saveData();
    res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════════
//  SMTP ACCOUNTS
// ════════════════════════════════════════════════════════════════════════════
// Helper to encode email header values according to RFC 2047
function encodeHeaderValue(text, encoding, charset = 'UTF-8') {
    if (!text) return '';
    if (encoding === 'base64') {
        const b64 = Buffer.from(text).toString('base64');
        return `=?${charset}?B?${b64}?=`;
    }
    if (encoding === 'quoted-printable') {
        // Simple Q-encoding (RFC 2047 section 4.2)
        let q = '';
        const buf = Buffer.from(text);
        for (let i = 0; i < buf.length; i++) {
            const b = buf[i];
            if (b === 0x20) q += '_';
            else if ((b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122)) q += String.fromCharCode(b);
            else q += '=' + b.toString(16).toUpperCase().padStart(2, '0');
        }
        return `=?${charset}?Q?${q}?=`;
    }
    return text;
}

app.get('/api/smtp-accounts', (req, res) =>
    res.json({ success: true, accounts: smtpAccounts })
);


app.post('/api/smtp-accounts', (req, res) => {
    const { email, host, port, username, password, daily_limit } = req.body;
    const acc = {
        id:           nextId++,
        email,
        host:         host         || 'smtp.office365.com',
        port:         parseInt(port || 587),
        username:     username     || email,
        password,
        daily_limit:  parseInt(daily_limit || 500),
        sent_today:   0,
        is_active:    true,
        health_status:'pending',
        created_at:   new Date(),
        last_tested:  null
    };
    smtpAccounts.push(acc);
    saveData();
    res.json({ success: true, account: acc });
});

app.put('/api/smtp-accounts/:id', (req, res) => {
    const acc = smtpAccounts.find(a => a.id === parseInt(req.params.id));
    if (!acc) return res.status(404).json({ success: false, error: 'Not found' });
    const { email, host, port, username, password, daily_limit } = req.body;
    if (email       !== undefined) acc.email       = email;
    if (host        !== undefined) acc.host        = host;
    if (port        !== undefined) acc.port        = parseInt(port);
    if (username    !== undefined) acc.username    = username;
    if (password    !== undefined) acc.password    = password;
    if (daily_limit !== undefined) acc.daily_limit = parseInt(daily_limit);
    saveData();
    res.json({ success: true, account: acc });
});

app.delete('/api/smtp-accounts/:id', (req, res) => {
    const idx = smtpAccounts.findIndex(a => a.id === parseInt(req.params.id));
    if (idx === -1) return res.status(404).json({ success: false });
    smtpAccounts.splice(idx, 1);
    saveData();
    res.json({ success: true });
});

app.post('/api/smtp-accounts/:id/test', async (req, res) => {
    const acc = smtpAccounts.find(a => a.id === parseInt(req.params.id));
    if (!acc) return res.status(404).json({ success: false });
    try {
        const t = nodemailer.createTransport({
            host:   acc.host,
            port:   acc.port,
            secure: acc.port === 465,
            auth:   { user: acc.username, pass: acc.password },
            tls:    { rejectUnauthorized: false }
        });
        await t.verify();
        acc.health_status = 'healthy';
        acc.is_active     = true;
        acc.last_tested   = new Date();
        saveData();
        res.json({ success: true, message: 'Connection successful!' });
    } catch (err) {
        acc.health_status = 'unhealthy';
        acc.is_active     = false;
        acc.last_tested   = new Date();
        saveData();
        res.json({ success: false, error: err.message });
    }
});

app.post('/api/smtp-accounts/bulk-delete', (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ success: false });
    smtpAccounts = smtpAccounts.filter(a => !ids.includes(a.id));
    saveData();
    res.json({ success: true, deleted: ids.length });
});

app.post('/api/smtp-accounts/bulk-import', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const accounts = [], errors = [];
    await new Promise((resolve, reject) => {
        fs.createReadStream(req.file.path).pipe(csv())
            .on('data', row => {
                const email    = row.email    || row.Email;
                const password = row.password || row.Password;
                if (!email || !password) { errors.push({ row, error: 'Missing email/password' }); return; }
                accounts.push({
                    id:           nextId++,
                    email,
                    host:         row.host      || row.Host      || 'smtp.office365.com',
                    port:         parseInt(row.port || row.Port  || 587),
                    username:     row.username  || row.Username  || email,
                    password,
                    from_name:    row.from_name || row.FromName  || '',
                    daily_limit:  parseInt(row.daily_limit || row.DailyLimit || 500),
                    sent_today:   0,
                    is_active:    true,
                    health_status:'pending',
                    created_at:   new Date(),
                    last_tested:  null
                });
            })
            .on('end', resolve).on('error', reject);
    });
    fs.unlinkSync(req.file.path);
    smtpAccounts.push(...accounts);
    saveData();
    res.json({ success: true, imported: accounts.length, failed: errors.length });
});

app.post('/api/smtp-accounts/reset-daily', (req, res) => {
    smtpAccounts.forEach(a => { a.sent_today = 0; });
    saveData();
    res.json({ success: true, message: 'Daily counters reset' });
});

// ════════════════════════════════════════════════════════════════════════════
//  SUPPRESSION LIST
// ════════════════════════════════════════════════════════════════════════════
app.get('/api/suppression', (req, res) =>
    res.json({ success: true, total: suppressionList.length, emails: suppressionList.slice(0, 200) })
);

app.post('/api/suppression', (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false });
    if (!suppressionList.includes(email.toLowerCase())) {
        suppressionList.push(email.toLowerCase());
        saveData();
    }
    res.json({ success: true });
});

app.delete('/api/suppression', (req, res) => {
    const { email } = req.body;
    suppressionList = suppressionList.filter(e => e !== email.toLowerCase());
    saveData();
    res.json({ success: true });
});

app.post('/api/suppression/import', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const ext = path.extname(req.file.originalname).toLowerCase();
    let added = 0;
    const existing = new Set(suppressionList);
    if (ext === '.csv') {
        await new Promise((resolve, reject) => {
            fs.createReadStream(req.file.path).pipe(csv())
                .on('data', row => {
                    const email = (row.email || row.Email || Object.values(row)[0] || '').trim().toLowerCase();
                    if (email && email.includes('@') && !existing.has(email)) {
                        suppressionList.push(email); existing.add(email); added++;
                    }
                })
                .on('end', resolve).on('error', reject);
        });
    } else {
        const lines = fs.readFileSync(req.file.path, 'utf8').split(/\r?\n/);
        for (const line of lines) {
            const email = line.trim().toLowerCase();
            if (email && email.includes('@') && !existing.has(email)) {
                suppressionList.push(email); existing.add(email); added++;
            }
        }
    }
    fs.unlinkSync(req.file.path);
    saveData();
    res.json({ success: true, added, total: suppressionList.length });
});

app.delete('/api/suppression/clear', (req, res) => {
    suppressionList = [];
    saveData();
    res.json({ success: true });
});



/**
 * Filter pasted recipient lines: valid syntax (iResponse-style), optional MX,
 * exclude suppression list, known bounce log, and selected SMTP identities.
 */
app.post('/api/tools/filter-recipients-text', async (req, res) => {
    const {
        text = '',
        check_mx = false,
        exclude_known_bounces = true,
        exclude_suppression = true,
        exclude_smtp_addresses = true,
        smtp_account_ids = []
    } = req.body || {};

    const bounceSet = exclude_known_bounces ? bounceEmailLowerSet() : null;
    const suppSet = exclude_suppression ? new Set(suppressionList.map(e => String(e).toLowerCase().trim())) : null;
    const idWant = new Set(normalizeSmtpAccountIds(smtp_account_ids));
    const smtpPool = exclude_smtp_addresses
        ? smtpAccounts.filter(a => idWant.size === 0 || idWant.has(a.id))
        : [];
    const smtpEmailSet = exclude_smtp_addresses
        ? new Set(smtpPool.map(a => String(a.email || '').toLowerCase().trim()).filter(Boolean))
        : null;

    const reasons = { invalid_syntax: 0, bounced: 0, suppressed: 0, no_mx: 0, smtp_account: 0 };
    const keptLines = [];
    const lines = String(text).split(/\r?\n/);

    for (const rawLine of lines) {
        const trimmedStart = rawLine.trim();
        if (!trimmedStart) {
            keptLines.push('');
            continue;
        }
        if (trimmedStart.startsWith('#')) {
            keptLines.push(rawLine.trimEnd());
            continue;
        }
        const email = trimmedStart.split(/[;,]/)[0].trim();
        const el = email.toLowerCase();

        if (!isValidEmailStrict(email)) {
            reasons.invalid_syntax++;
            continue;
        }
        if (smtpEmailSet && smtpEmailSet.has(el)) {
            reasons.smtp_account++;
            continue;
        }
        if (suppSet && suppSet.has(el)) {
            reasons.suppressed++;
            continue;
        }
        if (bounceSet && bounceSet.has(el)) {
            reasons.bounced++;
            continue;
        }
        if (check_mx) {
            const vr = await validateEmailFull(email);
            if (!vr.valid) {
                reasons.no_mx++;
                continue;
            }
        }
        keptLines.push(trimmedStart);
    }

    const removed_count =
        reasons.invalid_syntax + reasons.bounced + reasons.suppressed + reasons.no_mx + reasons.smtp_account;
    const kept_count = keptLines.filter(l => {
        const t = l.trim();
        return t && !t.startsWith('#');
    }).length;

    res.json({
        success:       true,
        filtered_text: keptLines.join('\n'),
        kept_count,
        removed_count,
        reasons
    });
});

// ════════════════════════════════════════════════════════════════════════════
//  CAMPAIGNS
// ════════════════════════════════════════════════════════════════════════════
function buildCampaignFields(body) {
    return {
        name:                   body.name,
        return_path:            body.return_path            || '[default_from_email]',
        from_name:              body.from_name              || '',
        from_email:             body.from_email             || '',
        from_email_source:      body.from_email_source      || 'custom',
        reply_to:               (body.reply_to || '').trim(),
        from_name_encoding:     body.from_name_encoding     || 'base64',
        subject:                body.subject                || '',
        subject_encoding:       body.subject_encoding       || 'base64',
        content_type:           body.content_type           || 'text/html',
        charset:                body.charset                || 'UTF-8',
        ct_encoding:            body.ct_encoding            || '8bit',
        header_processing:      body.header_processing      || 'default',
        header_sets:            body.header_sets            || [],
        active_header_set_idx:  body.active_header_set_idx  || 0,
        email_header_style:     body.email_header_style     || 'Simple',
        header_rotation:        body.header_rotation        || 1,
        header_body_separator:  body.header_body_separator  || '\\n\\n',
        html_bodies:            body.html_bodies            || [''],
        body_rotation:          body.body_rotation          || 1,
        url_format:             body.url_format             || 'Format 1',
        placeholders:           body.placeholders           || [],
        smtp_accounts:          normalizeSmtpAccountIds(body.smtp_accounts),
        data_list_ids:          normalizeIntIds(body.data_list_ids),
        emails_per_smtp:        parseInt(body.emails_per_smtp        || 100),
        change_interface_after: parseInt(body.change_interface_after || 1),
        sending_script:         body.sending_script         || 'queue',
        send_speed:             parseInt(body.send_speed    || 10),
        send_speed_unit:        body.send_speed_unit        || 'minute',
        batch_size:             parseInt(body.batch_size    || 100),
        batch_pause:            parseInt(body.batch_pause   || 1),
        batch_pause_unit:       body.batch_pause_unit       || 'minute',
        range_start_from:       parseInt(body.range_start_from || 0),
        range_count:            parseInt(body.range_count      || 0),
        use_suppression_list:   body.use_suppression_list   !== undefined ? body.use_suppression_list : true,
        repeat:                 parseInt(body.repeat         || 1),
        stop_after:             parseInt(body.stop_after     || 0),
        test_after_emails:      parseInt(body.test_after_emails || 100),
        test_email_destination: (body.test_email_destination || '').trim(),
        test_recipient_emails:  body.test_recipient_emails  || '',
        launch_date:            body.launch_date            || '',
        verify_mailboxes:       body.verify_mailboxes === true || body.verify_mailboxes === 'true',
        auto_reply_status:      body.auto_reply_status      || 'disabled',
        auto_reply_randomize:   body.auto_reply_randomize   || 'disabled',
        auto_reply_rotation:    parseInt(body.auto_reply_rotation || 1),
        auto_reply_accounts:    body.auto_reply_accounts    || '',
    };
}

app.get('/api/campaigns', (req, res) => res.json({ success: true, campaigns }));

app.get('/api/campaigns/active', (req, res) => {
    const active = campaigns
        .filter(c => c.status === 'running' || c.status === 'paused' || c.status === 'scheduled')
        .map(c => ({
            id: c.id, name: c.name, status: c.status,
            progress: c.total_recipients ? ((c.sent_count / c.total_recipients) * 100).toFixed(0) : 0,
            sent: c.sent_count, total: c.total_recipients,
            failed: c.failed_count,
            send_speed: `${c.send_speed} per ${c.send_speed_unit}`
        }));
    res.json({ success: true, campaigns: active });
});

app.get('/api/campaigns/:id', (req, res) => {
    const c = campaigns.find(c => c.id === parseInt(req.params.id));
    if (!c) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, campaign: c });
});

app.post('/api/campaigns', (req, res) => {
    const fields = buildCampaignFields(req.body);
    const campaign = {
        id: nextId++,
        ...fields,
        status:           fields.launch_date ? 'scheduled' : 'draft',
        total_recipients: 0,
        sent_count:       0,
        failed_count:     0,
        repeat_current:   0,
        created_at:       new Date(),
        updated_at:       new Date()
    };
    campaigns.push(campaign);
    saveData();
    res.json({ success: true, campaign });
});

app.put('/api/campaigns/:id', (req, res) => {
    const campaign = campaigns.find(c => c.id === parseInt(req.params.id));
    if (!campaign) return res.status(404).json({ success: false, error: 'Not found' });
    if (campaign.status === 'running')
        return res.status(400).json({ success: false, error: 'Pause the campaign before editing.' });
    const fields = buildCampaignFields(req.body);
    // Update status based on launch_date when campaign is in draft or scheduled state
    if (campaign.status === 'draft' || campaign.status === 'scheduled') {
        fields._statusOverride = fields.launch_date ? 'scheduled' : 'draft';
    }
    const { _statusOverride, ...cleanFields } = fields;
    Object.assign(campaign, cleanFields, { updated_at: new Date() });
    if (_statusOverride) campaign.status = _statusOverride;
    saveData();
    res.json({ success: true, campaign });
});

app.patch('/api/campaigns/:id', (req, res) => {
    const campaign = campaigns.find(c => c.id === parseInt(req.params.id));
    if (!campaign) return res.status(404).json({ success: false, error: 'Not found' });
    const allowed = Object.keys(buildCampaignFields({}));
    allowed.forEach(k => { if (req.body[k] !== undefined) campaign[k] = req.body[k]; });
    campaign.updated_at = new Date();
    saveData();
    res.json({ success: true, campaign });
});

app.delete('/api/campaigns/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const idx = campaigns.findIndex(c => c.id === id);
    if (idx === -1) return res.status(404).json({ success: false });
    campaigns.splice(idx, 1);
    recipients = recipients.filter(r => r.campaign_id !== id);
    if (campaignSendTimers[id]) { clearTimeout(campaignSendTimers[id]); delete campaignSendTimers[id]; }
    launchLocks.delete(id);
    saveData();
    res.json({ success: true });
});

app.post('/api/campaigns/:id/duplicate', (req, res) => {
    const src = campaigns.find(c => c.id === parseInt(req.params.id));
    if (!src) return res.status(404).json({ success: false });
    const copy = {
        ...JSON.parse(JSON.stringify(src)),
        id:               nextId++,
        name:             `${src.name} (copy)`,
        status:           'draft',
        sent_count:       0,
        failed_count:     0,
        total_recipients: 0,
        repeat_current:   0,
        created_at:       new Date(),
        updated_at:       new Date()
    };
    campaigns.push(copy);
    saveData();
    res.json({ success: true, campaign: copy });
});

// ════════════════════════════════════════════════════════════════════════════
//  RECIPIENTS
// ════════════════════════════════════════════════════════════════════════════
app.get('/api/campaigns/:id/recipients', (req, res) => {
    const id    = parseInt(req.params.id);
    const page  = parseInt(req.query.page  || 1);
    const limit = parseInt(req.query.limit || 100);
    const status= req.query.status;
    let list = recipients.filter(r => r.campaign_id === id);
    if (status) list = list.filter(r => r.status === status);
    const total = list.length;
    res.json({ success: true, recipients: list.slice((page - 1) * limit, page * limit), total, page, limit });
});

app.get('/api/campaigns/:id/stats', (req, res) => {
    const id = parseInt(req.params.id);
    const c  = campaigns.find(c => c.id === id);
    if (!c) return res.status(404).json({ success: false });
    const list       = recipients.filter(r => r.campaign_id === id);
    const sent       = list.filter(r => r.status === 'sent').length;
    const failed     = list.filter(r => r.status === 'failed').length;
    const pending    = list.filter(r => r.status === 'pending').length;
    const suppressed = list.filter(r => r.status === 'suppressed').length;
    const smtpBreakdown = {};
    sendingLogs.filter(l => l.campaign_id === id && l.status === 'sent').forEach(l => {
        smtpBreakdown[l.smtp_used] = (smtpBreakdown[l.smtp_used] || 0) + 1;
    });
    res.json({
        success: true,
        stats: { total_recipients: c.total_recipients, sent, failed, pending, suppressed,
            success_rate:   c.total_recipients ? ((sent / c.total_recipients) * 100).toFixed(2) : 0,
            send_speed:     `${c.send_speed} per ${c.send_speed_unit}`,
            repeat:         c.repeat, repeat_current: c.repeat_current,
            range_start:    c.range_start_from, range_count: c.range_count,
            smtp_breakdown: smtpBreakdown }
    });
});

app.post('/api/campaigns/:id/recipients', (req, res) => {
    const id = parseInt(req.params.id);
    const c  = campaigns.find(c => c.id === id);
    if (!c) return res.status(404).json({ success: false, error: 'Campaign not found' });
    const { email, name } = req.body;
    if (!email || !email.includes('@')) return res.status(400).json({ success: false, error: 'Invalid email' });
    if (recipients.find(r => r.campaign_id === id && r.email === email))
        return res.status(400).json({ success: false, error: 'Duplicate email' });
    const r = { id: nextId++, campaign_id: id, email: email.trim(), name: name || email.split('@')[0], status: 'pending', created_at: new Date() };
    recipients.push(r);
    c.total_recipients = recipients.filter(r => r.campaign_id === id).length;
    saveData();
    res.json({ success: true, recipient: r });
});

/** Paste recipients (one email per line); same safety rules as file import + strict syntax. */
app.post('/api/campaigns/:id/recipients/from-lines', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const c  = campaigns.find(x => x.id === id);
    if (!c) return res.status(404).json({ success: false, error: 'Campaign not found' });

    const smtpEmailSet = new Set(smtpAccounts.map(a => a.email.toLowerCase().trim()));
    const useSupp      = c.use_suppression_list !== false;
    const suppSet      = useSupp ? new Set(suppressionList) : null;
    const bounceSet    = bounceEmailLowerSet();

    const newRec = [];
    for (const line of String(req.body.text || '').split(/\r?\n/)) {
        const email = line.trim().split(/[;,]/)[0].trim();
        if (!email || email.startsWith('#')) continue;
        if (!isValidEmailStrict(email)) continue;
        const el = email.toLowerCase();
        if (smtpEmailSet.has(el)) continue;
        if (bounceSet.has(el)) continue;
        if (suppSet && suppSet.has(el)) continue;
        newRec.push({
            id: nextId++, campaign_id: id, email: el, name: el.split('@')[0],
            status: 'pending', created_at: new Date()
        });
    }

    const existing = new Set(recipients.filter(r => r.campaign_id === id).map(r => r.email.toLowerCase()));
    const seen = new Set();
    const unique = newRec.filter(r => {
        if (seen.has(r.email) || existing.has(r.email)) return false;
        seen.add(r.email);
        return true;
    });
    recipients.push(...unique);
    c.total_recipients = recipients.filter(r => r.campaign_id === id).length;
    saveData();
    res.json({
        success: true,
        imported: unique.length,
        duplicates_skipped: newRec.length - unique.length
    });
});

app.post('/api/campaigns/:id/recipients/bulk-import', upload.single('file'), async (req, res) => {
    const id = parseInt(req.params.id);
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const c = campaigns.find(c => c.id === id);
    if (!c) { fs.unlinkSync(req.file.path); return res.status(404).json({ error: 'Campaign not found' }); }

    // Build a set of ALL smtp email addresses so we never import them as recipients
    const smtpEmailSet = new Set(smtpAccounts.map(a => a.email.toLowerCase().trim()));
    const bounceSet = bounceEmailLowerSet();
    const useSupp = c.use_suppression_list !== false;
    const suppSet = useSupp ? new Set(suppressionList.map(e => String(e).toLowerCase())) : null;

    const newRec = [], errors = [];
    const ext = path.extname(req.file.originalname).toLowerCase();

    if (ext === '.csv') {
        await new Promise((resolve, reject) => {
            fs.createReadStream(req.file.path).pipe(csv())
                .on('data', row => {
                    const email = (row.email || row.Email || Object.values(row)[0] || '').trim();
                    const el = email.toLowerCase();
                    if (email && isValidEmailStrict(email)) {
                        if (smtpEmailSet.has(el)) {
                            console.log(`⚠️  Skipping SMTP account email from recipient import: ${email}`);
                            return;
                        }
                        if (bounceSet.has(el)) return;
                        if (suppSet && suppSet.has(el)) return;
                        newRec.push({ id: nextId++, campaign_id: id, email: el, name: row.name || row.Name || email.split('@')[0], status: 'pending', created_at: new Date() });
                    } else errors.push(email);
                })
                .on('end', resolve).on('error', reject);
        });
    } else {
        const lines = fs.readFileSync(req.file.path, 'utf8').split(/\r?\n/);
        for (const line of lines) {
            const email = line.trim().split(/[;,]/)[0].trim();
            const el = email.toLowerCase();
            if (email && !email.startsWith('#') && isValidEmailStrict(email)) {
                if (smtpEmailSet.has(el)) {
                    console.log(`⚠️  Skipping SMTP account email from recipient import: ${email}`);
                    continue;
                }
                if (bounceSet.has(el)) continue;
                if (suppSet && suppSet.has(el)) continue;
                newRec.push({ id: nextId++, campaign_id: id, email: el, name: email.split('@')[0], status: 'pending', created_at: new Date() });
            }
        }
    }
    fs.unlinkSync(req.file.path);

    const existingEmails = new Set(recipients.filter(r => r.campaign_id === id).map(r => r.email));
    const seen = new Set();
    const unique = newRec.filter(r => {
        if (seen.has(r.email) || existingEmails.has(r.email)) return false;
        seen.add(r.email); return true;
    });

    recipients.push(...unique);
    c.total_recipients = recipients.filter(r => r.campaign_id === id).length;
    saveData();
    res.json({ success: true, imported: unique.length, failed: errors.length, duplicates_skipped: newRec.length - unique.length });
});

app.delete('/api/recipients/:id', (req, res) => {
    const idx = recipients.findIndex(r => r.id === parseInt(req.params.id));
    if (idx === -1) return res.status(404).json({ success: false });
    const cid = recipients[idx].campaign_id;
    recipients.splice(idx, 1);
    const c = campaigns.find(c => c.id === cid);
    if (c) c.total_recipients = recipients.filter(r => r.campaign_id === cid).length;
    saveData();
    res.json({ success: true });
});

app.post('/api/campaigns/:id/recipients/bulk-delete', (req, res) => {
    const id    = parseInt(req.params.id);
    const idSet = new Set((req.body.ids || []).map(Number));
    const before = recipients.length;
    recipients = recipients.filter(r => !(r.campaign_id === id && idSet.has(r.id)));
    const c = campaigns.find(c => c.id === id);
    if (c) c.total_recipients = recipients.filter(r => r.campaign_id === id).length;
    saveData();
    res.json({ success: true, deleted: before - recipients.length });
});

app.delete('/api/campaigns/:id/recipients', (req, res) => {
    const id = parseInt(req.params.id);
    const before = recipients.length;
    recipients = recipients.filter(r => r.campaign_id !== id);
    const c = campaigns.find(c => c.id === id);
    if (c) { c.total_recipients = 0; c.sent_count = 0; c.failed_count = 0; }
    saveData();
    res.json({ success: true, deleted: before - recipients.length });
});

app.post('/api/campaigns/:id/recipients/reset', (req, res) => {
    const id = parseInt(req.params.id);
    recipients.filter(r => r.campaign_id === id).forEach(r => { r.status = 'pending'; r.sent_at = null; });
    const c = campaigns.find(c => c.id === id);
    if (c) { c.sent_count = 0; c.failed_count = 0; c.repeat_current = 0; }
    saveData();
    res.json({ success: true });
});

/** Merge emails from uploaded data lists into campaign recipients (additive, deduped). */
app.post('/api/campaigns/:id/import-from-data-lists', (req, res) => {
    const id = parseInt(req.params.id);
    const c  = campaigns.find(x => x.id === id);
    if (!c) return res.status(404).json({ success: false, error: 'Campaign not found' });
    const listIds = normalizeIntIds(req.body.list_ids);
    if (!listIds.length) return res.status(400).json({ success: false, error: 'No data lists selected.' });

    const smtpEmailSet = new Set(smtpAccounts.map(a => a.email.toLowerCase().trim()));
    const suppSet      = new Set(suppressionList);
    const existing     = new Set(recipients.filter(r => r.campaign_id === id).map(r => r.email.toLowerCase()));

    let imported = 0, skipped_suppression = 0, skipped_smtp_self = 0;

    for (const lid of listIds) {
        const list = dataLists.find(l => l.id === lid);
        if (!list) continue;
        for (const email of readEmailsFromListFile(list)) {
            const el = email.toLowerCase();
            if (existing.has(el)) continue;
            if (smtpEmailSet.has(el)) { skipped_smtp_self++; continue; }
            if (c.use_suppression_list !== false && suppSet.has(el)) { skipped_suppression++; continue; }
            if (!isValidEmailStrict(el)) continue;
            recipients.push({
                id: nextId++, campaign_id: id, email, name: email.split('@')[0],
                status: 'pending', created_at: new Date()
            });
            existing.add(el);
            imported++;
        }
    }

    c.total_recipients = recipients.filter(r => r.campaign_id === id).length;
    saveData();
    res.json({
        success: true, imported, skipped_suppression, skipped_smtp_self,
        total_recipients: c.total_recipients
    });
});

// ════════════════════════════════════════════════════════════════════════════
//  SENDING ENGINE
// ════════════════════════════════════════════════════════════════════════════

// FIX 1: formatFromHeader ONLY builds the From header — reply_to is handled separately in mailOpts
function pickRandom(arr) {
    if (!arr || !arr.length) return null;
    return arr[Math.floor(Math.random() * arr.length)];
}

function rotateLine(str) {
    if (!str) return '';
    // If it contains ####, it's a block separator (highest priority)
    if (str.includes('####')) {
        const blocks = str.split('####').map(b => b.trim()).filter(Boolean);
        return blocks.length ? blocks[Math.floor(Math.random() * blocks.length)] : '';
    }
    // Fallback to newline rotation
    const lines = str.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    return lines.length ? lines[Math.floor(Math.random() * lines.length)] : '';
}

function saveDropRecord(campaign, stats) {
    const record = {
        id:          nextId++,
        campaign_id: campaign.id,
        name:        campaign.name,
        sent:        campaign.sent_count,
        failed:      campaign.failed_count,
        ...stats,
        ts:          new Date().toISOString()
    };
    let history = [];
    if (fs.existsSync('drop_history.json')) {
        try {
            history = JSON.parse(fs.readFileSync('drop_history.json', 'utf8')) || [];
        } catch (e) { history = []; }
    }
    history.push(record);
    fs.writeFileSync('drop_history.json', JSON.stringify(history, null, 2));
}

function pickVariant(val, fallback) {
    if (!val) return fallback;
    if (Array.isArray(val)) return val.length ? val[Math.floor(Math.random() * val.length)] : fallback;
    if (typeof val === 'string') {
        const lines = val.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        return lines.length ? lines[Math.floor(Math.random() * lines.length)] : fallback;
    }
    return fallback;
}

function resolveVariants(text) {
    if (!text) return '';
    // Handle {opt1|opt2|opt3}
    return text.replace(/\{([^{}]+)\}/g, (_, match) => {
        if (match.includes('|')) {
            const parts = match.split('|');
            return parts[Math.floor(Math.random() * parts.length)].trim();
        }
        return `{${match}}`; // Keep if it's likely a placeholder
    });
}

function resolvePlaceholdersForEmail(recipient, campaign, smtp = null) {
    const context = {
        name: recipient.name || (recipient.email ? recipient.email.split('@')[0] : ''),
        email: recipient.email || '',
        id: recipient.id || '',
        date: new Date().toLocaleDateString(),
        // New tags support
        ip: smtp ? (smtp.host || '') : '',
        rdns: smtp ? (smtp.host || '') : '', 
        ptr: smtp ? (smtp.host || '') : '',
        domain: smtp ? (smtp.host || '') : '',
        custom_domain: smtp ? (smtp.host || '') : '',
        static_domain: smtp ? (smtp.host || '') : '',
        smtp_user: smtp ? (smtp.username || '') : '',
        server: smtp ? (smtp.host || '') : '',
        email_id: recipient.id || '',
        email_b64: recipient.email ? Buffer.from(recipient.email).toString('base64') : '',
        first_name: recipient.name ? recipient.name.split(' ')[0] : (recipient.email ? recipient.email.split('@')[0] : ''),
        last_name: recipient.name && recipient.name.includes(' ') ? recipient.name.substring(recipient.name.indexOf(' ') + 1) : '',
        return_path: campaign.return_path || '[default_from_email]',
        from_name: campaign.from_name || '',
        subject: campaign.subject || '', 
        mail_date: format24h(new Date()),
        message_id: `<${Math.random().toString(36).substring(2, 15)}@${smtp ? smtp.host : 'localhost'}>`,
        negative: campaign.negative || '',
        auto_reply_mailbox: campaign.auto_reply_accounts || '',
        // Link tags (random IDs)
        open: Math.random().toString(36).substring(2, 10),
        url: Math.random().toString(36).substring(2, 10),
        unsub: Math.random().toString(36).substring(2, 10),
        optout: Math.random().toString(36).substring(2, 10),
        // Short Link tags (simulated for now, can be linked to service)
        short_open: `https://sh.rt/${Math.random().toString(36).substring(2, 7)}`,
        short_url: `https://sh.rt/${Math.random().toString(36).substring(2, 7)}`,
        short_unsub: `https://sh.rt/${Math.random().toString(36).substring(2, 7)}`,
        short_optout: `https://sh.rt/${Math.random().toString(36).substring(2, 7)}`
    };
    (campaign.placeholders || []).forEach((p, idx) => {
        if (!p.key || !p.values || !p.values.length) return;
        const val = p.values[Math.floor(Math.random() * p.values.length)];
        context[p.key] = val;
        context[`placeholder${idx + 1}`] = val;
    });
    return context;
}

function applyFilterBypass(text, method) {
    if (!text || !method || method === 'none') return text;
    if (method === 'dot') {
        return text.split('').join('.');
    }
    return text;
}

function applyTagEncoding(text, encoding) {
    if (!text || !encoding || encoding === 'none') return text;
    if (encoding === 'base64') {
        return Buffer.from(text).toString('base64');
    }
    if (encoding === 'quoted-printable') {
        let q = '';
        const buf = Buffer.from(text);
        for (let i = 0; i < buf.length; i++) {
            const b = buf[i];
            if (b === 0x20) q += '_';
            else if ((b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122)) q += String.fromCharCode(b);
            else q += '=' + b.toString(16).toUpperCase().padStart(2, '0');
        }
        return q;
    }
    return text;
}


function applyPlaceholdersGlobal(text, context) {
    if (!text) return '';
    const ctx = context || {};
    
    // 1. Handle advanced [[encoding:bypass:{{tag}}]] (or similar)
    text = text.replace(/\[\[(.*?):(.*?):(.*?)]]/g, (match, enc, bypass, inner) => {
        // Resolve inner tag first (it might be {{tag}} or [tag])
        let resolved = inner;
        const tagMatch = inner.match(/\{\{(.*?)\}\}/);
        const bracketMatch = inner.match(/\[(.*?)\]/);
        
        if (tagMatch) {
            const key = tagMatch[1];
            resolved = ctx[key] !== undefined ? ctx[key] : inner;
        } else if (bracketMatch) {
            const key = bracketMatch[1].toLowerCase();
            resolved = ctx[key] !== undefined ? ctx[key] : inner;
        }
        
        // Apply encoding
        resolved = applyTagEncoding(resolved, enc.toLowerCase());
        // Apply bypass
        resolved = applyFilterBypass(resolved, bypass.toLowerCase());
        
        return resolved;
    });

    // 2. Handle standard {{tag}}
    for (const [k, v] of Object.entries(ctx)) {
        text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'gi'), v);
    }
    // 3. Apply spintax: {option1|option2|option3}
    text = text.replace(/\{([^{}]+)\}/g, (match, inner) => {
        if (inner.includes('|')) {
            const parts = inner.split('|');
            return parts[Math.floor(Math.random() * parts.length)];
        }
        return match;
    });
    // 4. Apply all random bracket tags, built-in tags, etc.
    return randomizeTags(text, context);
}

function decodeRFC2047(text) {
    if (!text || typeof text !== 'string') return text || '';
    // This regex looks for =?charset?encoding?data?=
    return text.replace(/=\?(.*?)\?(.*?)\?(.*?)\?=/g, (match, charset, enc, data) => {
        try {
            if (enc.toUpperCase() === 'B') {
                return Buffer.from(data, 'base64').toString(charset.toLowerCase() === 'utf-8' ? 'utf8' : 'ascii');
            }
            if (enc.toUpperCase() === 'Q') {
                // Simplified Q-encoding decode: replace _ with space, then hex decode
                let s = data.replace(/_/g, ' ');
                s = s.replace(/=([0-9A-F]{2})/gi, (m, hex) => String.fromCharCode(parseInt(hex, 16)));
                return s;
            }
        } catch (e) {
            console.error('Decoding RFC2047 failed:', e);
        }
        return match;
    });
}

function formatFromHeader(name, email) {
    // Normalize: remove newlines and escape quotes
    let cleanName = (name || '').replace(/\r?\n/g, ' ').trim();
    const cleanEmail = (email || '').replace(/\r?\n/g, '').trim();
    
    // If name is already encoded words, don't put quotes around it!
    // RFC 2047 says encoded-words must not appear in quoted strings.
    if (cleanName.includes('=?')) {
        return `${cleanName} <${cleanEmail}>`;
    }
    
    cleanName = cleanName.replace(/"/g, '\\"');
    return cleanName ? `"${cleanName}" <${cleanEmail}>` : cleanEmail;
}

// Helper to generate a Message-Id in the format {n,15}.{n,1}.{A,3}{n,10}@domain
function generateMessageId(domain) {
    const rand = (len) => Math.floor(Math.random() * Math.pow(10, len)).toString().padStart(len, '0');
    const part1 = rand(15);
    const part2 = rand(1);
    const part3 = `${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}`;
    const part4 = rand(10);
    return `<${part1}.${part2}.${part3}${part4}@${domain}>`;
}

// Helper to format date according to RFC 2822 for SMTP header
function formatSmtpDate(date) {
    // Use toUTCString which is close to RFC 2822 format
    return new Date(date).toUTCString();
}

// ─── Mailbox existence check via SMTP RCPT TO (like Python check_mailbox_exists) ─
async function checkMailboxExists(email, domain) {
    return new Promise(resolve => {
        dns.resolveMx(domain, (err, addrs) => {
            if (err || !addrs || !addrs.length) {
                console.log(`🔍 Probe ${email} → No MX records found.`);
                return resolve(false);
            }

            const sorted = addrs.sort((a, b) => a.priority - b.priority);
            const mxHost = sorted[0].exchange;
            const net    = require('net');
            const sock   = net.createConnection({ host: mxHost, port: 25 });

            let buf       = '';
            let stage     = 0;
            let resolved  = false;

            const done = (result, reason = '') => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timer);
                if (reason) console.log(`🔍 Probe ${email} → ${result ? 'SUCCESS' : 'FAILED'}: ${reason}`);
                try { sock.write('QUIT\r\n'); } catch {}
                try { sock.destroy(); } catch {}
                resolve(result);
            };

            // 10s hard timeout
            const timer = setTimeout(() => done(false, 'Timeout (10s)'), 10000);

            sock.setTimeout(10000);
            sock.on('timeout', () => done(false, 'Socket timeout'));
            sock.on('error',   (e) => done(false, `Connection error: ${e.message}`)); 

            sock.on('data', chunk => {
                buf += chunk.toString();
                const lines = buf.split('\r\n');
                buf = lines.pop();

                for (const line of lines) {
                    if (!line) continue;
                    const code = parseInt(line.slice(0, 3), 10);

                    if (stage === 0) {
                        if (code === 220) {
                            sock.write('EHLO mailcheck.local\r\n');
                            stage = 1;
                        } else {
                            done(false, `Unexpected banner: ${line}`);
                        }
                    } else if (stage === 1) {
                        if (code === 250 && !line.startsWith('250-')) {
                            sock.write(`MAIL FROM:<probe@mailcheck.local>\r\n`);
                            stage = 2;
                        } else if (code >= 400) {
                            done(false, `EHLO rejected: ${line}`);
                        }
                    } else if (stage === 2) {
                        if (code === 250) {
                            sock.write(`RCPT TO:<${email}>\r\n`);
                            stage = 3;
                        } else {
                            done(false, `MAIL FROM rejected: ${line}`);
                        }
                    } else if (stage === 3) {
                        if (code === 250) done(true, 'Recipient accepted (250)');
                        else              done(false, `Recipient rejected: ${line}`);
                    }
                }
            });
        });
    });
}


// FIX 2: Also filter SMTP emails at send time (belt and suspenders)
function buildSmtpEmailSet() {
    return new Set(smtpAccounts.map(a => a.email.toLowerCase().trim()));
}

async function sendTestEmail(campaign, smtp, destination, context = 'test') {
    const label = `${smtp.email} → ${smtp.host}:${smtp.port || 587}`;
    try {
        let t = smtpTransporters.get(smtp.id);
        if (!t) {
            t = nodemailer.createTransport({
                host: smtp.host, port: smtp.port, secure: smtp.port === 465,
                auth: { user: smtp.username, pass: smtp.password },
                tls:  { rejectUnauthorized: false },
                connectionTimeout: 30000, greetingTimeout: 30000, socketTimeout: 30000,
                pool: true, maxConnections: 1 // Reuse connection
            });
            smtpTransporters.set(smtp.id, t);
        }

        const context = resolvePlaceholdersForEmail({ email: destination }, campaign, smtp);
        
        // Resolve Header Set (Persona) context for test send
        const sIdx = campaign.active_header_set_idx || 0;
        const activeSet = (campaign.header_sets && campaign.header_sets[sIdx]) || {};

        const topFromNameOrig = (activeSet.from_name || campaign.from_name || '').trim();
        const topSubjectOrig = (activeSet.subject || campaign.subject || '').trim();
        
        const isFromEmpty = isFieldEmpty(topFromNameOrig);
        const isSubEmpty  = isFieldEmpty(topSubjectOrig);

        let fromName = isFromEmpty ? '' : topFromNameOrig;
        let fSource  = activeSet.from_email_source || campaign.from_email_source || 'custom';
        let fromEmail = activeSet.from_email || campaign.from_email || '';

        if (fSource === 'smtp_user') {
            fromEmail = smtp.username || (smtp.auth && smtp.auth.user) || smtp.email;
        } else if (fSource === 'smtp_from') {
            fromEmail = smtp.from || smtp.email;
        }

        let subjectStr = isSubEmpty ? '' : topSubjectOrig;
        let replyToVal = (activeSet.reply_to || campaign.reply_to || '').trim();

        const applyLocalPlaceholders = (text) => {
            let res = text || '';
            // Basic placeholders used in headers
            const placeholders = {
                '[domain]': smtp.host.includes('.') ? smtp.host.split('.').slice(-2).join('.') : smtp.host,
                '[default_from_email]': smtp.email,
                '[smtp_date]': format24h(new Date()),
                '[from_name]': applyPlaceholdersGlobal(fromName, context),
                '[subject]': subjectStr,
                '[to]': destination
            };
            for (const [k, v] of Object.entries(placeholders)) {
                res = res.replace(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), v);
            }
            return applyPlaceholdersGlobal(res, context);
        };

        fromName = applyLocalPlaceholders(rotateLine(fromName));
        fromEmail = applyLocalPlaceholders(fromEmail);
        subjectStr = applyLocalPlaceholders(subjectStr);
        replyToVal = applyLocalPlaceholders(replyToVal);

        // STRIP RFC 2047 wrapping before giving to Nodemailer to avoid DOUBLE ENCODING
        // Nodemailer will re-encode properly.
        fromName = decodeRFC2047(fromName);
        subjectStr = decodeRFC2047(subjectStr);

        const bodyVar = pickVariant(campaign.html_bodies, '<p>(no body)</p>');

        const mailOpts = {
            from:    formatFromHeader(fromName, fromEmail),
            to:      destination,
            subject: `[TEST] ${applyPlaceholdersGlobal(subjectStr, context)}`,
            html:    `<h3>🧪 Test from: ${campaign.name}</h3>
                      <p>SMTP: <b>${smtp.email}</b></p>
                      <p>Host: <b>${smtp.host}</b></p>
                      <p>From: <b>${formatFromHeader(fromName, fromEmail).replace(/</g, '&lt;')}</b></p>
                      <p>Reply-To: <b>${replyToVal || '(none)'}</b></p>
                      <hr>${applyPlaceholdersGlobal(bodyVar, context)}`,
            headers: {}
        };

        if (replyToVal) {
            mailOpts.replyTo = replyToVal;
        }

        // Apply Custom Headers from activeSet.content if present
        if (activeSet && activeSet.content) {
            const raw = applyLocalPlaceholders(activeSet.content);
            raw.split('\n').forEach(line => {
                const idx = line.indexOf(':');
                if (idx > -1) {
                    const h = line.substring(0, idx).trim();
                    const v = line.substring(idx + 1).trim();
                    const headLow = h.toLowerCase();
                    const protectedFields = ['from','to','subject','date','message-id','reply-to'];
                    if (protectedFields.includes(headLow)) {
                        if (headLow === 'from') {
                            mailOpts.from = v;
                            return;
                        }
                        if (headLow === 'subject') {
                            mailOpts.subject = v;
                            return;
                        }
                        if (headLow === 'to')         mailOpts.to = v;
                        if (headLow === 'date')       mailOpts.date = v;
                        if (headLow === 'message-id') mailOpts.messageId = v;
                        if (headLow === 'reply-to')   mailOpts.replyTo = v;
                        return;
                    }
                    if (h && v) mailOpts.headers[h] = v;
                }
            });
        } else {
            // Default headers if no custom block provided
            mailOpts.headers['Date'] = formatSmtpDate(new Date());
            mailOpts.headers['Message-Id'] = generateMessageId(smtp.host);
        }

        const info = await t.sendMail(mailOpts);

        // Save test sends to history so they appear in UI
        sendingLogs.push({
            id: nextId++,
            campaign_id: campaign.id,
            recipient_email: destination,
            smtp_used: smtp.email,
            from_header: mailOpts.from || '',
            reply_to_header: mailOpts.replyTo || '',
            status: 'sent',
            message_id: info.messageId,
            sent_at: new Date()
        });
        saveData();

        console.log(`✅ ${label} → ${destination} | ID: ${info.messageId}`);
        return { success: true, messageId: info.messageId };
    } catch (e) {
        console.error(`❌ ${context} failed | ${label} | ${e.message}`);
        return { success: false, error: e.message, host: smtp.host, account: smtp.email };
    }
}

async function startSending(campaign) {
    const cid = campaign.id;

    if (campaign.launch_date) {
        if (new Date() < new Date(campaign.launch_date)) {
            if (campaign.status !== 'scheduled') {
                campaign.status = 'scheduled';
                saveData();
                console.log(`⏳ Campaign ${cid} scheduled for ${campaign.launch_date}. Holding...`);
            }
            return;
        }
    }

    if (campaignSendTimers[cid]) {
        clearTimeout(campaignSendTimers[cid]);
        delete campaignSendTimers[cid];
    }

    function shouldHaltTick() {
        const live = campaigns.find(c => c.id === cid);
        return !live || live.status !== 'running';
    }

    function scheduleNext(ms) {
        if (campaignSendTimers[cid]) clearTimeout(campaignSendTimers[cid]);
        campaignSendTimers[cid] = setTimeout(() => {
            campaignSendTimers[cid] = null;
            tick();
        }, ms);
    }

    function clearSendTimer() {
        if (campaignSendTimers[cid]) { clearTimeout(campaignSendTimers[cid]); delete campaignSendTimers[cid]; }
    }

    let delayMs;
    switch (campaign.send_speed_unit) {
        case 'second': delayMs = 1000    / campaign.send_speed; break;
        case 'hour':   delayMs = 3600000 / campaign.send_speed; break;
        default:       delayMs = 60000   / campaign.send_speed;
    }

    const smtpIdSet  = new Set(normalizeSmtpAccountIds(campaign.smtp_accounts));
    const smtpList   = smtpAccounts.filter(a => smtpIdSet.has(a.id) && a.health_status === 'healthy');
    if (!smtpList.length) {
        campaign.status = 'paused';
        saveData();
        console.log(`❌ No healthy SMTPs for campaign ${cid}`);
        return;
    }

    // FIX 2: Build SMTP email set to filter at send time
    const smtpEmailSet = buildSmtpEmailSet();

    let allRecipients = recipients.filter(r => r.campaign_id === cid && r.status === 'pending');

    // FIX: Print diagnostics before doing ANY filtering on allRecipients
    const pendingTotal = allRecipients.length;
    console.log(`\n================ RERUN DIAGNOSTICS ================`);
    console.log(`Campaign Repeat Current: ${campaign.repeat_current}`);
    console.log(`Initial pending recipients: ${pendingTotal}`);
    console.log(`Range start from: ${campaign.range_start_from}`);
    console.log(`Range count: ${campaign.range_count}`);

    // Only apply range slice on the first run — reruns/repeats should process all pending
    if (campaign.repeat_current === 0) {
        if (campaign.range_start_from > 0) {
            allRecipients = allRecipients.slice(campaign.range_start_from);
            console.log(`After range_start slice: ${allRecipients.length}`);
        }
        if (campaign.range_count > 0) {
            allRecipients = allRecipients.slice(0, campaign.range_count);
            console.log(`After range_count slice: ${allRecipients.length}`);
        }
    } else {
        console.log(`Skipping range slices because repeat_current > 0`);
    }

    const suppSet = new Set(suppressionList);
    if (campaign.use_suppression_list) {
        allRecipients = allRecipients.filter(r => {
            if (suppSet.has(r.email.toLowerCase())) { r.status = 'suppressed'; return false; }
            return true;
        });
        console.log(`After suppression filter: ${allRecipients.length}`);
    }

    // FIX 2: Filter out any SMTP account emails from the recipient list at send time
    allRecipients = allRecipients.filter(r => {
        if (smtpEmailSet.has(r.email.toLowerCase())) {
            console.log(`⚠️  Skipping SMTP account email in recipients: ${r.email}`);
            r.status = 'suppressed';
            return false;
        }
        return true;
    });
    console.log(`After SMTP email filter: ${allRecipients.length}`);

    if (!allRecipients.length) {
        // If it was a scheduled campaign that just reached its time, but recipients haven't loaded yet,
        // we might want to wait. However, if it's been running or is a manual start, we complete it.
        const wasScheduled = campaign.status === 'scheduled';
        campaign.status = 'completed';
        saveData();
        clearSendTimer();
        console.log(`✅ No sendable recipients for campaign ${cid} (after range/suppression/smtp-filter). Completed.`);
        console.log(`===================================================\n`);
        return;
    }
    console.log(`Starting tick with ${allRecipients.length} recipients...`);
    console.log(`===================================================\n`);

    console.log(`\n📧 Campaign: "${campaign.name}"`);
    console.log(`📋 Recipients to send: ${allRecipients.length}`);
    console.log(`⚡ Speed: ${campaign.send_speed}/${campaign.send_speed_unit} | Batch: ${campaign.batch_size}`);

    let smtpIdx           = 0;
    let perSmtpCount      = 0;
    let recIdx            = 0;
    let emailsSinceLast   = 0;
    let batchCount        = 0;
    let totalSentThisRun  = 0;
    const stopAfter       = campaign.stop_after || 0;

    // Per-run bounce counters (for drop record)
    const runBounces = { hard: 0, soft: 0, policy: 0, unknown: 0 };
    const runSmtpBreakdown  = {};
    const runDomainStats    = {};

    async function tick() {
        if (shouldHaltTick()) {
            console.log(`⏸ Campaign ${cid} halted (not running).`);
            return;
        }

        if (recIdx >= allRecipients.length) {
            campaign.repeat_current = (campaign.repeat_current || 0) + 1;
            if (campaign.repeat_current < campaign.repeat) {
                // Reset both sent AND failed recipients back to pending for retry
                recipients.filter(r => r.campaign_id === cid && (r.status === 'sent' || r.status === 'failed'))
                    .forEach(r => { r.status = 'pending'; r.sent_at = null; });
                campaign.sent_count = 0; campaign.failed_count = 0;
                allRecipients = recipients.filter(r => r.campaign_id === cid && r.status === 'pending');
                if (campaign.use_suppression_list)
                    allRecipients = allRecipients.filter(r => !suppSet.has(r.email.toLowerCase()));
                allRecipients = allRecipients.filter(r => !smtpEmailSet.has(r.email.toLowerCase()));
                recIdx = 0;
                saveData();
                console.log(`🔁 Repeat ${campaign.repeat_current + 1}/${campaign.repeat}`);
                scheduleNext(delayMs);
            } else {
                campaign.status = 'completed';
                // ── Save drop history record (like Python DropManager) ──
                saveDropRecord(campaign, {
                    ...runBounces,
                    smtpBreakdown: runSmtpBreakdown,
                    domainStats:   runDomainStats,
                });
                saveData();
                clearSendTimer();
                console.log(`✅ Campaign "${campaign.name}" completed!`);
            }
            return;
        }

        const recipient = allRecipients[recIdx++];

        if (stopAfter > 0 && totalSentThisRun >= stopAfter) {
            campaign.status = 'completed';
            saveData();
            clearSendTimer();
            console.log(`🛑 Stopped after ${stopAfter} emails.`);
            return;
        }

        if (perSmtpCount >= campaign.emails_per_smtp) {
            smtpIdx = (smtpIdx + 1) % smtpList.length;
            perSmtpCount = 0;
            console.log(`🔄 Rotated → SMTP: ${smtpList[smtpIdx].email}`);
        }

        let tries = 0;
        while (smtpList[smtpIdx].sent_today >= smtpList[smtpIdx].daily_limit && tries < smtpList.length) {
            smtpIdx = (smtpIdx + 1) % smtpList.length;
            perSmtpCount = 0;
            tries++;
        }
        const smtp = smtpList[smtpIdx];
        if (smtp.sent_today >= smtp.daily_limit) {
            campaign.status = 'paused';
            saveData();
            clearSendTimer();
            console.log(`❌ All SMTPs exhausted. Paused.`);
            return;
        }

        try {
            const context = resolvePlaceholdersForEmail(recipient, campaign, smtp);
            
            let sIdx = campaign.active_header_set_idx || 0;
            if (campaign.header_processing === 'Randomize' && campaign.header_sets && campaign.header_sets.length > 0) {
                sIdx = Math.floor(Math.random() * campaign.header_sets.length);
            }
            const activeSet = (campaign.header_sets && campaign.header_sets[sIdx]) || {};

            const topFromNameOrig = (activeSet.from_name || campaign.from_name || '').trim();
            const topSubjectOrig = (activeSet.subject || campaign.subject || '').trim();

            const isFromEmpty = isFieldEmpty(topFromNameOrig);
            const isSubEmpty  = isFieldEmpty(topSubjectOrig);

            let fromName = isFromEmpty ? '' : topFromNameOrig;
            let fSource  = activeSet.from_email_source || campaign.from_email_source || 'custom';
            let fromEmail = activeSet.from_email || campaign.from_email || '';

            if (fSource === 'smtp_user') {
                fromEmail = smtp.username || (smtp.auth && smtp.auth.user) || smtp.email;
            } else if (fSource === 'smtp_from') {
                fromEmail = smtp.from || smtp.email;
            }

            let subjectStr = isSubEmpty ? '' : topSubjectOrig;
            let replyToVal = (activeSet.reply_to || campaign.reply_to || '').trim();

            const placeholders = {
                '[domain]': smtp.host.includes('.') ? smtp.host.split('.').slice(-2).join('.') : smtp.host,
                '[default_from_email]': smtp.email,
                '[from]': `"${applyPlaceholdersGlobal(fromName, context)}" <${applyPlaceholdersGlobal(fromEmail, context)}>`,
                '[subject]': applyPlaceholdersGlobal(subjectStr, context),
                '[to]': recipient.email,
                '[smtp_date]': format24h(new Date()),
                '[content_type]': activeSet.content_type || campaign.content_type || 'text/html',
                '[charset]': activeSet.charset || campaign.charset || 'UTF-8',
                '[content_transfer_encoding]': activeSet.ct_encoding || campaign.ct_encoding || '8bit'
            };

            const applyLocalPlaceholders = (text) => {
                let res = text || '';
                for (const [k, v] of Object.entries(placeholders)) {
                    res = res.replace(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), v);
                }
                return applyPlaceholdersGlobal(res, context);
            };

            fromName = applyLocalPlaceholders(rotateLine(fromName));
            fromEmail = applyLocalPlaceholders(fromEmail);
            subjectStr = applyLocalPlaceholders(rotateLine(subjectStr));

            if (activeSet.from_name_encoding === 'placeholder' && activeSet.from_name_placeholder) {
                const tag = activeSet.from_name_placeholder;
                const match = (campaign.placeholders || []).find(p => p.key === tag);
                if (match && match.values && match.values.length) {
                    fromName = match.values[Math.floor(Math.random() * match.values.length)];
                    fromName = applyLocalPlaceholders(fromName);
                }
            }
            if (activeSet.subject_encoding === 'placeholder' && activeSet.subject_placeholder) {
                const tag = activeSet.subject_placeholder;
                const match = (campaign.placeholders || []).find(p => p.key === tag);
                if (match && match.values && match.values.length) {
                    subjectStr = match.values[Math.floor(Math.random() * match.values.length)];
                    subjectStr = applyLocalPlaceholders(subjectStr);
                }
            }

            const fnEnc = activeSet.from_name_encoding || campaign.from_name_encoding;
            const subEnc = activeSet.subject_encoding || campaign.subject_encoding;
            const charset = activeSet.charset || campaign.charset || 'UTF-8';

            if (fnEnc && fnEnc !== 'none' && fnEnc !== 'placeholder') {
                fromName = encodeHeaderValue(fromName, fnEnc, charset);
            }
            if (subEnc && subEnc !== 'none' && subEnc !== 'placeholder') {
                subjectStr = encodeHeaderValue(subjectStr, subEnc, charset);
            }

            fromName = decodeRFC2047(fromName);
            subjectStr = decodeRFC2047(subjectStr);

            const bodyVar = pickVariant(campaign.html_bodies, '<p>(no body)</p>');
            const html    = applyLocalPlaceholders(bodyVar);
            const subject = subjectStr;

            let transporter = smtpTransporters.get(smtp.id);
            if (!transporter) {
                transporter = nodemailer.createTransport({
                    host: smtp.host, port: smtp.port, secure: smtp.port === 465,
                    auth: { user: smtp.username, pass: smtp.password },
                    tls:  { rejectUnauthorized: false },
                    connectionTimeout: 30000, greetingTimeout: 30000, socketTimeout: 30000,
                    pool: true, maxConnections: 1 
                });
                smtpTransporters.set(smtp.id, transporter);
            }

            const mailOpts = {
                from:    formatFromHeader(fromName, fromEmail),
                to:      recipient.email,
                subject,
                html,
                headers: {}
            };

            if (replyToVal) {
                mailOpts.replyTo = applyLocalPlaceholders(replyToVal);
            }

            if (activeSet && activeSet.content) {
                const raw = applyLocalPlaceholders(rotateLine(activeSet.content));
                raw.split('\n').forEach(line => {
                    const idx = line.indexOf(':');
                    if (idx > -1) {
                        const h = line.substring(0, idx).trim();
                        const v = line.substring(idx + 1).trim();
                        const headLow = h.toLowerCase();
                        const protectedFields = ['from','to','subject','reply-to','date','message-id','mime-version','content-type','content-transfer-encoding','return-path','cc','bcc','content-disposition'];
                        if (protectedFields.includes(headLow)) {
                            if (headLow === 'from') {
                                mailOpts.from = v;
                                return;
                            }
                            if (headLow === 'subject') {
                                mailOpts.subject = decodeRFC2047(v);
                                return;
                            }
                            if (headLow === 'to')         mailOpts.to = v;
                            if (headLow === 'message-id') mailOpts.messageId = v;
                            if (headLow === 'return-path') {
                                mailOpts.headers['Return-Path'] = v;
                                mailOpts.returnPath = v;
                                return;
                            }
                            if (headLow === 'reply-to' || headLow === 'reply to') {
                                mailOpts.replyTo = v;
                                return;
                            }
                            return; 
                        }
                        if (h && v) mailOpts.headers[h] = v;
                    }
                });
            } else {
                (campaign.email_headers || []).forEach(h => {
                    if (h.header && h.value) {
                        mailOpts.headers[h.header] = applyLocalPlaceholders(h.value);
                    }
                });
            }

            if (campaign.return_path && campaign.return_path.trim() && campaign.return_path !== '[default_from_email]') {
                mailOpts.headers['Return-Path'] = campaign.return_path.trim();
            }

            const info = await transporter.sendMail(mailOpts);

            recipient.status  = 'sent';
            recipient.sent_at = new Date();
            campaign.sent_count++;
            smtp.sent_today++;
            perSmtpCount++;
            emailsSinceLast++;
            batchCount++;
            totalSentThisRun++;

            // ── Domain stats (like Python domain_stats) ──────────────────
            const domain = recipient.email.split('@')[1];
            domainStats[domain]    = domainStats[domain]    || { sent: 0, failed: 0 };
            runDomainStats[domain] = runDomainStats[domain] || { sent: 0, failed: 0 };
            domainStats[domain].sent++;
            runDomainStats[domain].sent++;
            runSmtpBreakdown[smtp.email] = (runSmtpBreakdown[smtp.email] || 0) + 1;

            console.log(`✅ [${recIdx}/${allRecipients.length}] → ${recipient.email} via ${smtp.email}`);

            if (campaign.test_after_emails > 0 && emailsSinceLast >= campaign.test_after_emails) {
                const dest = campaign.test_email_destination || smtp.email;
                await sendTestEmail(campaign, smtp, dest, 'Every-N test');
                emailsSinceLast = 0;
            }

            if (shouldHaltTick()) {
                sendingLogs.push({ id: nextId++, campaign_id: cid, recipient_email: recipient.email, smtp_used: smtp.email, from_header: formatFromHeader(fromName, fromEmail), reply_to_header: replyToVal || '', status: 'sent', message_id: info.messageId, sent_at: new Date() });
                saveData();
                return;
            }

            if (campaign.batch_size > 0 && batchCount >= campaign.batch_size) {
                const pauseMs = campaign.batch_pause * (campaign.batch_pause_unit === 'hour' ? 3600000 : campaign.batch_pause_unit === 'minute' ? 60000 : 1000);
                console.log(`⏳ Batch pause ${campaign.batch_pause} ${campaign.batch_pause_unit}...`);
                sendingLogs.push({ id: nextId++, campaign_id: cid, recipient_email: recipient.email, smtp_used: smtp.email, from_header: formatFromHeader(fromName, fromEmail), reply_to_header: replyToVal || '', status: 'sent', message_id: info.messageId, sent_at: new Date() });
                batchCount = 0;
                saveData();
                if (!shouldHaltTick()) scheduleNext(pauseMs + delayMs);
                return;
            }

            sendingLogs.push({ id: nextId++, campaign_id: cid, recipient_email: recipient.email, smtp_used: smtp.email, from_header: formatFromHeader(fromName, fromEmail), reply_to_header: replyToVal || '', status: 'sent', message_id: info.messageId, sent_at: new Date() });
            saveData();

        } catch (err) {
            console.error(`❌ Failed → ${recipient.email}: ${err.message}`);
            recipient.status = 'failed';
            campaign.failed_count++;

            // ── Classify bounce (like Python SmartBounceManager) ─────────
            const bounceType = classifyBounce(err.message);
            runBounces[bounceType] = (runBounces[bounceType] || 0) + 1;

            // Track domain failure
            const failDomain = recipient.email.split('@')[1];
            domainStats[failDomain]    = domainStats[failDomain]    || { sent: 0, failed: 0 };
            runDomainStats[failDomain] = runDomainStats[failDomain] || { sent: 0, failed: 0 };
            domainStats[failDomain].failed++;
            runDomainStats[failDomain].failed++;

            // Auto-suppress hard bounces (like Python remove_from_list for hard bounces)
            if (bounceType === 'hard') {
                const emailLower = recipient.email.toLowerCase();
                if (!suppressionList.includes(emailLower)) {
                    suppressionList.push(emailLower);
                    console.log(`🚫 Auto-suppressed hard bounce: ${recipient.email}`);
                }
            }

            // Save bounce record
            bounceRecords.push({
                id:          nextId++,
                email:       recipient.email,
                type:        bounceType,
                error:       err.message,
                campaign_id: cid,
                smtp_used:   smtp.email,
                ts:          new Date().toISOString(),
            });

            sendingLogs.push({ id: nextId++, campaign_id: cid, recipient_email: recipient.email, smtp_used: smtp.email, status: 'failed', error: err.message, sent_at: new Date() });
            saveData();
        }

        if (!shouldHaltTick()) scheduleNext(delayMs);
    }

    scheduleNext(delayMs);
}

// ── Send / Pause / Resume ───────────────────────────────────────────────────
app.post('/api/campaigns/:id/send', async (req, res) => {
    const id = parseInt(req.params.id);

    // FIX 3: Hard lock to prevent double-launch from multiple rapid clicks
    if (launchLocks.has(id)) {
        return res.status(429).json({ success: false, error: 'Launch already in progress, please wait.' });
    }
    launchLocks.add(id);

    try {
        const c = campaigns.find(c => c.id === id);
        if (!c) return res.status(404).json({ success: false, error: 'Not found' });
        if (c.status === 'running') return res.status(400).json({ success: false, error: 'Already running' });

        const campRecs = recipients.filter(r => r.campaign_id === id);
        let pending = campRecs.filter(r => r.status === 'pending').length;

        // Auto re-run: reset if completed/paused with no pending left
        const canAutoRerun = campRecs.length > 0 && pending === 0 && (
            c.status === 'completed' || c.status === 'paused' ||
            (c.status === 'draft' && campRecs.every(r => r.status !== 'pending'))
        );
        if (canAutoRerun) {
            campRecs.forEach(r => { r.status = 'pending'; r.sent_at = null; });
            c.sent_count       = 0;
            c.failed_count     = 0;
            c.repeat_current   = 0;
            c.range_start_from = 0;
            c.range_count      = 0;
            c.stop_after       = 0;
            c.status           = 'draft';
            saveData();
            pending = recipients.filter(r => r.campaign_id === id && r.status === 'pending').length;
            console.log(`🔁 Re-run: reset ${pending} recipients for campaign ${id}`);
        }

        const smtpIdSet = new Set(normalizeSmtpAccountIds(c.smtp_accounts));
        const selected  = smtpAccounts.filter(a => smtpIdSet.has(a.id));
        if (!selected.length)
            return res.status(400).json({ success: false, error: 'No SMTP accounts selected for this campaign.' });

        const verifyFailures = [];
        await Promise.all(selected.map(async (acc) => {
            try {
                await verifySmtpAccountNow(acc);
            } catch (e) {
                acc.health_status = 'unhealthy';
                acc.is_active     = false;
                acc.last_tested   = new Date();
                verifyFailures.push({ email: acc.email, host: acc.host, error: e.message });
            }
        }));
        saveData();
        if (verifyFailures.length) {
            return res.status(400).json({
                success: false,
                error: `SMTP verification failed for ${verifyFailures.length} account(s). Fix credentials or remove bad accounts.`,
                failures: verifyFailures
            });
        }

        const healthy = selected;

        const skipPreflight = process.env.SKIP_PREFLIGHT === '1' || /^true$/i.test(process.env.SKIP_PREFLIGHT || '');
        const hasTestDest = (c.test_email_destination || '').trim();
        let testDestination = hasTestDest || healthy[0].email;
        let testSuccess = healthy.length;

        // Only run preflight if not skipped AND a test destination is explicitly configured
        if (!skipPreflight && hasTestDest) {
            const byHost = new Map();
            for (const smtp of healthy) {
                const key = String(smtp.host || '').toLowerCase().trim() || `nohost-${smtp.id}`;
                if (!byHost.has(key)) byHost.set(key, smtp);
            }
            console.log(`🧪 Pre-send: ${healthy.length} account(s), ${byHost.size} unique host(s)`);
            const results = [];
            for (const smtp of byHost.values()) {
                results.push({ smtp: smtp.email, host: smtp.host, ...(await sendTestEmail(c, smtp, testDestination, 'Pre-send')) });
            }
            const failed = results.filter(r => !r.success);
            if (failed.length) {
                const detail = failed.map(f => `${f.host} (${f.smtp})`).join('; ');
                return res.status(400).json({
                    success: false,
                    error: `Pre-send test failed for: ${detail}. Fix connectivity or set SKIP_PREFLIGHT=1 to bypass.`
                });
            }
            testSuccess = results.length;
        }

        // Check if launch_date is in the future — schedule instead of running immediately
        if (c.launch_date && new Date() < new Date(c.launch_date)) {
            c.status = 'scheduled';
            c.total_recipients = recipients.filter(r => r.campaign_id === id).length;
            saveData();
            return res.json({
                success: true,
                message: `Campaign scheduled for ${c.launch_date}. It will start automatically at that time.`,
                scheduled: true,
                launch_date: c.launch_date
            });
        }

        c.status           = 'running';
        c.total_recipients = recipients.filter(r => r.campaign_id === id).length;
        saveData();
        startSending(c);

        res.json({
            success: true,
            message: (!skipPreflight && hasTestDest)
                ? `Campaign started. ${testSuccess} SMTP host(s) verified (sent to ${testDestination}).`
                : `Campaign started. ${pending} pending.`,
            pending,
            smtp_count: healthy.length
        });
    } finally {
        // FIX 3: Always release the lock
        launchLocks.delete(id);
    }
});

app.post('/api/campaigns/:id/pause', (req, res) => {
    const id = parseInt(req.params.id);
    const c  = campaigns.find(c => c.id === id);
    if (!c) return res.status(404).json({ success: false });
    if (c.status !== 'running') return res.status(400).json({ success: false, error: 'Not running' });
    c.status = 'paused';
    if (campaignSendTimers[id]) { clearTimeout(campaignSendTimers[id]); delete campaignSendTimers[id]; }
    saveData();
    res.json({ success: true, message: 'Campaign paused' });
});

app.post('/api/campaigns/:id/resume', async (req, res) => {
    const c = campaigns.find(c => c.id === parseInt(req.params.id));
    if (!c) return res.status(404).json({ success: false });
    if (c.status !== 'paused') return res.status(400).json({ success: false, error: 'Not paused' });
    c.status = 'running';
    saveData();
    startSending(c);
    res.json({ success: true, message: 'Campaign resumed' });
});

/** Stop sending and return campaign to draft (SMTP Drops Monitor–style hard stop). */
app.post('/api/campaigns/:id/stop', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const c  = campaigns.find(x => x.id === id);
    if (!c) return res.status(404).json({ success: false });
    if (c.status !== 'running' && c.status !== 'paused') {
        return res.status(400).json({ success: false, error: 'Campaign is not active' });
    }
    c.status = 'draft';
    if (campaignSendTimers[id]) { clearTimeout(campaignSendTimers[id]); delete campaignSendTimers[id]; }
    saveData();
    res.json({ success: true, message: 'Campaign stopped' });
});

// ════════════════════════════════════════════════════════════════════════════
//  LOGS
// ════════════════════════════════════════════════════════════════════════════
app.get('/api/campaigns/:id/logs', (req, res) => {
    const id    = parseInt(req.params.id);
    const page  = parseInt(req.query.page  || 1);
    const limit = parseInt(req.query.limit || 50);
    const list  = sendingLogs.filter(l => l.campaign_id === id);
    res.json({ success: true, logs: list.slice((page - 1) * limit, page * limit), total: list.length, page, limit });
});

app.delete('/api/campaigns/:id/logs', (req, res) => {
    const id     = parseInt(req.params.id);
    const before = sendingLogs.length;
    sendingLogs  = sendingLogs.filter(l => l.campaign_id !== id);
    saveData();
    res.json({ success: true, deleted: before - sendingLogs.length });
});

// ════════════════════════════════════════════════════════════════════════════
//  BOUNCES
// ════════════════════════════════════════════════════════════════════════════
app.get('/api/bounces', (req, res) => {
    const { campaign_id, type, page = 1, limit = 100 } = req.query;
    let list = [...bounceRecords];
    if (campaign_id) list = list.filter(b => b.campaign_id === parseInt(campaign_id));
    if (type)        list = list.filter(b => b.type === type);
    const total  = list.length;
    const paged  = list.slice((page - 1) * limit, page * limit);
    const counts = { hard: 0, soft: 0, policy: 0, unknown: 0 };
    bounceRecords.forEach(b => { if (counts[b.type] !== undefined) counts[b.type]++; });
    res.json({ success: true, bounces: paged, total, counts });
});

// ════════════════════════════════════════════════════════════════════════════
//  SCHEDULED CAMPAIGNS DAEMON
// ════════════════════════════════════════════════════════════════════════════
setInterval(() => {
    campaigns.filter(c => c.status === 'scheduled').forEach(c => {
        // Only trigger if campaign actually has pending recipients
        const hasPending = recipients.some(r => r.campaign_id === c.id && r.status === 'pending');
        if (hasPending && c.launch_date && new Date() >= new Date(c.launch_date)) {
            c.status = 'running';
            saveData();
            console.log(`⏰ Scheduled time reached for Campaign ${c.id}. Starting...`);
            startSending(c);
        }
    });
}, 15000);

app.delete('/api/bounces', (req, res) => {
    const before  = bounceRecords.length;
    bounceRecords = [];
    saveData();
    res.json({ success: true, deleted: before });
});



// ════════════════════════════════════════════════════════════════════════════
//  DOMAIN STATS  (like Python domain_stats)
// ════════════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════════════
//  SETTINGS & .ENV SYNC
// ════════════════════════════════════════════════════════════════════════════

function updateEnvKey(key, value) {
    const envPath = path.join(__dirname, '.env');
    let content = '';
    if (fs.existsSync(envPath)) content = fs.readFileSync(envPath, 'utf8');
    
    const lines = content.split(/\r?\n/);
    const idx = lines.findIndex(l => l.startsWith(`${key}=`));
    
    if (idx > -1) {
        lines[idx] = `${key}=${value}`;
    } else {
        lines.push(`${key}=${value}`);
    }
    
    fs.writeFileSync(envPath, lines.join('\n'));
}

app.get('/api/shortlink-settings', (req, res) => {
    res.json({ success: true, settings: shortlinkSettings });
});

app.put('/api/shortlink-settings', (req, res) => {
    shortlinkSettings = { ...shortlinkSettings, ...req.body };
    
    // Sync keys to .env
    const providers = shortlinkSettings.providers || {};
    if (providers['Bitly']?.apiKey)         updateEnvKey('BITLY_API_KEY',       providers['Bitly'].apiKey);
    if (providers['Bitly']?.clientId)       updateEnvKey('BITLY_CLIENT_ID',     providers['Bitly'].clientId);
    if (providers['Bitly']?.clientSecret)   updateEnvKey('BITLY_CLIENT_SECRET', providers['Bitly'].clientSecret);
    if (providers['Short.io']?.apiKey)      updateEnvKey('SHORTIO_API_KEY',     providers['Short.io'].apiKey);
    if (providers['Cutt.ly']?.apiKey)       updateEnvKey('CUTTLY_API_KEY',      providers['Cutt.ly'].apiKey);
    if (providers['TinyURL']?.apiKey)       updateEnvKey('TINYURL_API_KEY',      providers['TinyURL'].apiKey);

    saveData();
    res.json({ success: true, settings: shortlinkSettings });
});

app.get('/api/click-protection-settings', (req, res) => {
    res.json({ success: true, settings: clickProtectionSettings });
});

app.put('/api/click-protection-settings', (req, res) => {
    clickProtectionSettings = { ...clickProtectionSettings, ...req.body };
    saveData();
    res.json({ success: true, settings: clickProtectionSettings });
});

app.get('/api/suspicious-clicks', (req, res) => {
    res.json({ success: true, clicks: suspiciousClicks });
});

async function shortenLink(url, provider) {
    const s = shortlinkSettings;
    const providers = s.providers || {};
    const effectiveProvider = (provider === 'Random' && s.randomEnabled) 
        ? Object.keys(providers).filter(k => providers[k].enabled && k !== 'Random')[Math.floor(Math.random() * (Object.keys(providers).length - 1))]
        : (provider === 'Random' ? s.defaultProvider : provider);

    const config = providers[effectiveProvider] || {};
    let shortUrl = url;

    try {
        if (effectiveProvider === 'is.gd') {
            const r = await axios.get(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`);
            shortUrl = r.data;
        } else if (effectiveProvider === 'TinyURL') {
            const r = await axios.post('https://api.tinyurl.com/dev/api-key', { url }, { headers: { Authorization: `Bearer ${config.apiKey}` } });
            shortUrl = r.data.data.tiny_url;
        } else if (effectiveProvider === 'Bitly') {
            let token = config.apiKey || process.env.BITLY_API_KEY;
            
            // If no token but we have Client ID/Secret, try to exchange
            if (!token && config.clientId && config.clientSecret) {
                try {
                    const authR = await axios.post('https://api-ssl.bitly.com/oauth/access_token', 
                        new URLSearchParams({
                            client_id: config.clientId,
                            client_secret: config.clientSecret,
                            grant_type: 'client_credentials'
                        }).toString(),
                        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
                    );
                    if (authR.data && authR.data.access_token) {
                        token = authR.data.access_token;
                        // Cache it in settings? For now just use it.
                        console.log('✅ Bitly: Exchanged Client ID/Secret for Access Token');
                    }
                } catch (aErr) {
                    console.error('❌ Bitly Auth Error:', aErr.response?.data || aErr.message);
                }
            }

            if (!token) throw new Error('Bitly Access Token missing');
            const r = await axios.post('https://api-ssl.bitly.com/v4/shorten', { long_url: url }, { headers: { Authorization: `Bearer ${token}` } });
            shortUrl = r.data.link;
        } else if (effectiveProvider === 'Short.io') {
            const r = await axios.post('https://api.short.io/links', { originalURL: url, domain: config.domain || 'short.io' }, { headers: { Authorization: config.apiKey } });
            shortUrl = r.data.shortURL;
        } else if (effectiveProvider === 'Cutt.ly') {
            const r = await axios.get(`https://cutt.ly/api/api.php?key=${config.apiKey}&short=${encodeURIComponent(url)}`);
            if (r.data.url.status === 7) shortUrl = r.data.url.shortLink;
        } else if (effectiveProvider === '1pt.co') {
            const r = await axios.get(`https://1pt.co/api/alias/shorten?url=${encodeURIComponent(url)}`);
            shortUrl = `https://1pt.co/${r.data.short}`;
        }

        shortlinkLogs.unshift({ id: nextId++, original_url: url, short_url: shortUrl, provider: effectiveProvider, ts: new Date().toISOString() });
        if (shortlinkLogs.length > 100) shortlinkLogs.pop();
        return shortUrl;
    } catch (err) {
        console.error(`Shorten error (${effectiveProvider}):`, err.message);
        return url; // Fallback to original
    }
}

app.post('/api/shorten', async (req, res) => {
    const { url, provider } = req.body;
    if (!url) return res.status(400).json({ success: false, error: 'URL missing' });
    const short = await shortenLink(url, provider);
    res.json({ success: true, short_url: short });
});

app.get('/api/shortlink-logs', (req, res) => {
    res.json({ success: true, logs: shortlinkLogs });
});

app.post('/api/campaigns/:id/test-send', async (req, res) => {
    const { testEmails } = req.body;
    if (!testEmails) return res.status(400).json({ success: false, error: 'Test emails missing' });

    const camp = campaigns.find(c => c.id === parseInt(req.params.id, 10));
    if (!camp) return res.status(404).json({ success: false, error: 'Campaign not found' });

    const emails = testEmails.split(/\r?\n/).map(e => e.trim()).filter(e => e.includes('@'));
    if (!emails.length) return res.status(400).json({ success: false, error: 'No valid emails found in paste area' });

    const smtp = pickRandom(smtpAccounts.filter(a => a.health_status === 'healthy')) || smtpAccounts[0];
    if (!smtp) return res.status(500).json({ success: false, error: 'No SMTP available' });

    let sent = 0;
    let errors = [];

    try {
        const transporter = createTransporter(smtp);
        
        for (const email of emails) {
            try {
                const dummyRecipient = { email, firstname: 'Test', lastname: 'User', company: 'Test Co' };
                const placeholders = resolvePlaceholdersForEmail(dummyRecipient, camp, smtp);
                const context = { campaign: camp, recipient: dummyRecipient, smtp };

                const resolveVariantsLocal = (text) => {
                    if (!text) return '';
                    return text.replace(/\{([^{}]+)\}/g, (_, match) => {
                        if (match.includes('|')) {
                            const parts = match.split('|');
                            return parts[Math.floor(Math.random() * parts.length)].trim();
                        }
                        return `{${match}}`;
                    });
                };

                const applyLocalPlaceholders = (text) => {
                    let res = resolveVariantsLocal(text || '');
                    for (const [k, v] of Object.entries(placeholders)) {
                        res = res.replace(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), v);
                    }
                    return applyPlaceholdersGlobal(res, context);
                };

                // Resolve Header Set (Persona) for test-send
                let sIdx = camp.active_header_set_idx || 0;
                const activeSet = (camp.header_sets && camp.header_sets[sIdx]) || {};

                let fromName = activeSet.from_name || camp.from_name || '';
                let fSource  = activeSet.from_email_source || camp.from_email_source || 'custom';
                let fromEmail = activeSet.from_email || camp.from_email || '';
                let replyToVal = (activeSet.reply_to || camp.reply_to || '').trim();
                
                if (fSource === 'smtp_user') {
                    fromEmail = smtp.username || (smtp.auth && smtp.auth.user) || smtp.email;
                } else if (fSource === 'smtp_from') {
                    fromEmail = smtp.from || smtp.email;
                }

                let subjectStr = activeSet.subject || camp.subject || 'No Subject';

                fromName = applyLocalPlaceholders(rotateLine(fromName));
                fromEmail = applyLocalPlaceholders(fromEmail);
                subjectStr = applyLocalPlaceholders(rotateLine(subjectStr));

                // STRIP RFC 2047 wrapping before giving to Nodemailer to avoid DOUBLE ENCODING
                fromName = decodeRFC2047(fromName);
                subjectStr = decodeRFC2047(subjectStr);

                // Handle "Placeholder" encoding (Randomize from tags)
                if (activeSet.from_name_encoding === 'placeholder' && activeSet.from_name_placeholder) {
                    const tag = activeSet.from_name_placeholder;
                    const match = (camp.placeholders || []).find(p => p.key === tag);
                    if (match && match.values && match.values.length) {
                        fromName = match.values[Math.floor(Math.random() * match.values.length)];
                        fromName = applyLocalPlaceholders(fromName);
                    }
                }
                if (activeSet.subject_encoding === 'placeholder' && activeSet.subject_placeholder) {
                    const tag = activeSet.subject_placeholder;
                    const match = (camp.placeholders || []).find(p => p.key === tag);
                    if (match && match.values && match.values.length) {
                        subjectStr = match.values[Math.floor(Math.random() * match.values.length)];
                        subjectStr = applyLocalPlaceholders(subjectStr);
                    }
                }

                const bodyVar = pickRandom(camp.html_bodies) || '<p>(no body)</p>';
                const html = applyLocalPlaceholders(bodyVar);

                const mailOpts = {
                    from:    formatFromHeader(fromName, fromEmail),
                    to:      email,
                    subject: subjectStr,
                    html,
                    disableUrlEncoding: true,
                    headers: {}
                };
                if (replyToVal) {
                    mailOpts.replyTo = applyLocalPlaceholders(replyToVal);
                }
                
                // Apply headers from managed header sets if available
                if (activeSet && activeSet.content) {
                    const raw = applyLocalPlaceholders(rotateLine(activeSet.content));
                    raw.split('\n').forEach(line => {
                        const idx = line.indexOf(':');
                        if (idx > -1) {
                            let h = line.substring(0, idx).trim();
                            const v = line.substring(idx + 1).trim();
                            const headLow = h.toLowerCase();

                            // NORMALIZE & PROTECT: These headers MUST NOT be in mailOpts.headers
                            const protected = ['from','to','subject','reply-to','date','message-id','mime-version','content-type','content-transfer-encoding','return-path','cc','bcc'];
                            if (protected.includes(headLow)) {
                                if (headLow === 'message-id') mailOpts.messageId = v;
                                if (headLow === 'date') mailOpts.date = v;
                                if (headLow === 'return-path') {
                                    mailOpts.headers['Return-Path'] = v;
                                    mailOpts.returnPath = v;
                                }
                                if (headLow === 'reply-to')   mailOpts.replyTo = v;
                                if (headLow === 'subject')    mailOpts.subject = decodeRFC2047(v);
                                if (headLow === 'from')       mailOpts.from = v;
                                return;
                            }

                            if (h && v) mailOpts.headers[h] = v;
                        }
                    });
                }
                await transporter.sendMail(mailOpts);
                sent++;
            } catch (err) {
                errors.push(`${email}: ${err.message}`);
            }
        }

        res.json({ success: true, message: `Sent ${sent} tests. ${errors.length ? `Errors: ${errors.join(', ')}` : ''}` });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/domain-stats', (req, res) => {
    const sorted = Object.entries(domainStats)
        .map(([domain, s]) => ({ domain, ...s, total: s.sent + s.failed,
            rate: s.sent + s.failed > 0 ? ((s.sent / (s.sent + s.failed)) * 100).toFixed(1) : '0' }))
        .sort((a, b) => b.total - a.total);
    res.json({ success: true, domains: sorted });
});

// ════════════════════════════════════════════════════════════════════════════
//  START
// ════════════════════════════════════════════════════════════════════════════
app.listen(PORT, () => {
    console.log(`\n✅  Backend → http://localhost:${PORT}`);
    console.log('─────────────────────────────────────────────');
    console.log('  ENV flags:');
    console.log('    SKIP_PREFLIGHT=1   skip pre-send SMTP tests');
    console.log('    USE_PUBLIC_DNS=1   use 8.8.8.8 / 1.1.1.1');
    console.log('─────────────────────────────────────────────\n');
});