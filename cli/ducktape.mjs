#!/usr/bin/env node
// DuckTape CLI — a thin client for your deployed DuckTape app.
// It shares the SAME memory as the DuckTape web app: what you tell one, the other knows.
// No dependencies. Node 18+ (needs global fetch).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const DEFAULT_URL = "https://ducktape-5a3wvrzq.sauna.new";
const CONFIG_DIR = path.join(os.homedir(), ".ducktape");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
};

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); }
  catch { return {}; }
}
function saveConfig(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function getConfig() {
  const cfg = loadConfig();
  return {
    url: process.env.DUCKTAPE_URL || cfg.url || DEFAULT_URL,
    token: process.env.DUCKTAPE_TOKEN || cfg.token || "",
  };
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
  });
}

async function call(endpoint, body) {
  const { url, token } = getConfig();
  if (!token) {
    console.error(C.red("No token set.") + " Run: " + C.bold("ducktape login <token>"));
    console.error(C.dim("Get your token from " + url + "/admin/cli-token (sign in as the app owner)."));
    process.exit(1);
  }
  let res;
  try {
    res = await fetch(url + endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ducktape-token": token },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error(C.red("Network error: ") + (e?.message ?? e));
    process.exit(1);
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }
  if (!res.ok) {
    if (res.status === 401) {
      console.error(C.red("Unauthorized.") + " Your token is wrong or expired. Run " + C.bold("ducktape login <token>") + " again.");
    } else {
      console.error(C.red("Error " + res.status + ": ") + (data.error ?? text));
    }
    process.exit(1);
  }
  return data;
}

function duckSay(text) {
  console.log(C.yellow("🦆 DuckTape"));
  console.log(text.trim());
}

function help() {
  console.log(`${C.yellow("🦆 DuckTape CLI")} — your AI coding buddy, in the terminal.

${C.bold("Usage")}
  ducktape login <token>          Save your token (from <app>/admin/cli-token)
  ducktape ask <question...>      Ask DuckTape anything (uses your shared memory)
  ducktape explain [file]         Explain a file, or piped input
  ducktape whoami                 Show current config
  <command> 2>&1 | ducktape       Pipe an error/log/code and get an explanation

${C.bold("Examples")}
  ducktape ask "why is my login redirect looping"
  ducktape explain src/middleware.ts
  cat error.log | ducktape
  npm run build 2>&1 | ducktape

${C.dim("It shares memory with the DuckTape web app — same project, same bugs, same context.")}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (cmd === "login") {
    const token = argv[1];
    if (!token) { console.error(C.red("Usage: ducktape login <token>")); process.exit(1); }
    const cfg = loadConfig();
    cfg.token = token;
    const urlFlag = argv.indexOf("--url");
    if (urlFlag !== -1 && argv[urlFlag + 1]) cfg.url = argv[urlFlag + 1];
    saveConfig(cfg);
    console.log(C.green("✓ Saved.") + " Try: " + C.bold('ducktape ask "hi"'));
    return;
  }

  if (cmd === "whoami") {
    const { url, token } = getConfig();
    console.log("app url: " + url);
    console.log("token:   " + (token ? token.slice(0, 6) + "…" + token.slice(-4) : C.red("(none)")));
    console.log("config:  " + CONFIG_FILE);
    return;
  }

  if (cmd === "help" || cmd === "--help" || cmd === "-h") { help(); return; }

  if (cmd === "ask") {
    const question = argv.slice(1).join(" ").trim();
    const piped = await readStdin();
    const message = piped ? (question ? question + "\n\n" + piped : piped) : question;
    if (!message) { console.error(C.red("Ask what? e.g. ducktape ask \"how do I fix this\"")); process.exit(1); }
    const d = await call("/cli/chat", { message });
    duckSay(d.text);
    return;
  }

  if (cmd === "explain") {
    const file = argv[1];
    let content = "";
    let hint = "";
    if (file && !file.startsWith("-")) {
      try { content = fs.readFileSync(file, "utf8"); hint = "The user asked to explain the file " + file; }
      catch (e) { console.error(C.red("Can't read " + file + ": ") + (e?.message ?? e)); process.exit(1); }
    } else {
      content = await readStdin();
      hint = "The user piped this into the terminal and wants it explained.";
    }
    content = content.trim();
    if (!content) { console.error(C.red("Nothing to explain. Pass a file or pipe input.")); process.exit(1); }
    const d = await call("/cli/explain", { content, hint });
    duckSay(d.text);
    return;
  }

  // No subcommand: if something was piped, explain it; else help.
  const piped = await readStdin();
  if (piped.trim()) {
    const d = await call("/cli/explain", { content: piped.trim(), hint: "The user piped this into the terminal and wants it explained." });
    duckSay(d.text);
    return;
  }
  help();
}

main();
