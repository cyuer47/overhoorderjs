#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const start = process.argv[2] || ".";
const output = process.argv[3] || "file_index.json";
const excludes = new Set(["node_modules", ".git", output, ".DS_Store"]);

function sha256(filePath) {
  try {
    const hash = crypto.createHash("sha256");
    const data = fs.readFileSync(filePath);
    hash.update(data);
    return hash.digest("hex");
  } catch (err) {
    return null;
  }
}

function walk(dir, base) {
  const items = [];
  const files = fs.readdirSync(dir, { withFileTypes: true });
  for (const file of files) {
    if (excludes.has(file.name)) continue;
    const full = path.join(dir, file.name);
    const rel = path.relative(base, full).split(path.sep).join("/");
    if (file.isDirectory()) {
      items.push(...walk(full, base));
    } else if (file.isFile()) {
      const stat = fs.statSync(full);
      items.push({
        path: rel,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        sha256: sha256(full),
      });
    }
  }
  return items;
}

const absStart = path.resolve(start);
const index = walk(absStart, path.resolve("."));
fs.writeFileSync(output, JSON.stringify(index, null, 2), "utf8");
console.log(`Indexed ${index.length} files under ${start} → ${output}`);
console.log("Exclusions:", Array.from(excludes).join(", "));
console.log("Done.");
