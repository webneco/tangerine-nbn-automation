Add a root-level README.md (repo root, next to the workflow-automation-engine/ folder) so the GitHub front page isn't empty. Contents:
- Title: Tangerine NBN Portal — Playwright Automation
- One-line description: end-to-end automation of the Tangerine NBN sign-up journey (address → plan → router → checkout with a unique email per run → Till Payments + 3-D Secure → transaction ID)
- A "Quick start" section:
  cd workflow-automation-engine
  npm install
  npx playwright install chromium
  npm run test:tangerine          (headless)
  npm run test:tangerine:headed   (watch it run)
- A link to the full docs: [workflow-automation-engine/README.md](workflow-automation-engine/README.md)
Commit "docs: root README pointing to workflow-automation-engine" and push. Don't change anything else.
