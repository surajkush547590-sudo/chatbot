// index.js
const wppconnect = require('@wppconnect-team/wppconnect');
const fs = require('fs');
const path = require('path');

// --------- CONFIG ---------
const SESSION_NAME = 'my-whatsapp-bot';
const ADMIN_NUMBER = '91XXXXXXXXXX@c.us'; // <-- CHANGE THIS
const SESSIONS_FILE = './sessions.json';
const LEADS_CSV = './leads.csv';

// Ensure session file exists
if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, JSON.stringify({}), 'utf8');

// ===== CSV Helpers (No dependency) =====
function ensureCsvHeader() {
  if (!fs.existsSync(LEADS_CSV)) {
    fs.writeFileSync(LEADS_CSV, `"timestamp","chatId","name","flow","data"\n`);
  }
}
function appendCsvRow(arr) {
  const safe = arr.map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',') + "\n";
  fs.appendFileSync(LEADS_CSV, safe);
}
ensureCsvHeader();

// Load/Save sessions
function loadSessions() {
  try { return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')); }
  catch { return {}; }
}
function saveSessions(s) {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(s, null, 2));
}

// Get user display name
function getSenderName(msg) {
  return (msg.sender?.pushname || msg.sender?.formattedName || msg.notifyName || "User");
}

// ------- MAIN MENU -------
const MAIN_MENU = `Welcome to Immigration Help 👋
Please choose an option by typing the number:

1️⃣ Canada PR  
2️⃣ Student Visa  
3️⃣ Work Permit  
4️⃣ Tourist Visa  
5️⃣ Business / Startup Visa  
6️⃣ Eligibility Check  
7️⃣ Talk to an Expert (Human Support)

Type *menu* anytime to see this menu again.
Type *restart* to restart the conversation.`;

// -------- GREETING IMAGE SUPPORT --------
const WELCOME_IMAGE = path.join(__dirname, "assets", "welcome.jpg");

async function sendGreetingWithImage(client, chatId, name) {
  try {
    if (fs.existsSync(WELCOME_IMAGE)) {
      await client.sendFile(
        chatId,
        WELCOME_IMAGE,
        "welcome.jpg",
        `Hello ${name}! 👋\n\n${MAIN_MENU}`
      );
      return;
    }
  } catch (e) {
    console.error("Greeting image send failed:", e);
  }
  await client.sendText(chatId, `Hello ${name}! 👋\n\n${MAIN_MENU}`);
}

// ------- Eligibility logic -------
function evaluateEligibility(data) {
  let score = 0;
  if (data.age >= 18 && data.age <= 45) score += 2;
  if (data.education) {
    const e = data.education.toLowerCase();
    if (e.includes("master") || e.includes("bachelor") || e.includes("phd")) score += 2;
  }
  if (data.experience >= 2) score += 2;
  if (data.ielts >= 6) score += 2;
  if (data.country && data.country.toLowerCase() !== "india") score += 1;

  return score >= 7 ? { result: "High chance", score }
       : score >= 4 ? { result: "Possible", score }
       : { result: "Low chance", score };
}

// -------- PERSONAL DETAILS FLOW ------
const PERSONAL_FIELDS = ["name","phone","email","age","city","country","education","experience"];
const PERSONAL_QUESTIONS = {
  name: "Please share your *full name*:",
  phone: "Send your *phone number* with country code:",
  email: "Enter your *email address* (or type N/A):",
  age: "What is your *age*?",
  city: "Which *city* are you in?",
  country: "Which *country* are you living in?",
  education: "Your *highest education*?",
  experience: "Your *work experience* (in years)?"
};

function initPersonal(session) {
  if (!session.personal) session.personal = {};
  if (session.personalIndex === undefined) session.personalIndex = 0;
}

function validatePersonal(field, value) {
  value = value.trim();

  if (field === "phone") {
    const d = value.replace(/\D/g, "");
    if (d.length < 8) return { ok: false, msg: "Invalid phone. Send again with country code." };
    return { ok: true, val: d };
  }

  if (field === "email") {
    if (value.toLowerCase() === "n/a") return { ok: true, val: "" };
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return { ok: true, val: value };
    return { ok: false, msg: "Invalid email. Send again or type N/A." };
  }

  if (["age","experience"].includes(field)) {
    const n = Number(value);
    if (isNaN(n) || n < 0) return { ok: false, msg: `Please send a valid number for ${field}.` };
    return { ok: true, val: n };
  }

  if (!value) return { ok: false, msg: `Please enter your ${field}.` };
  return { ok: true, val: value };
}

