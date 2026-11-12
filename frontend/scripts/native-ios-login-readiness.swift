import Foundation
import Vision
import Darwin

// Only fixed labels and booleans leave this process. Never serialize recognized
// screen text: the same gate must remain safe if a fixture later changes.
let requiredLabels = ["欢迎回来", "邮箱", "密码", "回到我的伴侣身边"]
let errorLabels: [(String, String)] = [
    ("安全登录存储暂不可用", "secure-storage-unavailable"),
    ("安全数据清理尚未完成", "account-cleanup-incomplete"),
    ("暂时无法打开你的私密空间", "private-cache-unavailable"),
    ("无法恢复登录状态", "session-restore-failed"),
    ("登录状态已失效", "session-expired"),
    ("登录服务尚未接通", "auth-configuration-missing")
]

func normalized(_ text: String) -> String {
    text.precomposedStringWithCompatibilityMapping.filter { !$0.isWhitespace }
}

func classify(_ texts: [String]) -> [String: Any] {
    let text = texts.map(normalized).joined()
    let matched = Dictionary(uniqueKeysWithValues: requiredLabels.map { ($0, text.contains(normalized($0))) })
    let error = errorLabels.first { text.contains(normalized($0.0)) }?.1
    let loading = text.contains("正在找回你的家") || text.contains("恢复登录与伴侣空间")
    let state = error != nil ? "auth-error" : loading ? "loading" : matched.values.allSatisfy { $0 } ? "login-ready" : "screen-pending"
    var result: [String: Any] = ["schemaVersion": 1, "status": state, "requiredLabels": matched]
    if let error { result["errorCode"] = error }
    return result
}

func emit(_ result: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]) else { exit(70) }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([10]))
}

let arguments = CommandLine.arguments
guard arguments.count == 2 else {
    emit(["schemaVersion": 1, "status": "probe-error", "errorCode": "invalid-probe-arguments"])
    exit(64)
}

if arguments[1] == "--test-classification" {
    let ready = requiredLabels
    precondition(classify(ready)["status"] as? String == "login-ready")
    precondition(classify(Array(ready.dropLast()))["status"] as? String == "screen-pending")
    precondition(classify(ready + ["正在找回你的家"])["status"] as? String == "loading")
    precondition(classify(ready + ["安全登录存储暂不可用，请解锁设备后重试"])["status"] as? String == "auth-error")
    emit(["schemaVersion": 1, "status": "classification-tests-passed"])
    exit(0)
}

do {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    request.usesLanguageCorrection = false
    let handler = VNImageRequestHandler(url: URL(fileURLWithPath: arguments[1]), options: [:])
    try handler.perform([request])
    let texts = (request.results ?? []).compactMap { observation in
        guard let candidate = observation.topCandidates(1).first, candidate.confidence >= 0.25 else { return nil as String? }
        return candidate.string
    }
    let result = classify(texts)
    emit(result)
    switch result["status"] as? String {
    case "login-ready": exit(0)
    case "auth-error": exit(3)
    default: exit(2)
    }
} catch {
    emit(["schemaVersion": 1, "status": "probe-error", "errorCode": "vision-recognition-failed"])
    exit(65)
}
