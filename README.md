```
ly
├─ backend
│  ├─ package-lock.json
│  ├─ package.json
│  └─ supabase
│     ├─ .branches
│     │  └─ _current_branch
│     ├─ .temp
│     │  ├─ cli-latest
│     │  ├─ gotrue-version
│     │  ├─ pooler-url
│     │  ├─ postgres-version
│     │  ├─ project-ref
│     │  ├─ rest-version
│     │  └─ storage-version
│     ├─ config.toml
│     ├─ deno.lock
│     ├─ functions
│     │  ├─ analyze-pending-agendas
│     │  │  ├─ .npmrc
│     │  │  ├─ contentProcessor.ts
│     │  │  ├─ contentUtils.ts
│     │  │  ├─ deno.json
│     │  │  ├─ deno.lock
│     │  │  ├─ geminiAnalyzer.ts
│     │  │  ├─ index.ts
│     │  │  └─ prompts.ts
│     │  ├─ fetch-new-gazettes
│     │  │  ├─ .npmrc
│     │  │  ├─ databaseUpdater.ts
│     │  │  ├─ deno.json
│     │  │  ├─ gazetteFetcher.ts
│     │  │  └─ index.ts
│     │  ├─ rescue-stuck-analyses
│     │  │  ├─ .npmrc
│     │  │  ├─ deno.json
│     │  │  └─ index.ts
│     │  └─ _shared
│     │     ├─ deno.json
│     │     ├─ types
│     │     │  ├─ analysis.ts
│     │     │  ├─ api.ts
│     │     │  └─ database.ts
│     │     └─ utils.ts
│     └─ migrations
│        └─ 20250429054202_remote_schema.sql
├─ frontend
│  └─ lygazsum
│     ├─ eslint.config.js
│     ├─ index.html
│     ├─ package-lock.json
│     ├─ package.json
│     ├─ public
│     │  └─ vite.svg
│     ├─ README.md
│     ├─ src
│     │  ├─ App.css
│     │  ├─ App.tsx
│     │  ├─ assets
│     │  │  └─ react.svg
│     │  ├─ components
│     │  ├─ index.css
│     │  ├─ main.tsx
│     │  ├─ pages
│     │  │  └─ HomePage.tsx
│     │  ├─ routes.tsx
│     │  ├─ services
│     │  │  ├─ gazetteService.ts
│     │  │  └─ supabaseClient.ts
│     │  ├─ types
│     │  │  └─ supabase.ts
│     │  └─ vite-env.d.ts
│     ├─ tsconfig.app.json
│     ├─ tsconfig.json
│     ├─ tsconfig.node.json
│     └─ vite.config.ts
└─ README.md

```