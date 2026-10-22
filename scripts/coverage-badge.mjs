import { readFileSync, writeFileSync } from "node:fs";

const [reportPath, badgePath] = process.argv.slice(2);
if (!reportPath || !badgePath) {
  throw new Error("Usage: node scripts/coverage-badge.mjs <coverage-summary.json> <badge.svg>");
}

const report = JSON.parse(readFileSync(reportPath, "utf8"));
const lines = report.total?.lines;
const percent = lines?.pct;
if (!Number.isFinite(percent) || lines.total <= 0 || percent < 0 || percent > 100) {
  throw new Error("Coverage report has no valid total line coverage");
}

const value = `${percent.toFixed(1)}%`;
const color = percent >= 80 ? "#4c1" : percent >= 60 ? "#97ca00" : percent >= 40 ? "#dfb317" : "#e05d44";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="124" height="20" role="img" aria-label="Line coverage: ${value}">
  <title>Line coverage: ${value}</title>
  <rect width="124" height="20" rx="3" fill="#555"/>
  <path d="M68 0h53a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H68z" fill="${color}"/>
  <g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">
    <text x="34" y="14">coverage</text>
    <text x="96" y="14">${value}</text>
  </g>
</svg>
`;

writeFileSync(badgePath, svg);
