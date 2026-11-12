// selfupdate.js - shared "is there a newer version / install it" service.
//
// WHY ONE CENTRAL SERVICE INSTEAD OF 13 COPIES
// Every UI plugin in this family ships its own host half, but they all run in the
// same host process and are served from the same origin. Implementing the check
// 13 times would mean 13 code paths to keep in sync and 13 chances to get the
// npm/pnpm invocation wrong. So the logic lives here once, and dsh-skill-browser
// (the plugin that owns the settings "悬浮球导航" section and is always installed
// alongside the rest) exposes it as:
//
//   GET  /dsh-skill-browser/plugin-update?pkg=<name>
//   POST /dsh-skill-browser/plugin-update-apply?pkg=<name>
//   GET  /dsh-skill-browser/plugin-update-log
//
// Each plugin's own panel then shows one line: "当前 vX · 检查更新", calling the
// root-relative URL above. The user sees a button per plugin; the code is shared.
//
// HARD RULES (each one is a bug we refuse to ship)
// 1. npm registry first (npmmirror, then npmjs). Users install from npm, so npm is
//    the version that actually exists for them.
// 2. link:/file: installs are refused: those are local development copies and an
//    npm install would overwrite the working tree.
// 3. profile package.json is backed up before any write; installs run with
//    windowsHide (this family must never show a console window).
// 4. Never restart DSH: host code only reloads on a full app restart, so every
//    response carries needRestart and the UI states it in plain words.
// 5. Registry answers are cached 10 minutes; repeated panel opens must not hammer npm.

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { get as httpsGet } from "node:https";

var CACHE_TTL_MS = 10 * 60 * 1000;
var CACHE = {};          // pkg -> { at, latest, registry }
var LAST_LOG = "";
var APPLYING = {};

function readJsonFile(file, dflt) {
  try {
    var raw = readFileSync(file, "utf8");
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    return JSON.parse(raw);
  } catch (e) { return dflt; }
}

function getJson(url, timeoutMs) {
  return new Promise(function (resolve) {
    var req = httpsGet(url, { headers: { accept: "application/json", "user-agent": "dsh-plugin-selfupdate" } }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(getJson(res.headers.location, timeoutMs));
      }
      var chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () {
        if (res.statusCode !== 200) return resolve({ ok: false, error: "HTTP " + res.statusCode });
        try { resolve({ ok: true, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }); }
        catch (e) { resolve({ ok: false, error: "bad json" }); }
      });
    });
    req.on("error", function (e) { resolve({ ok: false, error: String(e && e.message || e) }); });
    req.setTimeout(timeoutMs || 8000, function () { try { req.destroy(); } catch (e) {} resolve({ ok: false, error: "timeout" }); });
  });
}

