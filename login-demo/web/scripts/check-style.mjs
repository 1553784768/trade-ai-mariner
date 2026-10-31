import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const failures = [];
if (/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(readFileSync("src/app/trade.css", "utf8")))
  failures.push("trade.css must use design tokens");
function walk(root) {
  for (const name of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, name.name);
    if (name.isDirectory()) walk(path);
    else if (
      path.endsWith(".tsx") &&
      !path.includes("i18n") &&
      /\p{Extended_Pictographic}/u.test(readFileSync(path, "utf8"))
    )
      failures.push(`${path}: emoji are not permitted`);
  }
}
walk("src");
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("Style constraints passed");
