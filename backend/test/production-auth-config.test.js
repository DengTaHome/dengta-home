const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const serverSource = fs.readFileSync(
    path.join(root, "server.js"),
    "utf8"
);
const renderConfig = fs.readFileSync(
    path.join(root, "render.yaml"),
    "utf8"
);
const backgroundJobWorkflow = fs.readFileSync(
    path.join(root, ".github", "workflows", "shadow-push.yml"),
    "utf8"
);

assert.match(
    serverSource,
    /const authRequired = booleanEnv\(\s*process\.env\.AUTH_REQUIRED,\s*process\.env\.NODE_ENV === "production"\s*\)/
);
assert.match(
    renderConfig,
    /- key: AUTH_REQUIRED\s+value: "true"/
);
assert.match(
    renderConfig,
    /- key: INITIAL_OWNER_EMAIL\s+sync: false/
);
assert.match(
    renderConfig,
    /- key: MCP_ENCRYPTION_KEY\s+sync: false/
);
assert.match(
    renderConfig,
    /- key: BACKGROUND_JOBS_ENABLED\s+value: "false"/
);
assert.match(
    renderConfig,
    /- key: BACKGROUND_JOB_TRIGGER_SECRET\s+sync: false/
);
assert.match(
    backgroundJobWorkflow,
    /name: Trigger companion background jobs/
);
assert.match(backgroundJobWorkflow, /cron: "\*\/10 \* \* \* \*"/);
assert.match(
    backgroundJobWorkflow,
    /secrets\.DENGTA_BACKGROUND_JOB_TRIGGER_SECRET_V3/
);
assert.match(
    backgroundJobWorkflow,
    /DENGTA_BACKGROUND_JOB_TRIGGER_SECRET_V3 is not configured; skipping this tick\.[\s\S]*?exit 0/
);
assert.match(
    backgroundJobWorkflow,
    /--header "x-dengta-job-secret: \$BACKGROUND_JOB_TRIGGER_SECRET"/
);
assert.match(
    backgroundJobWorkflow,
    /\/internal\/background-jobs\/tick/
);
assert.match(
    backgroundJobWorkflow,
    /\[ "\$status" != "200" \] && \[ "\$status" != "202" \]/
);
assert.doesNotMatch(backgroundJobWorkflow, /DENGTA_PUSH_SECRET/);
assert.doesNotMatch(backgroundJobWorkflow, /\/api\/push\/trigger/);
assert.match(
    serverSource,
    /createBackgroundJobWorker\(\{[\s\S]*?createTenantDatabase,[\s\S]*?moment_interaction: createTenantMomentInteractionHandler/
);
assert.match(
    serverSource,
    /reconcileTenant:[\s\S]*?reconcileTenantRecurringJobs\([\s\S]*?getSettings/
);
assert.match(serverSource, /background_job_reconciliation:\s*true/);
assert.match(serverSource, /proactive_daily_limit:\s*true/);
assert.match(
    serverSource,
    /proactive_message: \(\{ job, database, lease \}\) =>[\s\S]*?handleTenantProactiveMessage/
);
assert.match(
    serverSource,
    /moment_post: \(\{ job, database, lease \}\) =>[\s\S]*?handleTenantMomentPost/
);
assert.match(
    serverSource,
    /diary_update: \(\{ job, database, lease \}\) =>[\s\S]*?handleTenantDiaryUpdate/
);
assert.match(
    serverSource,
    /profile_refresh: \(\{ job, database, lease \}\) =>[\s\S]*?handleTenantProfileRefresh/
);
assert.match(
    serverSource,
    /tryScheduleProactiveMessageEvaluation\(\{[\s\S]*?sourceMessageId: savedAssistantMessage\.id/
);
assert.match(
    serverSource,
    /tryScheduleAutonomousContentEvaluations\(\{[\s\S]*?sourceMessageId: savedAssistantMessage\.id/
);
assert.match(
    serverSource,
    /scheduleProfileRefresh\(\{[\s\S]*?sourceMessageId/
);
assert.match(
    serverSource,
    /createBackgroundJobTrigger\(\{[\s\S]*?secret: process\.env\.BACKGROUND_JOB_TRIGGER_SECRET,[\s\S]*?enabled: backgroundJobsEnabled/
);
assert.match(
    serverSource,
    /startBackgroundJobLoop\(\{[\s\S]*?worker: backgroundJobWorker,[\s\S]*?enabled: backgroundJobsEnabled,[\s\S]*?BACKGROUND_JOB_LOCAL_INTERVAL_MS/
);
assert.match(
    serverSource,
    /background_job_worker: true,[\s\S]*?background_jobs_enabled: backgroundJobsEnabled,[\s\S]*?background_job_local_loop: backgroundJobsEnabled,[\s\S]*?background_job_trigger_configured: Boolean/
);
const triggerRouteIndex = serverSource.indexOf(
    'app.post("/internal/background-jobs/tick", backgroundJobTrigger)'
);
const authMiddlewareIndex = serverSource.search(
    /app\.use\(\r?\n\s*createAuthContextMiddleware/
);
assert.ok(triggerRouteIndex >= 0, "background trigger route must exist");
assert.ok(
    authMiddlewareIndex > triggerRouteIndex,
    "background trigger authentication must remain ahead of user auth middleware on LF and CRLF checkouts"
);
assert.match(
    serverSource,
    /if \(authRequired\) \{\s*return res\.status\(410\)\.json\(\{\s*code: "legacy_background_trigger_retired"/
);
assert.match(
    serverSource,
    /if \(!authRequired\) \{\s*momentMaintenanceTimer = setInterval/
);
assert.match(
    serverSource,
    /app\.listen\(port,[\s\S]*?if \(!authRequired\) \{\s*void processDueMoments\(\);\s*void maybeGenerateDiaryEntry\(\);/
);

console.log("production authentication configuration tests passed");
