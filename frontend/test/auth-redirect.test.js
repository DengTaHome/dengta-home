import assert from "node:assert/strict";
import { resolveEmailRedirectUrl } from "../src/auth-redirect.js";

assert.equal(
  resolveEmailRedirectUrl({
    nativePlatform: false,
    location: {
      origin: "https://your-project-4.onrender.com",
      pathname: "/web/",
    },
  }),
  "https://www.dengtahome.com/",
  "email links opened from the compatibility mirror must return to the official app",
);

assert.equal(
  resolveEmailRedirectUrl({
    nativePlatform: false,
    location: {
      origin: "https://your-project-1.vercel.app",
      pathname: "/",
    },
  }),
  "https://www.dengtahome.com/",
  "all production email links must use the mobile-reachable canonical app URL",
);

for (const origin of [
  "https://dengtahome.com",
  "https://www.dengtahome.com",
]) {
  assert.equal(
    resolveEmailRedirectUrl({
      nativePlatform: false,
      location: { origin, pathname: "/" },
    }),
    "https://www.dengtahome.com/",
    `official domain ${origin} must use the canonical authentication callback`,
  );
}

assert.equal(
  resolveEmailRedirectUrl({
    nativePlatform: false,
    location: {
      origin: "https://your-project-4.onrender.com",
      pathname: "/web",
    },
  }),
  "https://www.dengtahome.com/",
);

assert.equal(
  resolveEmailRedirectUrl({
    nativePlatform: true,
    location: {
      origin: "https://localhost",
      pathname: "/",
    },
  }),
  "dengta://auth",
  "Android registration must return to the registered app deep link, never WebView localhost",
);

assert.equal(
  resolveEmailRedirectUrl({
    nativePlatform: false,
    location: {
      origin: "https://self-hosted.example",
      pathname: "/dengta/",
    },
  }),
  "https://self-hosted.example/dengta/",
  "self-hosted builds must not be redirected to the official deployment",
);

assert.equal(
  resolveEmailRedirectUrl({
    nativePlatform: false,
    location: {
      origin: "http://127.0.0.1:5173",
      pathname: "/preview/chat",
    },
    baseUrl: "/preview/",
  }),
  "http://127.0.0.1:5173/preview/",
  "local builds must retain their configured application base",
);

assert.equal(
  resolveEmailRedirectUrl({
    nativePlatform: true,
    location: { origin: "https://localhost", pathname: "/" },
    configuredUrl: "https://accounts.example/app/",
  }),
  "https://accounts.example/app/",
  "a build-time public redirect overrides the official native fallback",
);

assert.equal(
  resolveEmailRedirectUrl({
    nativePlatform: false,
    location: { origin: "file://", pathname: "/web/" },
  }),
  "https://www.dengtahome.com/",
);

console.log("authentication email redirect tests passed");
