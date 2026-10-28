"""Smoke-test the X MCP over stdio without writing cookies to the repo.

Reads X_CREDENTIALS_JSON from the environment (a JSON object with auth_token/ct0)
and optionally TWITTER_PROXY / TWITTER_USER_AGENT / TWIKIT_ONDEMAND_URL.
"""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from mcp import ClientSession, StdioServerParameters  # noqa: E402
from mcp.client.stdio import stdio_client  # noqa: E402

PYTHON = os.environ.get("X_MCP_PYTHON", r"D:\GZdeepseek\_tools\python312\python.exe")
SERVER = os.environ.get("X_MCP_SERVER", r"D:\GZdeepseek\_refs\x-twikit-mcp\server.py")


async def main():
    cookies = os.environ.get("X_CREDENTIALS_JSON", "").strip()
    cookie_path = os.environ.get("X_COOKIES_PATH", "").strip()
    if not cookies and not cookie_path:
        raise SystemExit("X_CREDENTIALS_JSON or X_COOKIES_PATH is required")
    env = dict(os.environ)
    if cookies:
        env["TWITTER_COOKIES_JSON"] = cookies
    elif cookie_path:
        env["TWITTER_COOKIES_PATH"] = cookie_path
    params = StdioServerParameters(command=PYTHON, args=[SERVER], env=env)
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            names = [tool.name for tool in tools.tools]
            print(f"tools={len(names)} {names}")
            if "get_user_info" in names:
                result = await session.call_tool("get_user_info", {"username": "jack"})
                print(str(result)[:300])


if __name__ == "__main__":
    asyncio.run(main())
