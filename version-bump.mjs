import fs from "node:fs";

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const versions = JSON.parse(fs.readFileSync("versions.json", "utf8"));

const args = process.argv.slice(2);
const checkTagArg = args.find((arg) => arg.startsWith("--check-tag="));
const normalizedTagVersion = checkTagArg ? checkTagArg.replace("--check-tag=", "").replace(/^v/, "") : null;

if (normalizedTagVersion && packageJson.version !== normalizedTagVersion) {
  throw new Error(
    `Tag version ${normalizedTagVersion} does not match package.json version ${packageJson.version}.`,
  );
}

manifest.version = packageJson.version;
versions[packageJson.version] = manifest.minAppVersion;

fs.writeFileSync("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync("versions.json", `${JSON.stringify(sortObjectKeys(versions), null, 2)}\n`);

function sortObjectKeys(value) {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true })),
  );
}
