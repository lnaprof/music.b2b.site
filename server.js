/* ============================================================
   SOUNDPIPE — B2B audio production landing
   Backend: serves the landing + accepts leads, saves files,
   notifies by e-mail and Telegram.
   Run:  npm install && npm start
   ============================================================ */
require("dotenv").config();
const path = require("path");
const fs = require("fs");
const express = require("express");
const multer = require("multer");
const nodemailer = require("nodemailer");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const DATA_DIR = path.join(__dirname, "data");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR));

/* ---------- file upload ---------- */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, "");
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (req, file, cb) => {
    const ok = /\.(wav|mp3|m4a|aac|aiff|aif|ogg|flac|wma)$/i.test(file.originalname);
    if (ok) cb(null, true);
    else cb(new Error("Unsupported file type (use WAV/MP3/M4A/AAC/AIFF/OGG/FLAC)"));
  },
});

/* ---------- helpers ---------- */
function sanitize(s) { return String(s || "").slice(0, 1000); }

function saveLead(lead) {
  const file = path.join(DATA_DIR, "leads.json");
  let arr = [];
  if (fs.existsSync(file)) {
    try { arr = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { arr = []; }
  }
  if (!Array.isArray(arr)) arr = [];
  arr.push(lead);
  fs.writeFileSync(file, JSON.stringify(arr, null, 2));
}

function leadText(lead) {
  const lines = [
    `Заявка: ${lead.type}`,
    `Имя: ${lead.name}`,
    `Компания: ${lead.company || "-"}`,
    `E-mail: ${lead.email}`,
    `Источник: ${lead.source}`,
  ];
  if (lead.message) lines.push(`Задача: ${lead.message}`);
  if (lead.file && lead.file.name) lines.push(`Файл: ${lead.file.name} (${lead.file.size || 0} bytes)`);
  if (lead.receivedAt) lines.push(`Получена: ${lead.receivedAt}`);
  return lines.join("\n");
}

/* ---------- e-mail (optional: set SMTP_* in .env) ---------- */
const transporter = (() => {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
})();

async function sendEmail(lead) {
  if (!transporter || !process.env.EMAIL_TO) {
    console.log("[EMAIL] skipped (SMTP not configured)");
    return;
  }
  const mail = {
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: process.env.EMAIL_TO,
    subject: `SOUNDPIPE | ${lead.type} — ${lead.name}`,
    text: leadText(lead),
  };
  if (lead.file && lead.file.path) {
    mail.attachments = [{ filename: lead.file.name, path: lead.file.path }];
  }
  await transporter.sendMail(mail);
  console.log("[EMAIL] sent to", process.env.EMAIL_TO);
}

/* ---------- Telegram (optional: set TELEGRAM_* in .env) ---------- */
async function sendTelegram(lead) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log("[TELEGRAM] skipped (bot token / chat id not configured)");
    return;
  }
  const api = `https://api.telegram.org/bot${token}`;
  await fetch(`${api}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: leadText(lead) }),
  });
  if (lead.file && lead.file.path) {
    const buf = fs.readFileSync(lead.file.path);
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("caption", `${lead.type} — ${lead.name}`);
    form.append("document", new Blob([buf], { type: "audio/wav" }), lead.file.name);
    await fetch(`${api}/sendDocument`, { method: "POST", body: form });
  }
  console.log("[TELEGRAM] sent");
}

/* ---------- lead pipeline ---------- */
async function processLead(lead) {
  lead.receivedAt = new Date().toISOString();
  saveLead(lead);
  console.log("\n[LEAD] New request:\n" + leadText(lead));
  try { await sendEmail(lead); } catch (e) { console.error("[EMAIL] error:", e.message); }
  try { await sendTelegram(lead); } catch (e) { console.error("[TELEGRAM] error:", e.message); }
}

/* ---------- routes ---------- */
app.post("/api/lead/test", upload.single("audio"), async (req, res) => {
  const { name, company, email, agree, message } = req.body;
  if (!name || !email) {
    return res.status(400).json({ ok: false, message: "Name and email are required" });
  }
  if (!(agree === "1" || agree === true)) {
    return res.status(400).json({ ok: false, message: "Consent is required" });
  }
  const lead = {
    type: "Бесплатный тестовый мастеринг",
    source: sanitize(req.body.source || "test-track"),
    name: sanitize(name),
    company: sanitize(company),
    email: sanitize(email),
    message: sanitize(message),
  };
  if (req.file) {
    lead.file = {
      name: sanitize(req.file.originalname),
      size: req.file.size,
      storedAs: req.file.filename,
      path: req.file.path,
    };
  } else if (req.body.fileName) {
    lead.file = { name: sanitize(req.body.fileName), size: Number(req.body.fileSize) || 0, path: null };
  }
  await processLead(lead);
  res.json({ ok: true, message: "Lead accepted" });
});

app.post("/api/lead/b2b", async (req, res) => {
  const { name, company, email, message } = req.body;
  if (!name || !email || !company) {
    return res.status(400).json({ ok: false, message: "Name, company and email are required" });
  }
  const lead = {
    type: "Запрос B2B-сметы",
    source: sanitize(req.body.source || "b2b-quote"),
    name: sanitize(name),
    company: sanitize(company),
    email: sanitize(email),
    message: sanitize(message),
  };
  await processLead(lead);
  res.json({ ok: true, message: "Lead accepted" });
});

app.use("/api", (req, res) => res.status(404).json({ ok: false, message: "Not found" }));

/* ---------- error handling (multer etc.) ---------- */
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      ok: false,
      message: err.code === "LIMIT_FILE_SIZE" ? "File too large (max 50 MB)" : "Upload error: " + err.code,
    });
  }
  if (err) return res.status(400).json({ ok: false, message: err.message });
  next();
});

app.listen(PORT, () => {
  console.log("");
  console.log("SOUNDPIPE landing ready:");
  console.log("  Site:   http://localhost:" + PORT);
  console.log("  Uploads: " + UPLOAD_DIR);
  console.log("  Leads:  " + path.join(DATA_DIR, "leads.json"));
  if (!process.env.SMTP_HOST) console.log("  E-mail: disabled — set SMTP_* in .env");
  if (!process.env.TELEGRAM_BOT_TOKEN) console.log("  Telegram: disabled — set TELEGRAM_* in .env");
});