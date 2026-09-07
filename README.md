# REGIM

PWA mobile-first pentru evidența expirării perioadei inițiale de carantină a persoanelor private de libertate.

## Regula de business

Regula este unică și nu trebuie modificată:

- ziua depunerii în penitenciar = Ziua 1;
- Ziua 21 = `data_depunerii + 20 zile calendaristice`;
- `data_expirarii` este calculată de PostgreSQL ca generated column;
- în UI datele sunt `DD.MM.YYYY`;
- în PostgreSQL datele de business sunt `DATE` (`YYYY-MM-DD`);
- „azi” este determinat în `Europe/Bucharest`.

Exemplu: depunere `01.09.2026` → Ziua 21 / expirare `21.09.2026`.

## Arhitectură

Frontend:

- TypeScript + Vite;
- GitHub Pages sub `/regim/`;
- hash routing (`#/evidenta`, `#/adauga`, `#/alerte`, `#/setari`) pentru compatibilitate robustă cu GitHub Pages;
- PWA cu manifest și service worker;
- shell static cache-uit; răspunsurile Supabase cu date autentificate nu sunt cache-uite de service worker.

Backend:

- Supabase Auth;
- PostgreSQL;
- Row Level Security;
- triggere PostgreSQL pentru audit și câmpuri de sistem;
- Supabase Edge Functions pentru Web Push;
- `pg_cron` + `pg_net` pentru procesarea periodică a notificărilor;
- Supabase Vault pentru materialul VAPID privat.

## Configurare Supabase

Proiectul cloud folosit de această instanță este `regim`.

Migrațiile din `supabase/migrations/` conțin schema, constrângerile, indexurile, funcțiile, triggerele, granturile și politicile RLS. Pentru un mediu nou:

```bash
supabase link --project-ref <PROJECT_REF>
supabase db push
```

### Auth — obligatoriu înainte de utilizare

În Supabase Dashboard, la Authentication, dezactivează public signup. Aplicația nu oferă UI de Sign Up, Register sau Recovery, dar această setare server-side trebuie dezactivată deoarece GitHub Pages este public.

Conturile se creează exclusiv de administrator din Supabase Dashboard. Pentru fluxul curent, recomandarea este **Create user + email + parolă**, nu signup din aplicație. Utilizatorii invitați din Dashboard sunt marcați activi de trigger, însă acceptarea invitației și alegerea parolei necesită configurarea corectă a linkului/template-ului Auth; aplicația nu expune un flux public de signup. După orice creare de cont, verifică în `public.profiles` că utilizatorul are `active = true`.

În `Authentication → URL Configuration` setează pentru producție:

- Site URL: `https://alin-talfes.github.io/regim/`
- Redirect URL permis: `https://alin-talfes.github.io/regim/`

Recomandat pentru producție:

- activează Leaked Password Protection;
- folosește parole puternice;
- protejează contul de administrator Supabase/GitHub cu MFA.

## RLS și model de acces

Toate tabelele aplicației au RLS activ.

- `ppl`: utilizatorii autentificați și activi pot SELECT/INSERT/UPDATE; nu există grant sau policy de `DELETE`;
- ștergerea normală este soft-delete prin `deleted_at`/`deleted_by`;
- `notification_preferences`: utilizatorul vede/modifică doar propriul rând;
- `push_subscriptions`: utilizatorul vede/modifică/șterge doar propriile abonamente;
- `audit_logs`: server-only, fără write client;
- `notification_log`: server-only, fără write client;
- `profiles`: utilizatorul activ își poate citi doar propriul profil.

`created_by`, `updated_by`, `deleted_by` și timestamp-urile asociate sunt controlate de triggere, nu de browser.

## Web Push / VAPID

Nu introduce niciodată în frontend:

- `service_role` / secret API key;
- VAPID private key;
- parole sau alte secrete.

`push-config` necesită JWT de utilizator și returnează numai cheia VAPID publică. Dacă nu există încă material VAPID, Edge Function îl generează și îl păstrează server-side în Supabase Vault.

`send-quarantine-notifications` este apelată de cron și acceptă doar un token de invocare unic, generat în PostgreSQL și consumabil o singură dată.

Deploy funcții:

