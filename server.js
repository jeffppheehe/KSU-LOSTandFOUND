const express = require("express");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const multer = require("multer");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(express.static(path.join(__dirname, "public")));

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname || "");
    cb(null, unique + ext);
  }
});
const upload = multer({ storage });

// Initialize SQLite DB
const db = new sqlite3.Database(path.join(__dirname, "lostfound.db"));

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'user' -- 'user' or 'admin'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS lost_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    item_name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    date_lost TEXT,
    location TEXT,
    photo_url TEXT,
    status TEXT DEFAULT 'open', -- open, matched, returned, closed
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS found_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    item_name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    date_found TEXT,
    location TEXT,
    photo_url TEXT,
    status TEXT DEFAULT 'open',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claimer_id INTEGER NOT NULL,
    lost_item_id INTEGER,
    found_item_id INTEGER,
    proof_text TEXT,
    proof_photo_url TEXT,
    status TEXT DEFAULT 'pending', -- pending, approved, rejected
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(claimer_id) REFERENCES users(id),
    FOREIGN KEY(lost_item_id) REFERENCES lost_items(id),
    FOREIGN KEY(found_item_id) REFERENCES found_items(id)
  )`);

  // Seed an admin if none exists
  db.get("SELECT COUNT(*) as c FROM users WHERE role='admin'", (err, row) => {
    if (err) return console.error(err);
    if (row.c === 0) {
      const password_hash = bcrypt.hashSync("admin123", 10);
      db.run("INSERT INTO users (student_id, name, email, password_hash, role) VALUES (?,?,?,?,?)",
        ["A0000", "Admin User", "admin@example.com", password_hash, "admin"]);
      console.log("Seeded default admin: admin@example.com / admin123");
    }
  });
});

// -------------- Helpers --------------
function normalizeText(t = "") {
  return (t || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function tokenize(t = "") {
  const stop = new Set(["the","a","an","and","or","of","for","to","with","on","in","at","is","it","this","that"]);
  return normalizeText(t).split(" ").filter(w => w && !stop.has(w));
}
function keywordScore(a = "", b = "") {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  const denom = Math.max(1, sa.size, sb.size);
  return inter / denom;
}
function dateProximityScore(dateA, dateB) {
  if (!dateA || !dateB) return 0;
  try {
    const da = new Date(dateA);
    const dbb = new Date(dateB);
    const diffDays = Math.abs((dbb - da) / (1000*60*60*24));
    return diffDays <= 7 ? 1 - (diffDays / 7) : 0;
  } catch { return 0; }
}
function locationScore(locA, locB) {
  if (!locA || !locB) return 0;
  return normalizeText(locA) === normalizeText(locB) ? 1 : keywordScore(locA, locB);
}
function simpleMatchScore(lost, found) {
  let score = 0;
  if (lost.category && found.category && normalizeText(lost.category) === normalizeText(found.category)) {
    score += 0.3;
  }
  score += 0.4 * keywordScore(`${lost.item_name} ${lost.description}`, `${found.item_name} ${found.description}`);
  score += 0.2 * locationScore(lost.location, found.location);
  score += 0.1 * dateProximityScore(lost.date_lost, found.date_found);
  return Math.min(1, Math.max(0, score));
}

// -------------- Auth --------------
app.post("/api/register", (req, res) => {
  const { student_id, name, email, password } = req.body;
  if (!student_id || !name || !email || !password) return res.status(400).json({ error: "Missing fields" });
  const password_hash = bcrypt.hashSync(password, 10);
  db.run("INSERT INTO users (student_id, name, email, password_hash) VALUES (?,?,?,?)",
    [student_id, name, email, password_hash],
    function(err) {
      if (err) return res.status(400).json({ error: err.message });
      res.json({ id: this.lastID, student_id, name, email, role: "user" });
    });
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Missing fields" });
  db.get("SELECT * FROM users WHERE email=?", [email], (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });
    const ok = bcrypt.compareSync(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });
    res.json({ id: user.id, student_id: user.student_id, name: user.name, email: user.email, role: user.role });
  });
});

// -------------- Lost Items --------------
app.post("/api/lost", upload.single("photo"), (req, res) => {
  const { user_id, item_name, description, category, date_lost, location } = req.body;
  const photo_url = req.file ? `/uploads/${req.file.filename}` : null;
  if (!user_id || !item_name) return res.status(400).json({ error: "Missing fields" });
  db.run(`INSERT INTO lost_items (user_id, item_name, description, category, date_lost, location, photo_url) 
          VALUES (?,?,?,?,?,?,?)`,
    [user_id, item_name, description, category, date_lost, location, photo_url],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      // Attempt simple matching against all found items
      db.all("SELECT * FROM found_items WHERE status='open'", (err2, founds) => {
        if (err2) return res.json({ id: this.lastID, photo_url, matches: [] });
        const matches = (founds || []).map(f => ({ 
          item: f, 
          score: simpleMatchScore({ item_name, description, category, date_lost, location }, f)
        })).filter(m => m.score >= 0.45).sort((a,b)=>b.score-a.score);
        res.json({ id: this.lastID, photo_url, matches });
      });
    });
});

app.get("/api/lost", (req, res) => {
  const { q, category, location, status } = req.query;
  let sql = "SELECT * FROM lost_items WHERE 1=1";
  const params = [];
  if (category) { sql += " AND category=?"; params.push(category); }
  if (location) { sql += " AND location LIKE ?"; params.push(`%${location}%`); }
  if (status) { sql += " AND status=?"; params.push(status); }
  if (q) { sql += " AND (item_name LIKE ? OR description LIKE ?)"; params.push(`%${q}%`, `%${q}%`); }
  sql += " ORDER BY created_at DESC";
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// -------------- Found Items --------------
app.post("/api/found", upload.single("photo"), (req, res) => {
  const { user_id, item_name, description, category, date_found, location } = req.body;
  const photo_url = req.file ? `/uploads/${req.file.filename}` : null;
  if (!user_id || !item_name) return res.status(400).json({ error: "Missing fields" });
  db.run(`INSERT INTO found_items (user_id, item_name, description, category, date_found, location, photo_url) 
          VALUES (?,?,?,?,?,?,?)`,
    [user_id, item_name, description, category, date_found, location, photo_url],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      // Attempt simple matching against all lost items
      db.all("SELECT * FROM lost_items WHERE status='open'", (err2, losts) => {
        if (err2) return res.json({ id: this.lastID, photo_url, matches: [] });
        const matches = (losts || []).map(l => ({ 
          item: l, 
          score: simpleMatchScore(l, { item_name, description, category, date_found, location })
        })).filter(m => m.score >= 0.45).sort((a,b)=>b.score-a.score);
        res.json({ id: this.lastID, photo_url, matches });
      });
    });
});

app.get("/api/found", (req, res) => {
  const { q, category, location, status } = req.query;
  let sql = "SELECT * FROM found_items WHERE 1=1";
  const params = [];
  if (category) { sql += " AND category=?"; params.push(category); }
  if (location) { sql += " AND location LIKE ?"; params.push(`%${location}%`); }
  if (status) { sql += " AND status=?"; params.push(status); }
  if (q) { sql += " AND (item_name LIKE ? OR description LIKE ?)"; params.push(`%${q}%`, `%${q}%`); }
  sql += " ORDER BY created_at DESC";
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// -------------- Claims --------------
app.post("/api/claims", upload.single("proof_photo"), (req, res) => {
  const { claimer_id, lost_item_id, found_item_id, proof_text } = req.body;
  if (!claimer_id) return res.status(400).json({ error: "Missing claimer_id" });
  const proof_photo_url = req.file ? `/uploads/${req.file.filename}` : null;
  db.run(`INSERT INTO claims (claimer_id, lost_item_id, found_item_id, proof_text, proof_photo_url) VALUES (?,?,?,?,?)`,
    [claimer_id, lost_item_id || null, found_item_id || null, proof_text || null, proof_photo_url],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, status: "pending" });
    });
});

app.get("/api/claims", (req, res) => {
  const { status } = req.query;
  let sql = `SELECT c.*, u.name as claimer_name 
             FROM claims c JOIN users u ON u.id=c.claimer_id WHERE 1=1`;
  const params = [];
  if (status) { sql += " AND c.status=?"; params.push(status); }
  sql += " ORDER BY c.created_at DESC";
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// -------------- Admin actions --------------
app.post("/api/admin/claims/:id/approve", (req, res) => {
  const id = req.params.id;
  db.get("SELECT * FROM claims WHERE id=?", [id], (err, claim) => {
    if (err || !claim) return res.status(404).json({ error: "Claim not found" });
    db.run("UPDATE claims SET status='approved' WHERE id=?", [id], (err2) => {
      if (err2) return res.status(500).json({ error: err2.message });
      // Mark related item status as returned
      if (claim.lost_item_id) db.run("UPDATE lost_items SET status='returned' WHERE id=?", [claim.lost_item_id]);
      if (claim.found_item_id) db.run("UPDATE found_items SET status='returned' WHERE id=?", [claim.found_item_id]);
      res.json({ id, status: "approved" });
    });
  });
});

app.post("/api/admin/claims/:id/reject", (req, res) => {
  const id = req.params.id;
  db.run("UPDATE claims SET status='rejected' WHERE id=?", [id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id, status: "rejected" });
  });
});

app.get("/api/admin/stats", (req, res) => {
  const result = {};
  db.serialize(() => {
    db.get("SELECT COUNT(*) as c FROM users", (_, row)=> result.users = row.c);
    db.get("SELECT COUNT(*) as c FROM lost_items", (_, row)=> result.lost = row.c);
    db.get("SELECT COUNT(*) as c FROM found_items", (_, row)=> result.found = row.c);
    db.get("SELECT COUNT(*) as c FROM claims", (_, row)=> {
      result.claims = row.c;
      res.json(result);
    });
  });
});

// Fallback to index.html for front-end
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
