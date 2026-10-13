const http = require("node:http");
const https = require("node:https");
const { Readable } = require("node:stream");
const { isIP } = require("node:net");

// DNS validation happens in the socket's lookup callback, so a second lookup
// cannot change a previously public destination into an internal address.
function createPinnedMcpFetch({ lookup, isPrivateIp }) {
    return (url, options = {}) => new Promise((resolve, reject) => {
        const target = new URL(url);
        const hostname = target.hostname.replace(/^\[|\]$/g, "");
        if (!["https:", "http:"].includes(target.protocol) || target.username || target.password) {
            throw Object.assign(new Error("Invalid MCP endpoint"), { code: "MCP_ENDPOINT_INVALID" });
        }
        if (isIP(hostname) && isPrivateIp(hostname)) {
            throw Object.assign(new Error("MCP endpoint is private"), { code: "MCP_ENDPOINT_PRIVATE" });
        }
        const transport = target.protocol === "https:" ? https : http;
        const request = transport.request(target, {
            method: options.method || "GET",
            headers: options.headers,
            signal: options.signal,
            agent: false,
            lookup(hostname, lookupOptions, callback) {
                lookup(hostname, { all: true, verbatim: true }).then((records) => {
                    if (!records.length || records.some(({ address }) => isPrivateIp(address))) {
                        callback(Object.assign(new Error("MCP endpoint resolved to a private network"), { code: "MCP_ENDPOINT_PRIVATE" }));
                        return;
                    }
                    if (lookupOptions.all) callback(null, records);
                    else callback(null, records[0].address, records[0].family);
                }, callback);
            }
        }, (incoming) => {
            if (incoming.statusCode >= 300 && incoming.statusCode < 400) {
                incoming.destroy();
                reject(Object.assign(new Error("MCP redirects are not allowed"), { code: "MCP_REDIRECT_BLOCKED" }));
                return;
            }
            const headers = new Headers();
            for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
                headers.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
            }
            const noBody = [204, 205, 304].includes(incoming.statusCode);
            if (noBody) incoming.resume();
            resolve(new Response(noBody ? null : Readable.toWeb(incoming), {
                status: incoming.statusCode, headers
            }));
        });
        request.on("error", reject);
        request.end(options.body);
    });
}

module.exports = { createPinnedMcpFetch };
