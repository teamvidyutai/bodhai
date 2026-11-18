# BodhAI — On-Device AI for Learning Gap Detection

> **Wadhwani AI × Google.org Hackathon — Phase 2** | Problem 2.4: Learning Gaps & Timely Feedback
> Version 2.1 · June 2026

---

## What It Does

A teacher writes **`BODH-XXXXXXXX`** on the blackboard (or shares a QR code). Up to 40 students open BodhAI on any phone — no internet required. Each takes an AI-scored quiz in their mother tongue. **TinyBERT runs entirely on-device** (WebAssembly, 22MB) — no server, no API calls, no cost.

Results sync automatically to MySQL when online. The teacher dashboard shows a real-time **Gap Map**, **AI Learning Insights**, **Knowledge State predictions**, a **Spaced Review Calendar**, **Peer Learning pairs**, and one-click **WhatsApp Parent Reports** — all generated from the same quiz data, zero extra work.

**Offline-first. Zero infrastructure. Zero cost. Scales to 60 lakh students.**

---

## Live Demo

| | URL |
|---|---|
| Teacher Dashboard | `https://bodhai.up.railway.app/BodhAI_Teacher.html` |
| Student Quiz | `https://bodhai.up.railway.app/BodhAI_Student.html` |
| Admin Panel | `https://bodhai.up.railway.app/BodhAI_Admin.html` |
| API Health | `https://bodhai.up.railway.app/api/health` |

---

## Repository Structure

```
BodhAI/
├── BodhAI_Student.html          # Student quiz app (offline-first, TinyBERT AI)
├── BodhAI_Teacher.html          # Teacher dashboard (11 sections, AI insights)
├── BodhAI_Admin.html            # School admin — MySQL viewer, CSV export
├── README.md
└── backend/
    ├── server.js                # Express + WebSocket + MySQL
    ├── schema.sql                # Database schema (4 tables)
    ├── setup.js                  # One-command DB setup
    ├── package.json
    ├── railway.json              # Railway deploy config
    ├── Procfile                  # Render/Heroku config
    ├── .env.example
    ├── start_windows.bat
    └── public/                   # Served by Express (copy of all HTML files)
```
---

## Quick Start — Offline Mode (Zero Setup)

1. Download `BodhAI_Student.html` and `BodhAI_Teacher.html`
2. Open **both in Google Chrome** (same browser — two tabs, or two devices on same browser profile)
3. Teacher tab: a session code (e.g. `BODH-K7YMHH32`) appears in the sidebar — write it on the board
4. Student tab: enter the code, pick language, take the quiz
5. Teacher dashboard updates within 2 seconds via BroadcastChannel — **no server needed**

> Offline mode uses the browser's IndexedDB for storage and BroadcastChannel/polling for sync between tabs. Works with zero internet, zero installation.

---

## Full Setup — Online Mode with MySQL (Windows, Local Network)

