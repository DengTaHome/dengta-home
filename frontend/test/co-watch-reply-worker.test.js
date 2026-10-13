import assert from "node:assert/strict";
import fs from "node:fs";

const source = (path) =>
  fs.readFileSync(new URL(path, import.meta.url), "utf8");

const receiver = source(
  "../android/app/src/main/java/home/dengta/app/CoWatchReplyReceiver.java",
);
const workerPath = new URL(
  "../android/app/src/main/java/home/dengta/app/CoWatchReplyWorker.java",
  import.meta.url,
);

assert.equal(
  fs.existsSync(workerPath),
  true,
  "notification replies must be handed to a durable WorkManager worker",
);
const worker = fs.readFileSync(workerPath, "utf8");

assert.match(receiver, /OneTimeWorkRequest/);
assert.match(receiver, /WorkManager\.getInstance\(appContext\)\.enqueue\(request\)/);
assert.match(receiver, /new Data\.Builder\(\)/);
assert.match(receiver, /UUID\.randomUUID\(\)\.toString\(\)/);
assert.match(receiver, /CoWatchReplyWorker\.DATA_REQUEST_ID/);
assert.match(receiver, /cleanText\(value\.toString\(\),\s*1200\)/);
assert.doesNotMatch(receiver, /goAsync\(\)/);
assert.doesNotMatch(receiver, /HttpURLConnection/);
assert.doesNotMatch(receiver, /ExecutorService/);

assert.match(worker, /extends Worker/);
assert.match(worker, /BackgroundNotificationCredentials\.read\(context\)/);
assert.match(worker, /BackgroundNotificationCredentials\.currentScopeKey\(context\)/);
assert.match(worker, /getInputData\(\)\.getString\(DATA_REQUEST_ID\)/);
assert.match(worker, /request\.put\("request_id", requestId\)/);
assert.doesNotMatch(
  worker,
  /UUID\.randomUUID/,
  "a retry must reuse the request id created by the receiver",
);
assert.match(worker, /if \(isStopped\(\)\) return Result\.success\(\)/);
assert.match(
  worker,
  /if \(isStopped\(\) \|\| !requestScope\.equals\([\s\S]{0,100}currentScopeKey\(context\)[\s\S]{0,100}\)\) \{\s*return Result\.success\(\);\s*\}/,
  "a reply from an old account scope must never create a notification",
);
assert.match(worker, /status == 429 \|\| status >= 500/);
assert.match(worker, /catch \(IOException error\) \{\s*return retryOrFail\(\);/);
assert.match(worker, /PushNotificationWorker\.showImmediateCoWatchMessage/);

console.log("co-watch notification reply WorkManager tests passed");
