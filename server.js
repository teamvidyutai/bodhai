require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const mysql     = require('mysql2/promise');
const http      = require('http');
const WebSocket = require('ws');
const path      = require('path');

const app  = express();
const PORT = process.env.PORT || process.env.SERVER_PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Support both individual env vars (local) and DATABASE_URL (Railway/Render)
function getDbConfig(){
  if(process.env.DATABASE_URL){
    return { uri: process.env.DATABASE_URL,
      waitForConnections:true, connectionLimit:10,
      enableKeepAlive:true, keepAliveInitialDelay:10000 };
  }
  if(process.env.MYSQL_URL){
    return { uri: process.env.MYSQL_URL,
      waitForConnections:true, connectionLimit:10,
      enableKeepAlive:true, keepAliveInitialDelay:10000 };
  }
  return {
    host:     process.env.DB_HOST     || process.env.MYSQLHOST     || 'localhost',
    port:     process.env.DB_PORT     || process.env.MYSQLPORT     || 3306,
    user:     process.env.DB_USER     || process.env.MYSQLUSER     || 'root',
    password: process.env.DB_PASS     || process.env.MYSQLPASSWORD || '',
    database: process.env.DB_NAME     || process.env.MYSQLDATABASE || 'bodhai',
    waitForConnections: true,
    connectionLimit: 10,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    charset: 'utf8mb4',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  };
}
const pool = mysql.createPool(getDbConfig());

let dbOnline = false;

async function q(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  dbOnline = true;
  return rows;
}

// FIX: parse JSON safely — handles both string and object inputs
function safeJSON(val, def = null) {
  if (val === null || val === undefined) return def;
  if (typeof val === 'object') return val;           // already parsed by mysql2
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch (e) {
      // double-encoded string: parse twice
      try { return JSON.parse(JSON.parse(val)); } catch (e2) { return def; }
    }
  }
  return def;
}

// FIX: ensure value stored as JSON string, never double-encoded
function toJSONStr(val) {
  if (val === null || val === undefined) return '[]';
  if (typeof val === 'string') {
    try { JSON.parse(val); return val; }          // already valid JSON string
    catch (e) { return JSON.stringify(val); }
  }
  return JSON.stringify(val);
}

function toSession(row) {
  if (!row) return null;
  return {
    id:          row.id,
    student:     row.student,
    roll:        row.roll,
    subject:     row.subject,
    score:       row.score,
    total:       row.total,
    answers:     safeJSON(row.answers, []),
    timings:     safeJSON(row.timings, []),
    flags:       safeJSON(row.flags,   []),
    conceptMap:  safeJSON(row.concept_map, {}),  // FIX: renamed from concept_map
    sessionCode: row.session_code,
    lang:        row.lang,
    source:      row.source,
    deviceId:    row.device_id,
    timestamp:   (() => {
      if(!row.created_at) return Date.now();
      const d = new Date(row.created_at);
      return isNaN(d.getTime()) ? Date.now() : d.getTime();
    })(),
  };
}

// ── Health ────────────────────────────────────────────────────────────────────

;

;