```bash
supabase functions deploy push-config
supabase functions deploy send-quarantine-notifications --no-verify-jwt
```

Configurația corespunzătoare este versionată în `supabase/config.toml`.

### Program notificări

Preferințele implicite sunt:

- notificări active;
- Ziua 20, 21 și 22;
- ora `08:00`;
- timezone `Europe/Bucharest`.

Jobul rulează la 5 minute, dar o notificare este trimisă o singură dată pentru combinația `(user_id, ppl_id, quarantine_day, notification_date)`. Abonamentele Web Push invalide (404/410) sunt dezactivate server-side.

Pe iPhone, Web Push necesită instalarea PWA pe Home Screen. Aplicația afișează instrucțiunea doar pe iOS când nu rulează în standalone mode.

## Dezvoltare locală

Cerințe: Node.js modern și npm.

```bash
npm install
npm run dev
```

Teste:

```bash
npm test
npm run typecheck
npm run build
```

Vite este configurat cu `base: '/regim/'`.

## Deploy GitHub Pages

Workflow-ul `.github/workflows/deploy.yml` rulează la fiecare push pe `main`:

1. instalează dependențele;
2. rulează testele de logică a datelor;
3. rulează typecheck + build;
4. publică directorul `dist` prin GitHub Pages.

În GitHub repository settings, Pages trebuie configurat să folosească **GitHub Actions** ca source. Workflow-ul folosește versiunile majore curente ale acțiunilor oficiale GitHub Pages.

URL țintă:

`https://alin-talfes.github.io/regim/`

## PWA și offline

Service worker-ul:

- are scope `/regim/`;
- cache-uiește doar shell-ul și resursele statice same-origin;
- nu interceptează și nu cache-uiește API-urile Supabase;
- folosește network-first pentru navigare;
- elimină cache-urile vechi la activare;
- gestionează `push` și `notificationclick`.

În lipsa conexiunii, aplicația afișează „Fără conexiune” și nu expune datele PPL dintr-un cache local. Nu există offline write queue și nu este simulată salvarea cu succes.

## Structura bazei de date

Tabele principale:

- `profiles`
- `ppl`
- `notification_preferences`
- `push_subscriptions`
- `notification_log`
- `audit_logs`

`ppl.camera` acceptă exclusiv `E1.14`–`E1.25`.

`ppl.situatie_juridica` acceptă exclusiv:

- `arestat_preventiv`;
- `condamnat_definitiv`.

`ppl.data_expirarii` este generated column și nu poate fi stabilită arbitrar de frontend.

## Teste de logică

`src/lib/dates.test.ts` acoperă:

- ziua depunerii = Ziua 1;
- Ziua 19/20/21/22 pentru exemplul obligatoriu;
- `data_depunerii + 20`;
- sfârșit de lună;
- februarie bisect/nebisect;
- sfârșit de an;
- `01092026 → 01.09.2026`;
- `0109 → 01.09`;
- respingerea `31.02.2026` și `29.02.2027`;
- acceptarea `29.02.2028`.

Checklist-ul de securitate este în `tests/security-checklist.md`.

## Observație privind `pg_net`

Supabase instalează `pg_net` ca extensie non-relocatable; Security Advisor poate afișa avertismentul generic „extension in public”. Funcționalitatea folosită de aplicație este `net.http_post`, iar extensia nu poate fi mutată cu `ALTER EXTENSION ... SET SCHEMA` deoarece este marcată `extrelocatable = false`.

## Checklist manual înainte de producție

Aceste setări nu sunt secrete în repository și nu pot fi impuse prin migrații SQL ale aplicației:

1. Supabase `Authentication > Providers > Email`: dezactivează **Allow new users to sign up**.
2. Supabase `Authentication > URL Configuration`: setează Site URL și Redirect URL la `https://alin-talfes.github.io/regim/`.
3. Supabase Auth security: activează **Leaked Password Protection**.
4. GitHub `Settings > Pages`: selectează **GitHub Actions** ca source.
5. Creează primul utilizator administrativ din Dashboard și confirmă că `public.profiles.active = true`.
6. Instalează PWA pe un telefon real și activează Push din Setări pentru a inițializa cheile VAPID în Vault și a valida livrarea end-to-end.
