import assert from "node:assert/strict";
import { after, test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { assertDuelNarration } from "../src/duel-request.js";
const vite = await createServer({ configFile: false, envFile: false, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
after(() => vite.close());
const { default: Feedback } = await vite.ssrLoadModule("/src/DlnaDiscoveryFeedback.jsx");
test("starting or failed discovery cannot advertise readiness, fixed codes explain a recovery", () => {
  const render = state => renderToStaticMarkup(React.createElement(Feedback, { state }));
  assert.match(render({ discoveryStatus: "starting", active: false }), /尚未就绪/);
  for (const errorCode of ["dlna_ssdp_bind_failed", "dlna_multicast_join_failed", "dlna_http_bind_failed", "dlna_network_unavailable", "dlna_state_unavailable"]) {
    const output = render({ discoveryStatus: "error", errorCode, active: false });
    assert.match(output, new RegExp(errorCode)); assert.doesNotMatch(output, /已就绪/);
  }
  assert.doesNotMatch(render({ discoveryStatus: "error", errorCode: "PRIVATE_SECRET_RAW" }), /PRIVATE_SECRET_RAW/);
  assert.match(render({ discoveryStatus: "ready", active: true }), /已就绪/);
  assert.equal(render({ discoveryStatus: "stopped", active: false }), "");
});
test("duel failure only exposes the two existing public provider error classifications", () => {
  for (const [refusal_code, code] of [["provider_error_document", "provider_error_document"], ["provider_boundary_residue", "provider_boundary_residue"], ["PRIVATE_RAW", "provider_boundary_residue"]]) {
    assert.throws(() => assertDuelNarration({ refused: true, refusal_code }, {}), { code });
  }
});
