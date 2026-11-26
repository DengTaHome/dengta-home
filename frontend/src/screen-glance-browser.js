const GRID_WIDTH = 64;
const GRID_HEIGHT = 36;
const CHANGE_THRESHOLD = 12;
const SAMPLE_INTERVAL_MS = 350;
const CAPTURE_WINDOW_MS = 4200;
const MAX_FRAMES = 4;

// Retain visually different samples, following See Now's select-then-pack approach.
export function averageRgbChange(previous, current) {
  if (!previous || previous.length !== current.length) return Infinity;
  let sum = 0;
  for (let offset = 0; offset < current.length; offset += 4) {
    sum += Math.abs(current[offset] - previous[offset]);
    sum += Math.abs(current[offset + 1] - previous[offset + 1]);
    sum += Math.abs(current[offset + 2] - previous[offset + 2]);
  }
  return sum / (current.length * 0.75);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function captureBrowserScreenSheet(isCurrent) {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  try {
    const deadline = performance.now() + CAPTURE_WINDOW_MS;
    void video.play().catch(() => {});
    const scan = document.createElement("canvas");
    scan.width = GRID_WIDTH;
    scan.height = GRID_HEIGHT;
    const scanner = scan.getContext("2d", { willReadFrequently: true });
    const frames = [];
    let previous;
    const track = stream.getVideoTracks()[0];
    while (isCurrent() && track?.readyState === "live" && performance.now() < deadline && frames.length < MAX_FRAMES) {
      if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
        scanner.drawImage(video, 0, 0, GRID_WIDTH, GRID_HEIGHT);
        const current = scanner.getImageData(0, 0, GRID_WIDTH, GRID_HEIGHT).data;
        if (averageRgbChange(previous, current) >= CHANGE_THRESHOLD) {
          const frame = document.createElement("canvas");
          const scale = Math.min(1, 768 / Math.max(video.videoWidth, video.videoHeight));
          frame.width = Math.max(1, Math.round(video.videoWidth * scale));
          frame.height = Math.max(1, Math.round(video.videoHeight * scale));
          frame.getContext("2d").drawImage(video, 0, 0, frame.width, frame.height);
          frames.push(frame);
          previous = current;
        }
      }
      if (frames.length < MAX_FRAMES) await delay(SAMPLE_INTERVAL_MS);
    }
    if (!isCurrent() || track?.readyState !== "live") return null;
    if (!frames.length) throw new Error("没有收到可用画面，请重新选择窗口。");
    const sheet = document.createElement("canvas");
    const cols = Math.min(2, frames.length);
    const cellWidth = frames[0].width;
    const cellHeight = frames[0].height;
    sheet.width = cellWidth * cols;
    sheet.height = cellHeight * Math.ceil(frames.length / cols);
    const context = sheet.getContext("2d");
    frames.forEach((frame, index) => {
      context.drawImage(frame, (index % cols) * cellWidth, Math.floor(index / cols) * cellHeight, cellWidth, cellHeight);
    });
    const blob = await new Promise((resolve) => sheet.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) throw new Error("屏幕画面生成失败。");
    return isCurrent() ? new File([blob], "屏幕画面.jpg", { type: blob.type }) : null;
  } finally {
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  }
}
