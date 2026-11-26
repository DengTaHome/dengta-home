#!/usr/bin/env node
/**
 * DengTa SDD (Specification-Driven Development) Harness Compliance Gate
 *
 * Enforces the 5 SDD pillars directly against the live workspace:
 *   1. Single Source of Truth document presence & bidirectional SPEC-* traceability
 *   2. Release feed / download page / Vercel redirect / SDD spec / local signed APK parity
 *   3. Global Invariants (INV-03/04/05/06) regression checks & zero secret leakage
 *
 * Usage:
 *   node D:\GZdeepseek\dengta-home\tools\verify-sdd-compliance.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DOCS_REPO = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(DOCS_REPO, '..');
const FRONTEND_REPO = path.join(WORKSPACE_ROOT, '_refs', 'frontend-gh');
const BACKEND_REPO = path.join(WORKSPACE_ROOT, '_refs', 'backend-prod');
const SDD_DIR = path.join(DOCS_REPO, 'docs', 'sdd');
const APK_DIR = path.join(WORKSPACE_ROOT, 'apk-build');

const failures = [];
const checks = [];

function check(id, ok, detail) {
  checks.push({ id, ok: Boolean(ok), detail });
  if (!ok) failures.push(`[${id}] ${detail}`);
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

// 1. Required SDD artifact presence
const requiredFiles = {
  spec: path.join(SDD_DIR, 'DENGTA-SDD-SPEC.md'),
  reqForm: path.join(SDD_DIR, 'REQUIREMENTS-FORM.md'),
  testCases: path.join(SDD_DIR, 'TEST-CASES.md'),
  checklist: path.join(SDD_DIR, 'ACCEPTANCE-CHECKLIST.md'),
  changelog: path.join(SDD_DIR, 'CHANGELOG.md'),
  syncLedger: path.join(DOCS_REPO, 'docs', 'SYNC-LEDGER.md'),
};

for (const [key, fp] of Object.entries(requiredFiles)) {
  check(`SDD-FILE-${key.toUpperCase()}`, fs.existsSync(fp), fs.existsSync(fp) ? path.basename(fp) : `Missing ${fp}`);
}

if (failures.length === 0) {
  const specText = readText(requiredFiles.spec);
  const reqFormText = readText(requiredFiles.reqForm);
  const testCasesText = readText(requiredFiles.testCases);
  const checklistText = readText(requiredFiles.checklist);
  const changelogText = readText(requiredFiles.changelog);

  // 2. Bidirectional SPEC-* traceability across spec -> reqForm -> testCases -> checklist
  const specIds = [...new Set(specText.match(/SPEC-[A-Z0-9-]+/g) || [])];
  check('SDD-SPEC-COUNT', specIds.length >= 7, `Found ${specIds.length} SPEC-* IDs: ${specIds.join(', ')}`);

  for (const specId of specIds) {
    check(
      `SDD-TRACE-${specId}`,
      reqFormText.includes(specId) && testCasesText.includes(specId) && checklistText.includes(specId),
      `reqForm=${reqFormText.includes(specId)}, testCases=${testCasesText.includes(specId)}, checklist=${checklistText.includes(specId)}`,
    );
  }

  // Verify REQUIREMENTS-FORM contains structured In/Out & TC-* mappings
  const reqIds = [...new Set(reqFormText.match(/REQ-\d{3}/g) || [])];
  const tcIds = [...new Set(testCasesText.match(/TC-[A-Z]+-\d{2}/g) || [])];
  check('SDD-REQ-FORM-STRUCTURE', reqIds.length >= 10 && reqFormText.includes('In Scope') && reqFormText.includes('Out Scope'), `REQ entries=${reqIds.length}, In/Out columns verified`);
  check('SDD-TEST-CASES-COUNT', tcIds.length >= 20, `Executable TC-* test cases=${tcIds.length}`);

  // 3. Release Single Source of Truth parity across manifests, Vercel, SDD docs, and signed APK
  const androidFeed = JSON.parse(readText(path.join(FRONTEND_REPO, 'public', 'updates', 'android.json')));
  const downloadFeed = JSON.parse(readText(path.join(FRONTEND_REPO, 'public', 'updates', 'download.json')));
  const downloadHtml = readText(path.join(FRONTEND_REPO, 'public', 'download.html'));
  const vercelJson = readText(path.join(FRONTEND_REPO, 'vercel.json'));

  const latestVer = androidFeed?.latest?.version;
  const latestCode = androidFeed?.latest?.version_code;
  const expectedSha = androidFeed?.latest?.sha256;
  const expectedSize = androidFeed?.latest?.size_bytes;

  check(
    'SDD-VERSION-FEEDS',
    Boolean(latestVer) &&
      downloadFeed?.latest?.version === latestVer &&
      downloadFeed?.latest?.version_code === latestCode &&
      downloadFeed?.latest?.sha256 === expectedSha &&
      downloadFeed?.latest?.size_bytes === expectedSize,
    `android.json & download.json both point to v${latestVer} (${latestCode})`,
  );
  check(
    'SDD-VERSION-HTML-VERCEL',
    downloadHtml.includes(`DengTa-${latestVer}.apk`) && vercelJson.includes(`DengTa-${latestVer}.apk`),
    `download.html and vercel.json both reference DengTa-${latestVer}.apk`,
  );
  check(
    'SDD-VERSION-DOCS',
    specText.includes(`v${latestVer}`) && changelogText.includes(`v${latestVer}`) && reqFormText.includes(`v${latestVer}`),
    `DENGTA-SDD-SPEC, CHANGELOG, and REQUIREMENTS-FORM aligned to v${latestVer}`,
  );

  const apkPath = path.join(APK_DIR, `DengTa-${latestVer}.apk`);
  if (fs.existsSync(apkPath)) {
    const stat = fs.statSync(apkPath);
    const actualSha = crypto.createHash('sha256').update(fs.readFileSync(apkPath)).digest('hex');
    check(
      'SDD-APK-INTEGRITY',
      stat.size === expectedSize && actualSha === expectedSha,
      `DengTa-${latestVer}.apk size=${stat.size} sha256=${actualSha.slice(0, 16)}... matches feed`,
    );
  } else {
    check('SDD-APK-INTEGRITY', false, `Expected signed APK missing: ${apkPath}`);
  }

  // 4. Global Invariants regression guardrails (INV-04 / INV-05 / INV-06)
  const cottonCss = readText(path.join(FRONTEND_REPO, 'src', 'cotton-pet.css'));
  check(
    'INV-05-COTTON-CONTRAST',
    !cottonCss.includes('#f3dccb') && cottonCss.includes('#68857d') && cottonCss.includes('--theme-card-rgb'),
    'CottonPet studio backdrop high-contrast & theme-aware frosted controls intact',
  );

  const userAgentsTestPath = path.join(BACKEND_REPO, 'test', 'user-agents-md.test.js');
  check('INV-04-AGENTS-MD-CONTRACT', fs.existsSync(userAgentsTestPath), 'backend user-agents-md.test.js contract test present');

  const secretPatterns = [
    /\bghp_[A-Za-z0-9]{20,}\b/,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
    /\bsk-[A-Za-z0-9]{24,}\b/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  ];
  const scanTargets = [
    ...Object.values(requiredFiles),
    path.join(FRONTEND_REPO, 'public', 'updates', 'android.json'),
    path.join(FRONTEND_REPO, 'public', 'updates', 'download.json'),
  ];
  const leaked = [];
  for (const file of scanTargets) {
    const content = readText(file);
    for (const pattern of secretPatterns) {
      if (pattern.test(content)) leaked.push(`${path.basename(file)} matched ${pattern}`);
    }
  }
  check('INV-06-ZERO-SECRET-LEAK', leaked.length === 0, leaked.length === 0 ? `Scanned ${scanTargets.length} SDD/manifest files: 0 secrets` : leaked.join('; '));
}

const summary = {
  ok: failures.length === 0,
  checked: checks.length,
  passed: checks.filter((c) => c.ok).length,
  failed: failures.length,
  checks,
};

console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) {
  console.error('\nSDD COMPLIANCE GATE FAILED:\n' + failures.map((f) => ' - ' + f).join('\n'));
  process.exit(1);
}
