const express = require("express");
const axios = require("axios");
const path = require("path");
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

let currentTicket = 1;
let currentNumber = 0;
let ticketLog = [];
let isTicketingClosed = false;
let resetFlag = false;

const LINE_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply";

app.post("/webhook", async (req, res) => {
  const events = req.body.events;
  if (!events || events.length === 0) return res.status(200).send("No events");
  const event = events[0];
  const replyToken = event.replyToken;
  const userId = event.source.userId;
  const lastTicket = ticketLog.slice().reverse().find(t => !t.userId);
  if (lastTicket) lastTicket.userId = userId;
  try {
    await axios.post(LINE_REPLY_URL, {
      replyToken,
      messages: [
        {
          type: "text",
          text: `整理券はこちらから発行できます：\nhttps://.../ticket.html`,
        },
      ],
    }, {
      headers: { Authorization: `Bearer ${LINE_ACCESS_TOKEN}` },
    });
    res.status(200).send("OK");
  } catch (err) {
    console.error("LINE送信失敗:", err.response?.data || err.message);
    res.status(500).send("Error");
  }
});

app.post("/api/ticket", (req, res) => {
  if (isTicketingClosed) {
    return res.status(403).json({ message: "本日の新規整理券の発行は終了しました。" });
  }
  const { userId } = req.body;
  const ticketNumber = currentTicket++;
  ticketLog.push({
    number: ticketNumber,
    timestamp: Date.now(),
    userId: userId || null,
    completed: false,
    limitUnlocked: false,
    actualMinutes: 4, // デフォルト4分を追加
  });
  res.json({ number: ticketNumber });
});

app.get("/api/number", (req, res) => {
  res.json({ number: currentNumber });
});

app.post("/api/call", (req, res) => {
  const diff = typeof req.body.diff === "number" ? req.body.diff : 1;
  currentNumber = Math.max(0, currentNumber + diff);
  res.json({ message: `番号 ${currentNumber} を呼び出しました。` });
});

app.post("/api/set", (req, res) => {
  const { number } = req.body;
  if (typeof number !== "number" || number < 0) {
    return res.status(400).json({ message: "無効な番号です。" });
  }
  currentNumber = number;
  res.json({ message: `呼び出し番号を ${currentNumber} に設定しました。` });
});

app.get("/api/ticket/last", (req, res) => {
  res.json({ last: currentTicket - 1 });
});

app.get("/api/ticket/log", (req, res) => {
  res.json(ticketLog);
});

// ← ここから追加のAPI ↓

// /api/time-data で番号ごとの所要時間を返す
app.get("/api/time-data", (req, res) => {
  const timeData = ticketLog.map(t => ({
    number: t.number,
    actualMinutes: t.actualMinutes || 4,
  }));
  res.json(timeData);
});

// 所要時間更新用API（管理用。使わなくてもよい）
app.post("/api/time-data/update", (req, res) => {
  const { number, actualMinutes } = req.body;
  const entry = ticketLog.find(t => t.number === number);
  if (!entry) return res.status(404).json({ message: "整理券が見つかりません。" });
  if (typeof actualMinutes !== "number" || actualMinutes <= 0) {
    return res.status(400).json({ message: "無効な所要時間です。" });
  }
  entry.actualMinutes = actualMinutes;
  res.json({ message: "所要時間を更新しました。" });
});

// ← ここまで追加API ↑


app.post("/api/notify", async (req, res) => {
  const { number, message } = req.body;
  if (typeof number !== "number" || number <= 0) {
    return res.status(400).json({ message: "無効な整理券番号です。" });
  }
  const entry = ticketLog.find(t => t.number === number);
  if (!entry?.userId) {
    return res.status(404).json({ message: `整理券番号 ${number} のユーザー情報が見つかりません。` });
  }
  try {
    await axios.post(LINE_PUSH_URL, {
      to: entry.userId,
      messages: [
        {
          type: "text",
          text: message || `【手動通知】整理券番号 ${number} の方、まもなく順番です。`,
        },
      ],
    }, {
      headers: { Authorization: `Bearer ${LINE_ACCESS_TOKEN}` },
    });
    res.json({ message: `番号 ${number} に通知を送信しました。` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "通知送信に失敗しました。" });
  }
});

app.post("/api/complete", (req, res) => {
  const { userId, ticketNumber } = req.body;
  const entry = ticketLog.find(t => t.number === ticketNumber && t.userId === userId);
  if (!entry) {
    return res.status(404).json({ success: false, message: "該当整理券が見つかりません。" });
  }
  entry.completed = true;
  res.json({ success: true });
});

app.post("/api/unlock-limit", (req, res) => {
  const { number } = req.body;
  const entry = ticketLog.find(t => t.number === number);
  if (!entry) {
    return res.status(404).json({ success: false, message: "整理券が見つかりません。" });
  }
  if (entry.limitUnlocked) {
    return res.status(400).json({ success: false, message: "すでに解除済みです。" });
  }
  entry.limitUnlocked = true;
  res.json({ success: true });
});

app.post("/api/check-unlock", (req, res) => {
  const { userId } = req.body;
  const entry = ticketLog.slice().reverse().find(t => t.userId === userId);
  res.json({ unlocked: entry?.limitUnlocked || false });
});

app.post("/api/reset", (req, res) => {
  currentNumber = 0;
  currentTicket = 1;
  ticketLog = [];
  isTicketingClosed = false;
  resetFlag = true;
  res.json({ message: "呼び出し番号と整理券番号、発行ログをリセットしました。" });
});

app.get("/api/reset-status", (req, res) => {
  res.json({ reset: resetFlag });
  if (resetFlag) {
    resetFlag = false;
  }
});

app.get("/api/ticketing-status", (req, res) => {
  res.json({ closed: isTicketingClosed });
});

app.post("/api/close-ticketing", (req, res) => {
  isTicketingClosed = true;
  res.json({ message: "本日の新規整理券発行を終了しました。" });
});

app.post("/api/open-ticketing", (req, res) => {
  isTicketingClosed = false;
  res.json({ message: "本日の新規整理券発行を再開しました。" });
});

app.get("/", (req, res) => {
  res.redirect("/ticket.html");
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`✅ Server running on port ${port}`));