### Prerequisites
- [Node.js v18+](https://nodejs.org) (LTS)
- [XAMPP](https://apachefriends.org) (for local MySQL) — or use a cloud MySQL 

### Steps

```bash
# 1. Start XAMPP → start MySQL from the Control Panel

# 2. Open the backend folder
cd backend/

# 3. Create your config file
copy .env.example .env
# Edit .env — for XAMPP default, leave DB_PASS blank

# 4. Install dependencies
npm install

# 5. Start the server — database tables are created automatically on first run
node server.js
```

### Access Locally

| URL | Purpose |
|---|---|
| `http://localhost:3000/BodhAI_Teacher.html` | Teacher dashboard |
| `http://localhost:3000/BodhAI_Student.html` | Student quiz |
| `http://localhost:3000/BodhAI_Admin.html` | Admin panel |
| `http://localhost:3000/api/health` | Health check — confirms MySQL connection |

### Classroom Mode (Students on Same WiFi)

```bash
# Find your laptop's local IP
ipconfig          # Windows
ifconfig          # Linux/Mac
# Look for IPv4 Address, e.g. 192.168.1.105
```

Students open: `http://192.168.1.105:3000/BodhAI_Student.html`

**Faster onboarding:** Teacher clicks **"📱 Share Student Link"** in the sidebar — generates a QR code and URL with the session code embedded:
```
http://192.168.1.105:3000/BodhAI_Student.html?code=BODH-K7YMHH32
```
Students scan the QR → session code auto-fills → no typing needed.

---


## Environment Variables (`.env`)

```env
# Local MySQL (XAMPP defaults)
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASS=
DB_NAME=bodhai
SERVER_PORT=3000

# Cloud MySQL — set DB_SSL=true if your provider requires SSL (e.g. Aiven)
# DB_SSL=true

# Alternative: single connection string (Railway/Render provide this automatically)
# DATABASE_URL=mysql://user:pass@host:port/dbname
```

---

## Database Schema

| Table | Purpose | Written By |
|---|---|---|
| `sessions` | Quiz results: scores, answers, concept maps, flags | Student (direct online) + Teacher (Force Sync) |
| `custom_banks` | Teacher-created custom subject question banks | Teacher Quiz Creator |
| `session_codes` | Classroom session codes (for segregating classes) | Teacher dashboard |
| `sync_queue` | Audit log of offline → online sync events | Server, on `/api/sync` |

Full schema: `backend/schema.sql`. Tables are also auto-created on server startup via `ensureSchema()`.

---

- **100% offline-capable**: every component above works without the Node.js box
- **Online adds**: cross-device sync, live classroom mode, admin panel, parent WhatsApp reports, historical analytics

---

## AI / ML Details

| | |
|---|---|
| **Model** | `all-MiniLM-L6-v2` (TinyBERT family) |
| **Runtime** | ONNX + WebAssembly — runs in-browser, no GPU |
| **Task** | Semantic similarity — matches spoken answer to MCQ option |
| **Size** | 22MB (cached after first load, then fully offline) |
| **Latency** | ~142ms on mid-range Android |
| **F1 Score** | 89.4% (Precision 91.3%, Recall 87.6%) on 400-sample NCERT test set |
| **Confidence threshold** | 0.62 — below this, student confirms manually (no false auto-grading) |

Teacher-side AI (Knowledge State, Spaced Review, Peer Matching) is **pure JavaScript math** — Bayesian weighted inference, Ebbinghaus forgetting curve, and graph matching. **0MB, no model needed.** Full details in `BodhAI_NewFeatures_TechDoc.html`.

---

## Teacher Dashboard — Feature Map

| Section | What It Shows |
|---|---|
| Overview | Class KPIs, score distribution, concept health |
| AI Insights | 10 auto-generated insights with per-student tables and remediation |
| Gap Map | Concept × student matrix, filterable by subject |
| Student Progress | Individual student trajectory across sessions |
| Subject Analysis | Per-subject performance, weakest concepts |
| Class Performance | Bar charts, fast-answer flags |
| **Live Classroom** | Real-time results as students submit (WebSocket + 5s polling) |
| **Knowledge State** | Bayesian P(knows concept) per student, exam prediction |
| **Review Calendar** | Ebbinghaus-based spaced repetition schedule |
| **Peer Learning** | AI-matched tutor/learner pairs by relative concept strength |
| **Parent Reports** | One-click WhatsApp messages in Hindi/English/Bengali |
| Marksheet | Full gradebook, CSV export |
| Feedback Log | Per-question feedback view |
| Quiz Creator | Add custom subjects/questions, syncs to MySQL |

---

## Supported Languages

Hindi · English · Bengali · Tamil · Telugu · Marathi

---

## Data Privacy & DPDP Act 2023 Compliance

- Only name + roll number collected — no phone, email, or location
- Voice audio processed in RAM and **never stored**
- Offline data stays in the student's own browser (IndexedDB)
- Online data stays on the teacher's own MySQL server — no third-party servers involved
- Teacher can clear all data with one click (Admin Panel)

---

## Troubleshooting

| Issue | Fix |
|---|---|
| Teacher shows "Offline Mode" | Check `node server.js` is running; restart browser tab |
| Student shows "Offline" on phone | Don't use `localhost` — use laptop's local IP (e.g. `192.168.1.105`) |
| Duplicate rows in MySQL | Click **✂ Dedup** button in teacher top bar |
| `custom_banks` / `session_codes` empty | Generate a new session code or add a custom question once — auto-syncs |
| Live updates not appearing | 5-second polling auto-refreshes; or click **↻ Refresh** |

---

## License

All intellectual property belongs to the BodhAI team. Code shared with the evaluation team for assessment purposes only.

---

**Built for Wadhwani AI × Google.org Hackathon — Problem 2.4: Learning Gaps & Timely Feedback**