async function runPersonalFlow(client, msg, session, sessions, text) {
  const chatId = msg.from;
  initPersonal(session);

  const i = session.personalIndex;
  if (i >= PERSONAL_FIELDS.length) return true;

  const field = PERSONAL_FIELDS[i];
  const validation = validatePersonal(field, text);

  if (!validation.ok) {
    await client.sendText(chatId, validation.msg);
    return false;
  }

  session.personal[field] = validation.val;
  session.personalIndex++;

  saveSessions(sessions);

  if (session.personalIndex >= PERSONAL_FIELDS.length) return true;

  const nextField = PERSONAL_FIELDS[session.personalIndex];
  await client.sendText(chatId, PERSONAL_QUESTIONS[nextField]);
  return false;
}

// PERSONAL SUMMARY
function personalSummary(p) {
  return `Name: ${p.name}
Phone: ${p.phone}
Email: ${p.email}
Age: ${p.age}
City: ${p.city}
Country: ${p.country}
Education: ${p.education}
Experience: ${p.experience} years`;
}

// ---------- Start WPPConnect ----------
// NOTE: executablePath points to snap chromium binary for WSL.
// We use puppeteerOptions to pass args that work well in WSL headless mode.
wppconnect.create({
  session: SESSION_NAME,
  // run headless so it works on WSL without GUI
  headless: true,
  // explicit chromium path (snap) — this matches your system
  executablePath: '/snap/bin/chromium',
  puppeteerOptions: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--single-process",
      "--no-zygote",
      "--no-first-run"
    ]
  },
  browserWS: false // ensure wppconnect doesn't attempt a remote ws by default
})
.then(client => start(client))
.catch(err => console.error("Create client error", err));

function start(client) {
  console.log("🚀 WhatsApp Immigration Bot is running...");

  client.onMessage(async (msg) => {
    try {
      if (msg.isGroupMsg) return;

      const sessions = loadSessions();
      const chatId = msg.from;

      if (!sessions[chatId]) {
        sessions[chatId] = {
          flow: null,
          step: null,
          data: {},
          personal: {},
          personalIndex: 0,
          greeted: false
        };
      }
      const session = sessions[chatId];
      const text = String(msg.body || "").trim();

      // ===== AUTO GREETING WITH IMAGE =====
      if (!session.greeted) {
        session.greeted = true;
        saveSessions(sessions);
        await sendGreetingWithImage(client, chatId, getSenderName(msg));
        return;
      }

      // hi/hello greeting
      if (/^(hi|hello|hey)$/i.test(text)) {
        await sendGreetingWithImage(client, chatId, getSenderName(msg));
        return;
      }

      // Commands
      if (text.toLowerCase() === "menu") {
        session.flow = null; session.step = null;
        session.personal = {}; session.personalIndex = 0;
        saveSessions(sessions);
        return client.sendText(chatId, MAIN_MENU);
      }

      if (text.toLowerCase() === "restart") {
        sessions[chatId] = {
          flow: null, step: null,
          data: {}, personal: {}, personalIndex: 0, greeted: true
        };
        saveSessions(sessions);
        return client.sendText(chatId, "Conversation restarted.\n\n" + MAIN_MENU);
      }

      // ----- If no flow selected -----
      if (!session.flow) {
        if (["1","2","3","4","5","6","7"].includes(text)) {
          session.flow = {
            "1":"CANADA_PR",
            "2":"STUDENT_VISA",
            "3":"WORK_PERMIT",
            "4":"TOURIST_VISA",
            "5":"BUSINESS_VISA",
            "6":"ELIGIBILITY",
            "7":"HANDOFF"
          }[text];

          session.step = "collect_personal";
          session.personal = {};
          session.personalIndex = 0;
          saveSessions(sessions);

          await client.sendText(chatId, PERSONAL_QUESTIONS["name"]);
          return;
        }

        return client.sendText(chatId, "I didn't understand.\n\n" + MAIN_MENU);
      }

      // ----- PERSONAL DETAILS FLOW FIRST -----
      if (session.step === "collect_pe_
