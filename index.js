const express = require("express");
const axios = require("axios");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 簡易的な整理券カウンター
let currentTicket = 1;

// LINE設定
const LINE_ACCESS_TOKEN = process.env.XyV0b5TDiX8Rg56QlMFLRSk8T31f7jdpDo9eei7R1J7Lf8faOksfL6W7a0aHqGuVrh/yR3IbPi+eJUNV4dyn0ANG6R7rrestYNS/VuiLnP9HEVc6JJIKcum97A9HFKbHkau0qNb3AGAoUGiPGldr3AdB04t89/1O/w1cDnyilFU=;
const LINE_API_URL = "https://api.line.me/v2/bot/message/reply";

// LINE Webhook
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
            text: `整理券はこちらから発行できます：\nhttps://your-app-name.onrender.com/ticket`,
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${XyV0b5TDiX8Rg56QlMFLRSk8T31f7jdpDo9eei7R1J7Lf8faOksfL6W7a0aHqGuVrh/yR3IbPi+eJUNV4dyn0ANG6R7rrestYNS/VuiLnP9HEVc6JJIKcum97A9HFKbHkau0qNb3AGAoUGiPGldr3AdB04t89/1O/w1cDnyilFU=}`,
        },
      }
    );
    res.status(200).send("OK");
  } catch (error) {
    console.error("Error sending message:", error.response?.data || error.message);
    res.status(500).send("Error");
  }
});

// 整理券ページ
app.get("/ticket", (req, res) => {
  const ticketNumber = currentTicket++;
  res.send(`
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>整理券発行</title>
        <style>
          body { font-family: sans-serif; text-align: center; padding: 2em; }
          .ticket { font-size: 3em; color: green; }
        </style>
      </head>
      <body>
        <h1>整理券番号</h1>
        <div class="ticket">${ticketNumber}</div>
        <p>画面を保存してください。</p>
      </body>
    </html>
  `);
});

// Render用
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("Server running on port " + port);
});

