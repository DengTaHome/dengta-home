import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { backendTestRoot } from "./helpers/backend-test-root.js";

for (const backendName of ["backend", "dengta-home-backend"]) {
  test(`integration prerequisite resolution supports ${backendName} sibling layout`, () => {
    const root = mkdtempSync(path.join(tmpdir(), "dengta-backend-layout-"));
    try {
      const backend = path.join(root, backendName);
      for (const file of ["package.json", "server.js", "test/helpers/xhs-sticker-fixture.js", "services/xhs-sticker-import.js", "routes/v2/private-media.js"]) {
        mkdirSync(path.dirname(path.join(backend, file)), { recursive: true });
        writeFileSync(path.join(backend, file), "{}");
      }
      assert.equal(backendTestRoot({ frontendRoot: path.join(root, "frontend"), configuredRoot: "" }), backend);
      assert.equal(backendTestRoot({ frontendRoot: path.join(root, "another"), configuredRoot: backend }), backend);
      assert.equal(backendTestRoot({ frontendRoot: path.join(root, "another"), configuredRoot: backendName, cwd: root }), backend);
      assert.throws(() => backendTestRoot({ frontendRoot: path.join(root, "frontend"), configuredRoot: "missing-backend", cwd: root }), /DENGTA_BACKEND_TEST_ROOT/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test("a frontend-only checkout gets explicit integration setup instructions", () => {
  const root = mkdtempSync(path.join(tmpdir(), "dengta-frontend-only-"));
  try {
    assert.throws(() => backendTestRoot({ frontendRoot: path.join(root, "frontend"), configuredRoot: "" }), /Run npm ci in both frontend and backend.*never silently skips/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("feature prerequisites fail explicitly instead of silently using an incomplete backend", () => {
  const root = mkdtempSync(path.join(tmpdir(), "dengta-backend-feature-"));
  try {
    const backend = path.join(root, "backend"); mkdirSync(backend); writeFileSync(path.join(backend, "package.json"), "{}"); writeFileSync(path.join(backend, "server.js"), "");
    assert.throws(() => backendTestRoot({ frontendRoot: path.join(root, "frontend"), configuredRoot: "", requiredFiles: ["package.json", "services/missing-fixture.js"] }), /cross-repository integration.*never silently skips/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
