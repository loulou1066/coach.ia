# Coach muscu : installation

Prérequis : Node.js 20+ et un compte gratuit sur supabase.com.

1. Supabase : crée un projet. Dans **SQL Editor**, exécute `supabase/schema.sql`, puis `supabase/seed.sql`.
   (Pour tester vite : **Authentication → Providers → Email**, désactive « Confirm email ».)
2. Copie `.env.local.example` en `.env.local` et remplis l'URL et la clé anon (**Settings → API**). Jamais la clé `service_role`.
3. Dans ce dossier : `npm install` puis `npm run dev`, et ouvre http://localhost:3000.
4. Mise en ligne : pousse sur GitHub, importe le dépôt sur vercel.com, ajoute les 2 variables d'environnement.
