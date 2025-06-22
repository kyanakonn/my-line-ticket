const express = require("express");
const axios = require("axios");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// 整理券管理
let currentTicket = 1;
let currentNumber = 0;

// LINE連携設定
const LINE_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const LINE_API_URL = "https://api.line.me/v2/bot/message/reply";

// LINE webhook: メッセージを受け取ったらリンクを返信
app.post("/webhook", async (req, res) => {
  const events = req.body.events;
  if (!events || events.length === 0) return res.status(200).send("No events");

  const event = events[0];
  const replyToken = event.replyToken;

  try {
    await axios.post(
      LINE_API_URL,
      {
        replyToken: replyToken,
        messages: [
          {
            type: "text",
            text: `整理券はこちらから発行できます：\nhttps://my-line-ticket.onrender.com/ticket.html`,
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LINE_ACCESS_TOKEN}`,
        },
      }
    );
    res.status(200).send("OK");
  } catch (error) {
    console.error("LINEメッセージ送信失敗:", error.response?.data || error.message);
    res.status(500).send("Error");
  }
});

// 整理券を発行する
app.post("/api/ticket", (req, res) => {
  const ticketNumber = currentTicket++;
  res.json({ number: ticketNumber });
});

// 現在の呼び出し番号を取得する
app.get("/api/number", (req, res) => {
  res.json({ number: currentNumber });
});

// 呼び出しを進める or 戻す（±差分を受け取る）
app.post("/api/call", (req, res) => {
  const diff = typeof req.body.diff === "number" ? req.body.diff : 1;
  currentNumber += diff;
  if (currentNumber < 0) currentNumber = 0;
  res.json({ message: `番号 ${currentNumber} を呼び出しました。` });
});

// 呼び出し番号を直接設定する
app.post("/api/set", (req, res) => {
  const { number } = req.body;
  if (typeof number !== "number" || number < 0) {
    return res.status(400).json({ message: "無効な番号です。" });
  }
  currentNumber = number;
  res.json({ message: `呼び出し番号を ${currentNumber} に設定しました。` });
});

// ルートアクセス → ユーザー向けページへリダイレクト
app.get("/", (req, res) => {
  res.redirect("/ticket.html");
});

// サーバー起動
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});