export function compareVer(a, b) {
  var norm = function (v) {
    return String(v || "").replace(/^v/i, "").split(/[.+-]/).map(function (x) { return parseInt(x, 10) || 0; });
  };
  var pa = norm(a), pb = norm(b);
  for (var i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    var d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// Candidate install roots, most specific first. The aggregate suite copy wins over
// npm's hoisted copy because that is what the running process actually loaded.
function pkgRootCandidates(pkgName) {
  var out = [];
  var home = homedir();
  var profiles = ["desktop", "xiufu", "web"];
  profiles.forEach(function (pf) {
    out.push(join(home, ".dsh", "profiles", pf, "node_modules", pkgName));
    out.push(join(home, ".dsh", "profiles", pf, "node_modules", "dsh-loyalchiiina-plugin-pack", "node_modules", pkgName));
  });
  out.push(join(home, ".dsh", "local-plugins", "dsh-loyalchiiina-suite", "node_modules", pkgName));
  out.push(join(home, ".dsh", "local-plugins", pkgName));
  return out;
}

export function resolvePkgRoot(pkgName) {
  var cands = pkgRootCandidates(pkgName);
  for (var i = 0; i < cands.length; i++) {
    if (existsSync(join(cands[i], "package.json"))) return cands[i];
  }
  return "";
}

function localVersion(pkgRoot, fallback) {
  var pj = pkgRoot ? readJsonFile(join(pkgRoot, "package.json"), null) : null;
  return (pj && pj.version) ? String(pj.version) : String(fallback || "0.0.0");
}

// Is this package a real npm dependency of a profile, or a local link/file copy?
// The profile package.json is the only reliable witness; node_modules alone looks
// identical in both cases.
export function detectInstall(pkgName) {
  var cands = [];
  try {
    var home = homedir();
    ["desktop", "xiufu", "web"].forEach(function (pf) {
      cands.push(join(home, ".dsh", "profiles", pf, "package.json"));
    });
  } catch (e) { /* ignore */ }
  for (var j = 0; j < cands.length; j++) {
    var pj = readJsonFile(cands[j], null);
    if (pj && pj.dependencies && Object.prototype.hasOwnProperty.call(pj.dependencies, pkgName)) {
      var spec = String(pj.dependencies[pkgName] || "");
      var isLocal = spec.indexOf("link:") === 0 || spec.indexOf("file:") === 0 || spec.indexOf(".") === 0 || spec.indexOf("/") === 0 || spec.indexOf("local-plugins") >= 0;
      return { installType: isLocal ? "local" : "registry", depSpec: spec, profileFile: cands[j], profileDir: dirname(cands[j]) };
    }
  }
  // Sub-plugins of the aggregate pack are not direct profile dependencies: the
  // profile depends on dsh-loyalchiiina-plugin-pack, whose own dependencies carry
  // the sub-plugin versions. Without this branch every bundled plugin reports
  // "unknown", which is exactly the confusing answer we want to avoid.
  var PACK = "dsh-loyalchiiina-plugin-pack";
  for (var k = 0; k < cands.length; k++) {
    var pjp = readJsonFile(cands[k], null);
    if (pjp && pjp.dependencies && Object.prototype.hasOwnProperty.call(pjp.dependencies, PACK)) {
      var packSpec = String(pjp.dependencies[PACK] || "");
      var packDir = join(dirname(cands[k]), "node_modules", PACK);
      var packPj = readJsonFile(join(packDir, "package.json"), null);
      if (packPj && packPj.dependencies && Object.prototype.hasOwnProperty.call(packPj.dependencies, pkgName)) {
        var subSpec = String(packPj.dependencies[pkgName] || "");
        var packLocal = packSpec.indexOf("link:") === 0 || packSpec.indexOf("file:") === 0 || packSpec.indexOf(".") === 0 || packSpec.indexOf("/") === 0 || packSpec.indexOf("local-plugins") >= 0;
        return {
          installType: packLocal ? "bundle-local" : "bundle",
          depSpec: subSpec, packSpec: packSpec, packDir: packDir,
          profileFile: cands[k], profileDir: dirname(cands[k])
        };
      }
    }
  }
  return { installType: "unknown", depSpec: "", profileFile: "", profileDir: "" };
}

async function fetchLatest(pkgName) {
  var cached = CACHE[pkgName];
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return { ok: true, latest: cached.latest, registry: cached.registry };
  var registries = ["https://registry.npmmirror.com", "https://registry.npmjs.org"];
  var lastErr = null;
  for (var i = 0; i < registries.length; i++) {
    var url = registries[i] + "/" + pkgName.replace("/", "%2f") + "/latest";
    var r = await getJson(url, 8000);
    if (r.ok && r.body && r.body.version) {
      var latest = String(r.body.version);
      CACHE[pkgName] = { at: Date.now(), latest: latest, registry: registries[i] };
      return { ok: true, latest: latest, registry: registries[i] };
    }
    lastErr = r.error || "no version";
  }
  return { ok: false, error: lastErr || "registry unreachable" };
}

function backupProfile(profileFile) {
  try {
    if (!profileFile || !existsSync(profileFile)) return "";
    var dir = join(homedir(), ".dsh", "backups");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    var stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);
    var dst = join(dir, "selfupdate-" + stamp + "-" + profileFile.split(/[\\/]/).pop());
    copyFileSync(profileFile, dst);
    return dst;
  } catch (e) { return ""; }
}

export async function checkUpdate(pkgName) {
  var root = resolvePkgRoot(pkgName);
  if (!root) return { ok: false, error: "找不到该插件的安装目录：" + pkgName };
  var current = localVersion(root, "0.0.0");
  var install = detectInstall(pkgName);
  var r = await fetchLatest(pkgName);
  if (!r.ok) return { ok: false, error: r.error, name: pkgName, current: current, installType: install.installType };
  return {
    ok: true, name: pkgName, current: current, latest: r.latest,
    hasUpdate: compareVer(r.latest, current) > 0,
    installType: install.installType, depSpec: install.depSpec,
    source: r.registry, needRestart: true,
    note: install.installType === "local"
      ? "本地开发版（" + (install.depSpec || "link") + "），npm 安装会覆盖本地改动，按钮只提示不覆盖"
      : install.installType === "bundle-local"
        ? "随套件安装的本地开发版（套件 " + (install.packSpec || "link") + "），更新请改源码后重新发布"
        : install.installType === "bundle"
          ? "随套件安装（" + (install.depSpec || "") + "），点更新会升级套件里这个插件的版本"
          : (install.installType === "registry" ? "npm 安装，可一键更新" : "未在 profile 依赖中找到，可能随聚合包统一管理")
  };
}

export async function applyUpdate(pkgName) {
  if (APPLYING[pkgName]) return { ok: false, error: "该插件已有一个更新在跑，请稍候" };
  var install = detectInstall(pkgName);
  if (install.installType === "local" || install.installType === "bundle-local") {
    return {
      ok: false, refused: install.installType,
      error: "本地开发版（" + (install.depSpec || "link") + "），不做 npm 覆盖安装。",
      hint: "发布新版到 npm 后，把 profile 依赖改成 registry 版本，这个按钮就能真装。"
    };
  }
  if (install.installType === "unknown") return { ok: false, error: "未在 profile 依赖中找到该插件，无法确定安装位置" };
  var r = await fetchLatest(pkgName);
  if (!r.ok) return { ok: false, error: "查询最新版失败：" + r.error };
  var current = localVersion(resolvePkgRoot(pkgName), "0.0.0");
  if (compareVer(r.latest, current) <= 0) return { ok: true, upToDate: true, current: current, latest: r.latest };
  var backup = backupProfile(install.profileFile);
  APPLYING[pkgName] = true;
  if (install.installType === "bundle") {
    // The sub-plugin is not a profile dependency; the pack pins it. Bump the pin
    // inside the pack's own package.json, then let pnpm reconcile node_modules.
    var bump = bumpPackDependency(install.packDir, pkgName, r.latest);
    if (!bump.ok) { APPLYING[pkgName] = false; return { ok: false, error: bump.error, backup: backup }; }
    var rb = await runPm("pnpm", ["install"], install.packDir);
    APPLYING[pkgName] = false;
    LAST_LOG = rb.log || "";
    return {
      ok: rb.ok, from: current, latest: r.latest, packageManager: "pnpm",
      via: "bundle", packBackup: bump.backup, needRestart: true, backup: backup,
      log: LAST_LOG.slice(-4000),
      error: rb.ok ? undefined : "套件安装失败，见日志"
    };
  }
  var spec = pkgName + "@" + r.latest;
  var dir = install.profileDir;
  var r1 = await runPm("pnpm", ["add", spec], dir);
  var used = "pnpm", log = r1.log;
  if (!r1.ok) {
    var r2 = await runPm("npm", ["install", spec, "--no-audit", "--no-fund"], dir);
    used = "npm"; log = r2.log;
    if (!r2.ok) {
      APPLYING[pkgName] = false;
      LAST_LOG = String(r1.log || "") + "\n----\n" + String(r2.log || "");
      return { ok: false, error: "安装失败，见日志", log: LAST_LOG.slice(-4000), backup: backup };
    }
  }
  APPLYING[pkgName] = false;
  LAST_LOG = log || "";
  return {
    ok: true, from: current, latest: r.latest, packageManager: used,
    installedOnDisk: guessDiskVersion(dir, pkgName) || r.latest,
    needRestart: true, backup: backup, log: LAST_LOG.slice(-4000)
  };
}

// Rewrite only the one dependency line inside the pack's package.json, keeping the
// rest of the file byte-identical (indent, key order). Returns a backup path.
function bumpPackDependency(packDir, pkgName, latest) {
  try {
    var file = join(packDir, "package.json");
    var raw = readFileSync(file, "utf8");
    var re = new RegExp('("' + pkgName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '"\\s*:\\s*")([^"]*)(")');
    if (!re.test(raw)) return { ok: false, error: "套件 package.json 里没有该插件依赖" };
    var dir = join(homedir(), ".dsh", "backups");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    var stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);
    var bak = join(dir, "selfupdate-pack-" + stamp + "-package.json");
    copyFileSync(file, bak);
    var next = raw.replace(re, function (m, a, v, c) { return a + "^" + latest + c; });
    writeFileSync(file, next, "utf8");
    return { ok: true, backup: bak };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

export function lastLog() { return LAST_LOG || "(暂无日志)"; }

function guessDiskVersion(profileDir, pkgName) {
  try {
    var pj = readJsonFile(join(profileDir, "node_modules", pkgName, "package.json"), null);
    return pj && pj.version ? String(pj.version) : "";
  } catch (e) { return ""; }
}

function runPm(cmd, args, cwd) {
  return new Promise(function (resolve) {
    execFile(cmd, args, {
      cwd: cwd || undefined,
      windowsHide: true,
      timeout: 180000,
      maxBuffer: 8 * 1024 * 1024,
      shell: process.platform === "win32"
    }, function (err, stdout, stderr) {
      resolve({ ok: !err, log: String(stdout || "") + String(stderr || "") });
    });
  });
}