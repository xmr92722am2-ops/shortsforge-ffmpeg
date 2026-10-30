
import express from "express";
import cors from "cors";
import multer from "multer";
import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const app = express();
const PORT = process.env.PORT || 3000;
const API_SECRET = process.env.API_SECRET;

app.use(cors());
app.use(express.json());

const upload = multer({
  dest: path.join(os.tmpdir(), "shortsforge-uploads"),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "video/mp4",
      "video/quicktime",
      "video/webm"
    ];
    cb(null, allowed.includes(file.mimetype));
  }
});

const outputDir = path.join(os.tmpdir(), "shortsforge-exports");
fs.mkdirSync(outputDir, { recursive: true });

function authenticate(req, res, next) {
  if (!API_SECRET) {
    return res.status(503).json({ error: "API_SECRET is not configured" });
  }

  if (req.headers.authorization !== `Bearer ${API_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

app.get("/", (req, res) => {
  res.json({
    service: "ShortsForge FFmpeg API",
    status: "online"
  });
});

app.post("/export", authenticate, upload.single("video"), (req, res) => {
  const input = req.file?.path;
  const start = Number(req.body.start);
  const duration = Number(req.body.duration);

  if (!input) {
    return res.status(400).json({ error: "Authorized source video is required" });
  }

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(duration) ||
    start < 0 ||
    duration <= 0 ||
    duration > 180
  ) {
    fs.unlink(input, () => {});
    return res.status(400).json({ error: "Invalid clip timestamps; maximum duration is 180 seconds" });
  }

  const id = crypto.randomUUID();
  const output = path.join(outputDir, `${id}.mp4`);

  const args = [
    "-y",
    "-ss", String(start),
    "-i", input,
    "-t", String(duration),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "23",
    "-c:a", "aac",
    "-movflags", "+faststart",
    output
  ];

  const process = spawn(ffmpegPath, args);

  process.on("error", () => {
    fs.unlink(input, () => {});
    res.status(500).json({ error: "Could not start FFmpeg" });
  });

  process.on("close", (code) => {
    fs.unlink(input, () => {});

    if (res.headersSent) return;

    if (code !== 0 || !fs.existsSync(output)) {
      return res.status(500).json({ error: "Video export failed" });
    }

    res.json({
      success: true,
      downloadUrl: `/download/${id}`,
      filename: "shortsforge-clip.mp4"
    });
  });
});

app.get("/download/:id", authenticate, (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) {
    return res.status(400).json({ error: "Invalid file ID" });
  }

  const file = path.join(outputDir, `${req.params.id}.mp4`);

  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: "Clip expired or not found" });
  }

  res.download(file, "shortsforge-clip.mp4");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ShortsForge API listening on ${PORT}`);
});
