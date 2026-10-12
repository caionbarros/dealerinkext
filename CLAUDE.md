# Repository notes

- Chrome extension, Manifest V3, TypeScript + Vite, no UI framework. Build output in `dist/` (git-ignored).
- Backend is the DealerInk Supabase project (repo caionbarros/dealerink). Database changes go there as migrations, never here.
- PDFs stay on the user's computer. Do not upload documents anywhere without an explicit product decision.
- Every user-facing string lives in `public/_locales/{en,es,pt_BR}/messages.json`; keep the three in sync.
- Before pushing: `npm run build` must pass.
