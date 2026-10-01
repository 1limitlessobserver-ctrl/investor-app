# Build environment notes (sub-project 1)

These notes describe how this repository is built during the MOBILE-02 sessions. They are
operational, not product rules; `CLAUDE.md` holds the product rules.

## Where things run

- **Development, tests and builds** run in the cloud workspace (`/home/claude/investor-app`,
  Linux, Node 22). Its network egress does **not** include `registry.npmjs.org`, so `npm install`
  cannot run there.
- **Dependency installs** run on the owner's PC (Windows, Node 24, full network) in
  `C:\Users\ALIENWARE\Desktop\oo\investor-app-deps` with Linux-targeted binaries, then the
  resulting `node_modules` is archived, transferred and unpacked in the workspace:

  ```powershell
  cd C:\Users\ALIENWARE\Desktop\oo\investor-app-deps
  npm install --os=linux --cpu=x64 --libc=glibc --ignore-scripts --no-audit --no-fund
  tar.exe -czf node_modules.tgz node_modules package-lock.json
  ```

  then in the workspace: extract, `chmod +x node_modules/.bin/*` and the esbuild binary.
  **Any change to `package.json` dependencies must be mirrored to the PC's copy and the
  archive re-made**; never edit `package-lock.json` by hand in the workspace.
- **Browsers**: Playwright Chromium build 1194 is preinstalled in the workspace
  (`/opt/pw-browsers`), matching `@playwright/test` 1.56. WebKit is not available in the
  workspace; the `phone-webkit` project runs in CI only (`npx playwright test --project=phone-chromium --project=desktop-chromium` locally).
- **Git**: commits are made in the workspace. The workspace cannot push. Pushes go through the
  owner's PC, where `gh` is signed in: the workspace writes `git bundle create … --all` to the
  shared folder, and the PC's bare mirror `C:\Users\ALIENWARE\Desktop\oo\investor-app.git`
  fetches the bundle and pushes (`git fetch <bundle> "+refs/heads/*:refs/heads/*"`, then
  `git push origin --all`). Pull requests are opened with `gh pr create --repo
  1limitlessobserver-ctrl/investor-app`.
- **Library docs**: the Context7 connector is not signed in; confirm an API against the
  installed package's `README.md` and type declarations in `node_modules` before first use.

## Versions installed (2026-10-01)

vite 8.3.2 · react 19.3.0 · react-router 7.18.4 · @tanstack/react-query 5.104.0 ·
vitest 5.0.3 · @playwright/test 1.56.1 · vite-plugin-pwa 1.3.0 · radix-ui 1.6.7 ·
recharts 3.10.1 · pdfmake 0.2.23 · sharp 0.35.5 · typescript 5.9.3 · zod 3.25.76 ·
eslint 9.39.5 · eslint-plugin-react-hooks 7.1.1 · jsdom 27.4.0 · @lhci/cli 0.13.0
