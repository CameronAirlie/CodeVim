// Cuts a release: bumps the version, turns CHANGELOG.md's "Unreleased" section into
// that version, commits and tags it. Pushing the tag runs the release workflow, which
// publishes to the Marketplace.
//
//   npm run release -- patch|minor|major|<x.y.z> [--dry-run]
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

const REPO = 'https://github.com/CameronAirlie/CodeVim';
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const bump = args.find((a) => !a.startsWith('--'));

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();

if (!bump) fail('usage: npm run release -- patch|minor|major|<x.y.z> [--dry-run]');
if (!dryRun && git('status', '--porcelain')) fail('commit or stash your changes first');

const pkgPath = new URL('../package.json', import.meta.url);
const changelogPath = new URL('../CHANGELOG.md', import.meta.url);
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const current = pkg.version;

function nextVersion() {
  if (/^\d+\.\d+\.\d+$/.test(bump)) return bump;
  const [major, minor, patch] = current.split('.').map(Number);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  if (bump === 'patch') return `${major}.${minor}.${patch + 1}`;
  fail(`unknown bump "${bump}"`);
}
const version = nextVersion();
const tag = `v${version}`;
if (git('tag', '--list', tag)) fail(`tag ${tag} already exists`);

// CHANGELOG: "## [Unreleased]" keeps its heading (empty) and its notes move under the new version.
let changelog = readFileSync(changelogPath, 'utf8');
const unreleased = /^## \[Unreleased\]\s*\n([\s\S]*?)(?=^## \[|^\[Unreleased\]:)/m.exec(changelog);
if (!unreleased || !unreleased[1].trim()) fail('CHANGELOG.md has nothing under "## [Unreleased]"');
const date = new Date().toISOString().slice(0, 10);
changelog = changelog.replace(unreleased[0], `## [Unreleased]\n\n## [${version}] - ${date}\n\n${unreleased[1].trim()}\n\n`);

// Link references at the bottom.
const previous = git('tag', '--list', 'v*', '--sort=-v:refname').split('\n').filter(Boolean)[0];
changelog = changelog.replace(/^\[Unreleased\]:.*$/m, `[Unreleased]: ${REPO}/compare/${tag}...HEAD`);
const versionLink = previous ? `${REPO}/compare/${previous}...${tag}` : `${REPO}/releases/tag/${tag}`;
changelog = changelog.replace(/^(\[Unreleased\]:.*)$/m, `$1\n[${version}]: ${versionLink}`);

if (dryRun) {
  console.log(`would release ${current} -> ${version} (${tag})\n`);
  console.log(changelog);
  process.exit(0);
}

pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
writeFileSync(changelogPath, changelog);
git('add', 'package.json', 'CHANGELOG.md');
git('commit', '-m', `chore(release): ${tag}`);
git('tag', '-a', tag, '-m', tag);
console.log(`released ${tag}. Push it to publish:\n  git push --follow-tags`);
