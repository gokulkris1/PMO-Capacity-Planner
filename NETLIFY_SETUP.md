Netlify deployment guide for this project

Overview
- This project builds with `npm run build` and outputs a `dist` folder. Upload `dist` to Netlify or connect the repo for CI builds.

Option A — Quick: Drag & Drop (fastest for demo)
1. Run locally: `npm install` then `npm run build`.
2. Open Netlify (app.netlify.com) and from Sites click "Add new site" → "Deploy manually" → Drag-and-drop the `dist` folder.
3. Netlify will give you a live URL (e.g., `https://mystifying-name-12345.netlify.app`).

Option B — GitHub integration (recommended for continuous deploy)
1. Push this repo to GitHub (example commands):

```powershell
# from project root
git init
git add .
git commit -m "Add Netlify deployment files and CI workflow"
git remote add origin <your-git-remote-url>
git branch -M main
git push -u origin main
```

2. In Netlify app: "Add new site" → "Import from Git" → Choose Git provider (GitHub) and authorize Netlify.
3. Select your repository and configure:
   - Branch to deploy: `main`
   - Build command: `npm run build`
   - Publish directory: `dist`
4. Go to Site settings → Build & deploy → Environment → Edit variables and add `API_KEY` (if you want real Gemini responses).
5. Click "Deploy site". Netlify will run the build and provide a URL once finished.

Option C — Use existing GitHub Actions artifact (if you used the provided workflow)
1. After pushing, the workflow `.github/workflows/build.yml` runs on push and uploads a `dist` artifact.
2. In GitHub: Go to Actions → "CI Build" → choose the run → Artifacts → download `dist` → upload to Netlify via drag-and-drop.

Notes & troubleshooting
- If you see build failures on Netlify about Node version, set `NODE_VERSION` in the Netlify UI or add an `.nvmrc` with `18` or configure `engines` in `package.json`.
- Ensure `netlify.toml` exists (it does) with `publish = "dist"`.
- For local testing, run `npm run dev` and open the local server (default Vite port `5173`).

What I can do for you
- If you provide the Git remote URL here, I can push the current workspace to that remote and trigger the GitHub Action.
- I cannot perform the Netlify web UI steps from this environment — you'll get the final Netlify URL after connecting.

If you want me to push, paste the Git remote (HTTPS or SSH) and confirm I should push to `main`.
