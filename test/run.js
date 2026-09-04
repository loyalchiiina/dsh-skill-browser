// Standalone test for dsh-skill-browser scan/categorize logic.
// Usage: node test/run.js <skillRoot>   (skill root is a required argument)
import { scanSkills, categoriesMeta, readSkillBody, parseFrontmatter, categorize } from "../lib/scan.js";
import { ZH } from "../lib/zh.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

var root = process.argv[2] || join(homedir(), ".dsh", "skills");
if (!existsSync(root)) {
  console.error("skill root not found: " + root);
  process.exit(1);
}

var skills = scanSkills(root, ZH);
console.log("root: " + root);
console.log("total skills: " + skills.length);

// per-category counts in CATS order
var meta = categoriesMeta();
var counts = {};
for (var s of skills) counts[s.cat] = (counts[s.cat] || 0) + 1;
console.log("\n== categories ==");
for (var c of meta) {
  if (!counts[c.id]) continue;
  var subIds = (c.subs || []).map(function (x) { return x.id; });
  console.log("  " + c.id + " (" + c.label + "): " + counts[c.id] + (subIds.length ? "  subs=" + subIds.join(",") : ""));
}
var knownCats = new Set(meta.map(function (x) { return x.id; }));
for (var k in counts) {
  if (!knownCats.has(k)) console.log("  !! unexpected category: " + k + " (" + counts[k] + ")");
}

// fluent sub-category breakdown
console.log("\n== fluent sub breakdown ==");
var subCounts = {};
for (var s2 of skills) if (s2.cat === "fluent") subCounts[s2.sub || "_"] = (subCounts[s2.sub || "_"] || 0) + 1;
console.log("  " + JSON.stringify(subCounts));

// skills without zh description
var noZh = skills.filter(function (x) { return !x.zh; });
console.log("\n== skills without zh description: " + noZh.length + " ==");
for (var n of noZh) console.log("  - " + n.dir + (n.desc ? "" : "  [also no frontmatter desc!]"));

// every skill must have a frontmatter name equal to dir (naming hard rule)
var badName = skills.filter(function (x) { return x.name !== x.dir; });
console.log("\n== frontmatter name != dir: " + badName.length + " ==");
for (var b of badName) console.log("  - " + b.dir + " (name=" + b.name + ")");

// detail read smoke test
if (skills.length) {
  var body = readSkillBody(root, skills[0].dir);
  console.log("\nreadSkillBody('" + skills[0].dir + "') -> " + (body ? body.length + " chars" : "NULL"));
  console.log("readSkillBody('..%2fetc') -> " + readSkillBody(root, "..%2fetc"));
}

// frontmatter parser edge cases
console.log("\n== parser edge cases ==");
var fm1 = parseFrontmatter('---\nname: a\ndescription: >\n  line one\n  line two\n 触发词：x\n---');
console.log("  folded: " + JSON.stringify(fm1.description));
var fm2 = parseFrontmatter('---\ndescription: "quoted text" \n---');
console.log("  quoted: " + JSON.stringify(fm2.description));
console.log("\ncategorize('fluent-meshing-automation') = " + JSON.stringify(categorize("fluent-meshing-automation")));
console.log("categorize('geometry-backup') = " + JSON.stringify(categorize("geometry-backup")));
console.log("categorize('spaceclaim-stirrer-tank-naming') = " + JSON.stringify(categorize("spaceclaim-stirrer-tank-naming")));
console.log("categorize('dsh-plugin-development') = " + JSON.stringify(categorize("dsh-plugin-development")));
console.log("categorize('totally-unknown') = " + JSON.stringify(categorize("totally-unknown")));
