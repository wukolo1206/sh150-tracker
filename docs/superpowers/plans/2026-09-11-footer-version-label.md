# Footer Version Label Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a visible `第 17 版` label at the bottom of the screen interface so users can identify the deployed version without viewing Git metadata.

**Architecture:** Add one semantic footer element inside the existing `.no-print` screen-only wrapper, with a small reusable CSS class. Keep the version text static and isolated from JavaScript, LocalStorage, weekly data, and the print layout. Add a focused Node regression test that verifies the label text, semantic id, and screen-only placement contract.

**Tech Stack:** HTML5, CSS3, Vanilla JavaScript, Node.js test script, GitHub Pages.

---

### Task 1: Add the failing version-label regression test

**Files:**
- Create: `C:\Users\user\Documents\sh150-tracker\universal-version-label-test.js`
- Read: `C:\Users\user\Documents\sh150-tracker\universal.html`

- [ ] **Step 1: Write the failing test**

Create `universal-version-label-test.js` with this exact content:

```js
const fs = require('fs');

const html = fs.readFileSync('universal.html', 'utf8');
const label = html.match(/<footer\b[^>]*id=["']appVersion["'][^>]*>\s*第 17 版\s*<\/footer>/i);

if (!label) {
  throw new Error('找不到內容為「第 17 版」的 appVersion footer。');
}

if (!/\.no-print\s*\{[^}]*display:\s*none\s*!important\s*;/s.test(html)) {
  throw new Error('找不到列印時隱藏 .no-print 的規則。');
}

console.log('PASS: 頁尾版本標示為第 17 版，且沿用 no-print 列印隱藏規則。');
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `C:\Users\user\Documents\sh150-tracker`:

```powershell
node .\universal-version-label-test.js
```

Expected result before implementation: FAIL with `找不到內容為「第 17 版」的 appVersion footer。`.

### Task 2: Add the footer label and styling

**Files:**
- Backup before modification: `C:\Users\user\Documents\sh150-tracker\universal.html.bak`
- Modify: `C:\Users\user\Documents\sh150-tracker\universal.html:30-37`
- Modify: `C:\Users\user\Documents\sh150-tracker\universal.html:470-474`

- [ ] **Step 1: Back up the current file**

Before editing `universal.html`, copy it to `universal.html.bak` and verify the source and backup SHA-256 hashes are identical. Do not stage the backup file.

- [ ] **Step 2: Add the footer style**

Immediately after the existing `.no-print` rule, add:

```css
.app-version {
    padding: 12px 0 18px;
    color: #64748b;
    font-size: 0.8rem;
    text-align: center;
}
```

- [ ] **Step 3: Add the version footer**

Immediately before the closing `</div>` of the existing top-level `.no-print` wrapper, add:

```html
        <footer class="app-version" id="appVersion" aria-label="系統版本">第 17 版</footer>
```

Do not add a commit hash, JavaScript state, or LocalStorage field.

### Task 3: Verify the implementation and regression safety

**Files:**
- Test: `C:\Users\user\Documents\sh150-tracker\universal-version-label-test.js`
- Verify: `C:\Users\user\Documents\sh150-tracker\universal.html`

- [ ] **Step 1: Run the version-label test**

```powershell
node .\universal-version-label-test.js
```

Expected result: `PASS: 頁尾版本標示為第 17 版，且沿用 no-print 列印隱藏規則。`.

- [ ] **Step 2: Run the existing regression tests**

```powershell
node .\universal-week-autodetect-test.js
& .\universal-static-test.ps1
```

Expected result: both tests pass.

- [ ] **Step 3: Check JavaScript syntax and the diff**

```powershell
@'
const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync('universal.html', 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(m => !/\bsrc\s*=\s*["']/i.test(m[1]))
  .map(m => m[2]);
if (!scripts.length) throw new Error('找不到內嵌 script。');
scripts.forEach((source, index) => new vm.Script(source, { filename: `universal.html:inline-${index + 1}` }));
console.log(`PASS: ${scripts.length} 個內嵌 script 通過語法檢查。`);
'@ | node -
git diff --check
git diff --stat -- universal.html
```

Expected result: JavaScript syntax passes, `git diff --check` exits successfully, and the functional diff is limited to the CSS and footer label.

- [ ] **Step 4: Confirm print isolation**

Confirm `#appVersion` is inside the existing `.no-print` wrapper and that the existing print rule `.no-print { display: none !important; }` remains unchanged. Do not add the label to the printable A4 markup.

### Task 4: Commit and deploy the feature

**Files:**
- Commit: `C:\Users\user\Documents\sh150-tracker\universal.html`
- Keep local only: `universal.html.bak`, `universal-static-test.ps1`, `universal-week-autodetect-test.js`

- [ ] **Step 1: Review the final tracked diff**

```powershell
git status --short --branch
git diff --check
git diff -- universal.html
```

Confirm only the intended footer label and CSS are staged; do not stage backup files or test helpers unless explicitly requested.

- [ ] **Step 2: Commit the source change**

```powershell
git add -- universal.html
git commit -m "feat(universal): show footer version label"
```

- [ ] **Step 3: Push to GitHub Pages source branch**

```powershell
git push origin main
```

- [ ] **Step 4: Verify the public page**

Request `https://wukolo1206.github.io/sh150-tracker/universal.html` with a cache-busting query parameter and confirm HTTP 200 plus the exact text `第 17 版`. Confirm the published HTML still contains the `.no-print` print-hiding rule.