app.get('/api/health', async (req, res) => {
  try {
    await q('SELECT 1');
    res.json({ status: 'ok', db: 'connected', time: new Date().toISOString() });
  } catch (e) {
    dbOnline = false;
    res.status(503).json({ status: 'error', db: 'disconnected', message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// TABLE 1: sessions
// ═══════════════════════════════════════════════════════════════

;

app.get('/api/sessions', async (req, res) => {
  try {
    const { student, subject, session_code, limit = 1000 } = req.query;
    const safeLimit = Math.min(parseInt(limit)||1000, 10000); // cap at 10000
    let sql = 'SELECT * FROM sessions';
    const params = [], where = [];
    if (student)      { where.push('student = ?');      params.push(student); }
    if (subject)      { where.push('subject = ?');      params.push(subject); }
    if (session_code) { where.push('session_code = ?'); params.push(session_code); }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(safeLimit);
    const rows = await q(sql, params);
    // Per-row safety: if one row fails, skip it — don't crash entire response
    const sessions = rows.map(row => {
      try{ return toSession(row); }
      catch(e){ console.error('[toSession] row',row.id,'error:',e.message); return null; }
    }).filter(Boolean);
    res.json(sessions);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/sessions', async (req, res) => {
  try {
    const s = req.body;
    if (!s.student || s.score === undefined)
      return res.status(400).json({ error: 'student and score required' });

    // FIX: ensure concept_map is stored as clean JSON, not double-encoded
    const [result] = await pool.query(
      `INSERT INTO sessions
        (student,roll,subject,score,total,answers,timings,flags,
         concept_map,session_code,lang,source,device_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        s.student, s.roll || 0, s.subject || 'Unknown',
        s.score, s.total || 6,
        toJSONStr(s.answers),
        toJSONStr(s.timings),
        toJSONStr(s.flags),
        toJSONStr(s.conceptMap || s.concept_map),  // accept both field names
        s.sessionCode || s.session_code || 'DIRECT',
        s.lang || 'hi',
        s.source || 'student',
        s.deviceId || s.device_id || null,
      ]
    );
    const saved = toSession({ ...s, id: result.insertId, created_at: new Date() });
    broadcast({ type: 'session-saved', data: saved });
    res.json({ success: true, id: result.insertId });
  } catch (e) {
    console.error('POST /api/sessions error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/sessions', async (req, res) => {
  try {
    await q('DELETE FROM sessions');
    broadcast({ type: 'sessions-cleared' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════
// TABLE 2: custom_banks (teacher question banks)
// ═══════════════════════════════════════════════════════════════
app.get('/api/custom-banks', async (req, res) => {
  try {
    const rows = await q('SELECT subject, questions, updated_at FROM custom_banks ORDER BY subject');
    res.json(rows.map(r => ({
      subject:    r.subject,
      questions:  safeJSON(r.questions, []),
      updated_at: r.updated_at,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/custom-banks', async (req, res) => {
  try {
    const { subject, questions, createdBy } = req.body;
    if (!subject || !questions) return res.status(400).json({ error: 'subject and questions required' });
    await q(
      `INSERT INTO custom_banks (subject, questions, created_by)
       VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE questions = VALUES(questions), created_by = VALUES(created_by)`,
      [subject, toJSONStr(questions), createdBy || 'Teacher']
    );
    broadcast({ type: 'custom-bank-updated', subj: subject });
    res.json({ success: true, subject, count: questions.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/custom-banks/:subject', async (req, res) => {
  try {
    await q('DELETE FROM custom_banks WHERE subject = ?', [req.params.subject]);
    broadcast({ type: 'custom-bank-deleted', subj: req.params.subject });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════
// TABLE 3: session_codes (teacher classroom codes)
// ═══════════════════════════════════════════════════════════════
app.get('/api/session-codes', async (req, res) => {
  try {
    const rows = await q(
      `SELECT sc.code, sc.label, sc.active, sc.created_at,
              COUNT(s.id) AS student_count,
              ROUND(AVG(s.score/NULLIF(s.total,0)*100),1) AS avg_score
       FROM session_codes sc
       LEFT JOIN sessions s ON s.session_code = sc.code
       GROUP BY sc.code, sc.label, sc.active, sc.created_at
       ORDER BY sc.created_at DESC LIMIT 50`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/session-codes', async (req, res) => {
  try {
    const { code, label, activate } = req.body;
    if (!code) return res.status(400).json({ error: 'code required' });
    await q(
      'INSERT IGNORE INTO session_codes (code, label) VALUES (?,?)',
      [code, label || ('Session ' + new Date().toLocaleDateString('en-IN'))]
    );
    const upperCode = code.toUpperCase();
    const sessionLabel = label || upperCode;
    // Save room state so late-joining students get it on WS connect
    rooms.set(upperCode + ':state', { code: upperCode, label: sessionLabel, ts: Date.now() });
    // Global broadcast — session code is public info, like writing it on the board
    broadcast({ type: 'session-activated', code: upperCode, label: sessionLabel, ts: Date.now() });
    res.json({ success: true, code: upperCode });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════
// TABLE 4: sync_queue (offline-to-online sync audit log)
// ═══════════════════════════════════════════════════════════════
app.post('/api/sync', async (req, res) => {
  try {
    const { sessions = [], deviceId } = req.body;
    if (!sessions.length) return res.json({ synced: 0, total: 0 });

    let synced = 0;
    for (const s of sessions) {
      try {
        // Content-based deduplication — matches on exact answers (not timestamp)
        // This correctly handles offline-sync records with timestamp=0
        const answersStr = JSON.stringify(s.answers||[]);
        const existing = await q(
          `SELECT id FROM sessions
           WHERE student=? AND subject=? AND score=? AND total=?
           AND CAST(answers AS CHAR(10000)) = ?
           LIMIT 1`,
          [s.student, s.subject||'Unknown', s.score, s.total||6, answersStr]
        );
        if (existing.length) continue; // skip exact duplicate

        // Define ts here — timestamp in ms from client, null if missing
        const ts = (s.timestamp && s.timestamp > 0) ? s.timestamp : null;

        await q(
          `INSERT INTO sessions
            (student,roll,subject,score,total,answers,timings,flags,
             concept_map,session_code,lang,source,device_id,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            s.student, s.roll || 0, s.subject || 'Unknown',
            s.score, s.total || 6,
            toJSONStr(s.answers), toJSONStr(s.timings),
            toJSONStr(s.flags),   toJSONStr(s.conceptMap || s.concept_map),
            s.sessionCode || 'DIRECT', s.lang || 'hi',
            'offline-sync', deviceId || null,
            ts ? new Date(ts).toISOString().slice(0,19).replace('T',' ') : null,
          ]
        );

        // Log in sync_queue for audit trail
        await q(
          'INSERT INTO sync_queue (device_id, payload, synced, synced_at) VALUES (?,?,1,NOW())',
          [deviceId || null, toJSONStr(s)]
        );
        synced++;
      } catch (rowErr) {
        console.error('Sync row error:', rowErr.message);
      }
    }

    if (synced > 0) {
      console.log(`Synced ${synced}/${sessions.length} offline sessions from ${deviceId}`);
      const all = await q('SELECT * FROM sessions ORDER BY created_at DESC LIMIT 1000');
      broadcast({ type: 'sync-complete', count: synced, sessions: all.map(toSession) });
    }

    res.json({ success: true, synced, total: sessions.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/sync-queue', async (req, res) => {
  try {
    const rows = await q('SELECT id, device_id, synced, created_at, synced_at FROM sync_queue ORDER BY created_at DESC LIMIT 100');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Analytics summary ─────────────────────────────────────────────────────────
app.get('/api/analytics/summary', async (req, res) => {
  try {
    const [totals]   = await q('SELECT COUNT(*) AS sessions, ROUND(AVG(score/NULLIF(total,0)*100),1) AS avg FROM sessions');
    const [students] = await q('SELECT COUNT(DISTINCT student) AS n FROM sessions');
    const subjects   = await q('SELECT subject, COUNT(*) AS sessions, ROUND(AVG(score/NULLIF(total,0)*100),1) AS avg FROM sessions GROUP BY subject ORDER BY avg');
    const codes      = await q('SELECT sc.code, COUNT(s.id) AS students FROM session_codes sc LEFT JOIN sessions s ON s.session_code=sc.code GROUP BY sc.code ORDER BY students DESC LIMIT 10');
    res.json({ totalSessions: totals.sessions, totalStudents: students.n, avgScore: totals.avg || 0, subjects, codes });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── WebSocket ─────────────────────────────────────────────────────────────────
const server  = http.createServer(app);
const wss     = new WebSocket.Server({ server, path: '/ws' });
const clients = new Set();

// ── Room-based session state ─────────────────────────────────────────────────
// Each session code = one isolated room.
// Teacher A's broadcast ONLY reaches students in room BODH-AAAA.
// Teacher B's broadcast ONLY reaches students in room BODH-BBBB.
// Zero cross-contamination between classrooms.

const rooms = new Map();  // roomCode → Set of WebSocket clients

function getRoom(code) {
  if (!rooms.has(code)) rooms.set(code, new Set());
  return rooms.get(code);
}

function roomBroadcast(code, data, excludeWs) {
  const msg = JSON.stringify(data);
  const room = rooms.get(code);
  if (!room) return;
  room.forEach(ws => {
    if (ws === excludeWs) return;
    try { if (ws.readyState === WebSocket.OPEN) ws.send(msg); } catch(e) {}
  });
}

function cleanRooms() {
  // Remove closed connections from rooms
  // rooms has two entry types: Set (clients) and plain object (:state)
  // Skip anything that is not a Set to avoid TypeError
  rooms.forEach((members, code) => {
    if (!(members instanceof Set)) return;
    members.forEach(ws => { if (ws.readyState !== WebSocket.OPEN) members.delete(ws); });
    if (members.size === 0) rooms.delete(code);
  });
}
setInterval(cleanRooms, 60000);

wss.on('connection', ws => {
  clients.add(ws);
  ws._rooms = new Set();  // rooms this client has joined

  q('SELECT COUNT(*) AS n FROM sessions').then(([r]) => {
    if (ws.readyState === WebSocket.OPEN)
      // Collect ALL active sessions so student can pick their teacher's room
      var _sessions=[];
      var _now=Date.now();
      var _TTL=8*60*60*1000; // 8 hours — sessions older than this are stale
      rooms.forEach(function(val,key){
        if(typeof key==='string'&&key.endsWith(':state')&&val&&val.code){
          // Only include sessions activated within the last 8 hours
          if(!val.ts||(_now-val.ts)<_TTL) _sessions.push(val);
        }
      });
      _sessions.sort(function(a,b){return b.ts-a.ts;});
      // Max 10 sessions in picker to avoid overwhelming students
      _sessions=_sessions.slice(0,10);
      ws.send(JSON.stringify({ type:'connected', sessionCount:r.n, activeSessions:_sessions, activeSession:_sessions[0]||null }));
  }).catch(() => {});

  ws.on('message', msg => {
    try {
      const d = JSON.parse(msg);

      // ── PING (keep-alive) ───────────────────────────────────────────────
      if (d.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }

      // ── JOIN ROOM ───────────────────────────────────────────────────────
      // Student or teacher tells server which session code they are in.
      // Server puts them in that room. Any future broadcasts are isolated.
      if (d.type === 'join-room' && d.code) {
        const code = d.code.toUpperCase();
        getRoom(code).add(ws);
        ws._rooms.add(code);
        // If there is already an active teacher broadcast for this room, send it
        const roomState = rooms.get(code + ':state');
        if (roomState) {
          ws.send(JSON.stringify({ type: 'session-activated', ...roomState }));
        }
        console.log(`[WS] Client joined room: ${code} (room size: ${getRoom(code).size})`);
      }

      // ── TEACHER BROADCASTS SESSION CODE ─────────────────────────────────
      // session-activated goes to ALL connected clients (global broadcast).
      // A session code is public — like writing it on the blackboard.
      // What stays private: student results (those are room-scoped below).
      // Students with no code auto-fill. Students with a different code ignore it.
      if (d.type === 'activate-session' && d.code) {
        const code = d.code.toUpperCase();
        const label = d.label || code;
        // Teacher joins their own room (for result isolation)
        getRoom(code).add(ws);
        ws._rooms.add(code);
        // Save state so late-joining students also get it on connect
        rooms.set(code + ':state', { code, label, ts: Date.now() });
        // GLOBAL broadcast — every connected student receives this
        broadcast({ type: 'session-activated', code, label, ts: Date.now() });
        console.log(`[WS] Global broadcast: session-activated ${code} (${clients.size} clients notified)`);
      }

      // ── TEACHER ENDS SESSION ────────────────────────────────────────────
      if (d.type === 'deactivate-session' && d.code) {
        const code = d.code.toUpperCase();
        rooms.delete(code + ':state');
        roomBroadcast(code, { type: 'session-deactivated', ts: Date.now() }, ws);
      }

      // ── LIVE RESULT (student submits quiz → teacher sees it instantly) ──
      if (d.type === 'student-result' && d.code) {
        const code = d.code.toUpperCase();
        roomBroadcast(code, { type: 'student-result', data: d.data, ts: Date.now() }, ws);
      }

    } catch(e) {}
  });

  ws.on('close', () => {
    clients.delete(ws);
    // Remove from all rooms
    if (ws._rooms) {
      ws._rooms.forEach(code => {
        const room = rooms.get(code);
        if (room) room.delete(ws);
      });
    }
  });
  ws.on('error', () => clients.delete(ws));
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  clients.forEach(c => {
    try { if (c.readyState === WebSocket.OPEN) c.send(msg); } catch (e) {}
  });
}

// ── MySQL disconnect/reconnect monitor ───────────────────────────────────────
let lastDbState = true;
setInterval(async () => {
  try {
    await pool.query('SELECT 1');
    if (!lastDbState) {
      console.log('✅ MySQL reconnected');
      broadcast({ type: 'db-reconnected' });
      lastDbState = true;
    }
  } catch (e) {
    if (lastDbState) {
      console.warn('⚠️  MySQL disconnected:', e.message);
      broadcast({ type: 'db-disconnected' });
      lastDbState = false;
    }
  }
}, 5000);

// Auto-run schema on startup if tables don't exist
async function ensureSchema(){
  try{
    // Create tables in CURRENT database (Railway uses 'railway' DB)
    // Do NOT switch databases — that would break existing data
    await pool.query(`CREATE TABLE IF NOT EXISTS sessions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      student VARCHAR(150) NOT NULL,
      roll INT DEFAULT 0,
      subject VARCHAR(100) NOT NULL,
      score INT NOT NULL DEFAULT 0,
      total INT NOT NULL DEFAULT 6,
      answers JSON, timings JSON, flags JSON, concept_map JSON,
      session_code VARCHAR(25) DEFAULT 'DIRECT',
      lang VARCHAR(10) DEFAULT 'hi',
      source VARCHAR(20) DEFAULT 'student',
      device_id VARCHAR(64) DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_student(student), INDEX idx_subject(subject),
      INDEX idx_sess_code(session_code)
    ) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE IF NOT EXISTS custom_banks (
      subject VARCHAR(100) PRIMARY KEY,
      questions JSON NOT NULL,
      created_by VARCHAR(150) DEFAULT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE IF NOT EXISTS session_codes (
      code VARCHAR(25) PRIMARY KEY,
      label VARCHAR(200) DEFAULT NULL,
      active TINYINT(1) DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME DEFAULT NULL
    ) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE IF NOT EXISTS sync_queue (
      id INT AUTO_INCREMENT PRIMARY KEY,
      device_id VARCHAR(64),
      payload JSON NOT NULL,
      synced TINYINT(1) DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      synced_at DATETIME DEFAULT NULL
    ) ENGINE=InnoDB`);
    // Add indexes safely — check first to avoid table locks
    try{
      const [idx]=await pool.query("SELECT COUNT(*) as n FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='sessions' AND index_name='idx_ts'");
      if(idx[0].n===0) await pool.query('ALTER TABLE sessions ADD INDEX idx_ts (created_at)');
    }catch(e){ console.log('idx_ts skip:', e.code); }
    console.log('✅ Database schema ready');
  }catch(e){ console.error('Schema setup error:', e.message); }
}

server.listen(PORT, '0.0.0.0', () => {
  ensureSchema();
  // MySQL keepalive ping every 4 minutes (prevents 8h timeout disconnect)
  setInterval(()=>pool.query('SELECT 1').catch(()=>{}), 4*60*1000);
  console.log('\n  ╔════════════════════════════════════════════╗');
  console.log(`  ║  BodhAI Backend v2.1  — port ${PORT}          ║`);
  console.log('  ║  Tables: sessions · custom_banks           ║');
  console.log('  ║          session_codes · sync_queue        ║');
  console.log('  ╚════════════════════════════════════════════╝\n');
  console.log(`  http://localhost:${PORT}/BodhAI_Teacher.html`);
  console.log(`  http://localhost:${PORT}/api/health\n`);
});


// ════════════════════════════════════════════════════════════════════════
// SERVER-SIDE CSV EXPORT — bypasses JSON serialization entirely
// Browser hits these URLs directly and gets a file download
// ════════════════════════════════════════════════════════════════════════

function escCSV(v){
  if(v===null||v===undefined) return '""';
  return '"'+String(v).replace(/"/g,'""')+'"';
}

// Export 1: All Sessions CSV
app.get('/api/export/sessions.csv', async (req, res) => {
  try{
    const rows = await q('SELECT id,student,roll,subject,score,total,session_code,lang,source,created_at FROM sessions ORDER BY created_at DESC LIMIT 5000');
    const lines = ['"ID","Student","Roll","Subject","Score","Total","Pct%","Grade","Session Code","Language","Source","Date"'];
    rows.forEach(r=>{
      try{
        const pct  = (r.total>0) ? Math.round((r.score/r.total)*100) : 0;
        const grade= pct>=85?'A+':pct>=70?'A':pct>=55?'B':pct>=40?'C':'D';
        const dt   = r.created_at ? String(r.created_at).slice(0,19) : '';
        lines.push([r.id,r.student||'',r.roll||0,r.subject||'',r.score||0,
                    r.total||0,pct,grade,r.session_code||'',r.lang||'',r.source||'',dt]
                   .map(escCSV).join(','));
      }catch(re){ console.error('row',r.id,'skip:',re.message); }
    });
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition','attachment; filename="BodhAI_Sessions_'+new Date().toISOString().slice(0,10)+'.csv"');
    res.send('\uFEFF'+lines.join('\r\n'));
  }catch(e){ console.error('[sessions.csv]',e.message); res.status(500).send('Error: '+e.message); }
});

// Export 2: Student Summary CSV
app.get('/api/export/students.csv', async (req, res) => {
  try{
    const rows = await q('SELECT student, score, total, created_at FROM sessions ORDER BY student');
    // Aggregate in JS to avoid GROUP BY strict mode issues
    const map = {};
    rows.forEach(r=>{
      if(!r.student) return;
      if(!map[r.student]) map[r.student]={sessions:0,correct:0,total:0,last:null};
      map[r.student].sessions++;
      map[r.student].correct += Number(r.score)||0;
      map[r.student].total   += Number(r.total)||0;
      if(!map[r.student].last || r.created_at > map[r.student].last) map[r.student].last=r.created_at;
    });
    const lines = ['"Student","Sessions","Correct","Total Qs","Overall%","Grade","Last Active"'];
    Object.entries(map).sort((a,b)=>{
      const pa=a[1].total>0?a[1].correct/a[1].total:0;
      const pb=b[1].total>0?b[1].correct/b[1].total:0;
      return pb-pa;
    }).forEach(([name,d])=>{
      const pct  = d.total>0 ? Math.round(d.correct/d.total*100) : 0;
      const grade= pct>=85?'A+':pct>=70?'A':pct>=55?'B':pct>=40?'C':'D';
      const dt   = d.last ? String(d.last).slice(0,19) : '';
      lines.push([name,d.sessions,d.correct,d.total,pct,grade,dt].map(escCSV).join(','));
    });
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition','attachment; filename="BodhAI_Students_'+new Date().toISOString().slice(0,10)+'.csv"');
    res.send('\uFEFF'+lines.join('\r\n'));
  }catch(e){ console.error('[students.csv]',e.message); res.status(500).send('Error: '+e.message); }
});

// Export 3: Session Codes CSV
app.get('/api/export/codes.csv', async (req, res) => {
  try{
    // Get codes and sessions separately to avoid GROUP BY mode issues
    const codes = await q('SELECT code, label, active, created_at FROM session_codes ORDER BY created_at DESC');
    const stats = await q(`SELECT session_code, COUNT(*) AS cnt, ROUND(AVG(score/NULLIF(total,0)*100),1) AS avg FROM sessions GROUP BY session_code`);
    const statsMap = {};
    stats.forEach(r=>{ statsMap[r.session_code]={cnt:r.cnt, avg:r.avg}; });
    const rows = codes.map(c=>({
      code:          c.code,
      label:         c.label,
      active:        c.active,
      created_at:    c.created_at,
      student_count: statsMap[c.code]?.cnt||0,
      avg_score:     statsMap[c.code]?.avg||0,
    }));
    const headers = ['Code','Label','Students','Avg Score%','Status','Created'];
    const lines = [headers.map(escCSV).join(',')];
    rows.forEach(r=>{
      const dt = r.created_at ? new Date(r.created_at).toLocaleString('en-IN') : '';
      lines.push([r.code,r.label||'',r.student_count||0,r.avg_score||0,
                  r.active?'Active':'Inactive',dt].map(escCSV).join(','));
    });
    const csv = '\uFEFF' + lines.join('\r\n');
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition','attachment; filename="BodhAI_SessionCodes_'+
      new Date().toISOString().slice(0,10)+'.csv"');
    res.send(csv);
  }catch(e){
    console.error('[export/codes]',e.stack||e.message);
    res.status(500).send('Codes export error: '+e.message);
  }
});

// ── CLEANUP: Remove duplicate sessions ───────────────────────────────────────

// ── Risk Scores endpoint — served to teacher Risk Engine ─────
app.get('/api/risk-scores', async (req, res) => {
  try{
    const rows = await q('SELECT student, score, total, flags, concept_map, created_at FROM sessions ORDER BY created_at DESC LIMIT 2000');
    // Group by student
    const students={};
    rows.forEach(row=>{
      const name=row.student||'Unknown';
      if(!students[name]) students[name]=[];
      const pct=row.total>0?Math.round(row.score/row.total*100):0;
      const flags=safeJSON(row.flags,[]);
      students[name].push({pct, flags, ts:row.created_at});
    });
    // Compute risk per student
    const risks=Object.entries(students).map(([name,sessions])=>{
      const avg=sessions.reduce((a,s)=>a+s.pct,0)/sessions.length;
      sessions.sort((a,b)=>new Date(a.ts)-new Date(b.ts));
      let trend=0;
      if(sessions.length>=3){
        const h=Math.floor(sessions.length/2);
        const early=sessions.slice(0,h).reduce((a,s)=>a+s.pct,0)/h;
        const recent=sessions.slice(-h).reduce((a,s)=>a+s.pct,0)/h;
        trend=recent-early;
      }
      const flagRate=sessions.reduce((a,s)=>a+s.flags.length,0)/sessions.length;
      const risk=Math.min(100,Math.round(Math.max(0,100-avg)*0.4 + (trend<0?Math.min(40,Math.abs(trend)*2):0)*0.25 + Math.min(20,flagRate*10)*0.20));
      return {name,avg:Math.round(avg),trend:Math.round(trend*10)/10,risk,sessions:sessions.length,
        level:risk>=60?'HIGH':risk>=35?'MEDIUM':'LOW'};
    }).sort((a,b)=>b.risk-a.risk);
    res.json(risks);
  }catch(e){ console.error('[risk-scores]',e.message); res.status(500).json({error:e.message}); }
});

// ── Exam Predictions — linear regression per student ─────────
app.get('/api/exam-predictions', async (req, res) => {
  try{
    const rows = await q('SELECT student, score, total, created_at FROM sessions ORDER BY created_at ASC LIMIT 2000');
    const students={};
    rows.forEach(r=>{
      if(!students[r.student]) students[r.student]=[];
      students[r.student].push(r.total>0?Math.round(r.score/r.total*100):0);
    });
    const predictions=Object.entries(students).map(([name,scores])=>{
      const n=scores.length;
      if(n<2) return {name,predicted:scores[0]||0,trend:0,confidence:'LOW'};
      // Linear regression
      const sumX=scores.reduce((_,__,i)=>_+i,0), sumY=scores.reduce((a,b)=>a+b,0);
      const sumXY=scores.reduce((a,s,i)=>a+i*s,0), sumXX=scores.reduce((a,_,i)=>a+i*i,0);
      const slope=(n*sumXY-sumX*sumY)/(n*sumXX-sumX*sumX)||0;
      const intercept=(sumY-slope*sumX)/n;
      const predicted=Math.max(0,Math.min(100,Math.round(intercept+slope*n)));
      const avg=scores.reduce((a,b)=>a+b,0)/n;
      const variance=scores.reduce((a,b)=>a+Math.pow(b-avg,2),0)/n;
      const se=Math.round(Math.sqrt(variance/n)*10)/10;
      return {name,predicted,slope:Math.round(slope*10)/10,sessions:n,se,
        trend:slope>2?'↑ Improving':slope<-2?'↓ Declining':'→ Stable',
        confidence:se<10?'HIGH':se<20?'MEDIUM':'LOW'};
    }).sort((a,b)=>a.predicted-b.predicted);
    res.json(predictions);
  }catch(e){ console.error('[exam-predictions]',e.message); res.status(500).json({error:e.message}); }
});

app.delete('/api/sessions/duplicates', async (req, res) => {
  try {
    // Keep only the lowest ID for each student+subject+score+total+answers combo
    const result = await q(`
      DELETE s1 FROM sessions s1
      INNER JOIN sessions s2
      ON s1.student = s2.student
      AND s1.subject = s2.subject
      AND s1.score = s2.score
      AND s1.total = s2.total
      AND CAST(s1.answers AS CHAR) = CAST(s2.answers AS CHAR)
      AND s1.id > s2.id
    `);
    broadcast({ type: 'sessions-cleared' });
    res.json({ success: true, deleted: result.affectedRows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
