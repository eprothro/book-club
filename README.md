# Book Club

Picks the club's next book. Anyone taps **Start** to open a one-hour window. Each phone submits one book (typed, then confirmed against real covers), and can change it until the window closes. The window closes at the hour, or as soon as all six picks are in. Then the spinner, planking on a rolling office chair in the middle of a circle of covers, spins and stops with her hands pointing at the one book the database drew. Everyone sees the same pick. No logins; the link is enough, and picks are anonymous.

The site is static. GitHub Pages serves it from the `main` branch root at `bookclub.prothro.site` (`CNAME`).

## Before it works

1. In the [Supabase SQL editor](https://supabase.com/dashboard/project/yhiynwocgqskcmldrmyd/sql) for **prothro-apps**, run [`supabase/migrations/20261022230000_bookclub.sql`](supabase/migrations/20261022230000_bookclub.sql) by hand. It is safe to re-run. Do not run it from a deploy.
2. Turn on GitHub Pages: **Settings → Pages → Deploy from branch `main` / `(root)`**. The `CNAME` file already claims `bookclub.prothro.site`.
3. DNS: a CNAME for `bookclub.prothro.site` pointing at `eprothro.github.io`.

Until step 1, the page loads but says it can't reach the club.

## How a round works

| Moment | What happens |
| --- | --- |
| Start | `bookclub_start_round` opens a round with `closes_at = now() + 1 hour`. If one is already open, it returns that one, so two people tapping Start land in the same round. A unique index allows only one open round. |
| Open | Every phone polls `bookclub_get_state` every 4 seconds and shows the countdown (corrected for the phone's clock) and how many of 6 are in. Titles are never sent while the round is open, only the phone's own pick. |
| Submit / change | `bookclub_submit_pick` upserts on (round, phone token). A changed pick keeps its seat. A seventh phone is refused. |
| Close | Lazy, no cron. The first call after the deadline (or the sixth pick) closes the round under a row lock and draws one winner with `gen_random_uuid()` ordering, plus a spin seed. A closed round is never touched again, so nothing re-rolls. |
| Reveal | Every phone gets the same picks in the same order, the winner, and the seed. The seed sets the number of turns and where in the slice her hands land, so the spin is identical everywhere. Each phone plays it once (remembered in `localStorage`), then shows the result. **Replay** replays the same spin. |
| Next | **New round** takes two taps, so a stray tap under the result doesn't end it. Phones still on the result move to the new round on their next poll. |

If nobody submits, the round closes empty and offers **Start again**. With fewer than six, the circle has one slice per book that came in.

## Database

Everything is prefixed `bookclub_`. The three tables (`bookclub_rounds`, `bookclub_picks`, `bookclub_rate_limits`) have row level security on, no policies, and no grants to `anon` or `authenticated` (new public tables need explicit grants as of Oct 30; these deliberately get none). `service_role` gets explicit grants for the dashboard. Helpers live in the `bookclub_private` schema, closed to the API. The browser only calls these `security definer` functions:

| Function | What |
| --- | --- |
| `bookclub_get_state(p_token)` | Current round. Closes and draws it if the hour is up. |
| `bookclub_start_round(p_token)` | Open a round, or return the open one. 30 per 15 minutes per address. |
| `bookclub_submit_pick(p_round_id, p_title, p_author, p_cover_url, p_source_key, p_token)` | Submit or change this phone's pick. Issues a token on first use. 60 per 15 minutes per address. |

The phone token is 64 hex characters from the server; only its SHA-256 is stored. Titles and authors are 1–200 characters, whitespace collapsed, no control characters. Cover URLs must be `https://` on `covers.openlibrary.org`, `books.google.com`, or `books.googleusercontent.com`; anything else is dropped and the book gets a drawn cover.

## Front end

| File | Role |
| --- | --- |
| `index.html`, `css/app.css` | All four views: idle, open, reveal, empty. |
| `js/app.js` | State, polling, countdown, search UI, submit, reveal sequence. |
| `js/covers.js` | Lookup: Open Library and Google Books in parallel, no keys. Either can fail; results with covers first, deduped by title and author. **Use "…"** always offers the typed title. |
| `js/wheel.js` | The circle (SVG) and the spin. Only the spinner moves, one `transform` per frame on one element: a wind-up, a long ease-out, and a little rocking settle. |
| `js/spinner.js` | The spinner illustration, self-contained, from one config. |
| `js/drawn.js` | Typeset cloth covers for books with no cover art. |
| `js/config.js` | Supabase URL and publishable key, seat count, and **`SPINNER`**. |
| `sw.js` | Offline shell. Bump `CACHE` on every deploy that changes a listed file. |

### Changing the spinner

Next month someone else can spin. Edit `SPINNER` in `js/config.js`:

```js
export const SPINNER = {
  hair: "#ecca7e",        // main hair color
  roots: "#8a6338",       // darker roots at the crown
  hairLength: "shoulder", // "short" | "shoulder" | "long"
  skin: "#f5cdae",
  cheeks: "#f0928f",
  eyes: "#3a2a24",
  top: "#d9a3a5",         // sweatshirt
  pants: "#4c6290",
  shoes: "#fbf7ef",
  chair: "#33343b",
  earrings: "#e1b04a",    // or null
  glasses: null,          // or a frame color, e.g. "#3a2a24"
};
```

Shades and highlights are derived from these colors. Then run `node tools/render-images.mjs` to refresh the icons and preview image, and bump `CACHE` in `sw.js`.

Fonts: Fraunces and Outfit, SIL Open Font License (`fonts/OFL.txt`).

## Local preview

```bash
python3 -m http.server 8766
```

Open `http://127.0.0.1:8766/`. It talks to the live Supabase project, so it needs the migration applied there.

## Tests

The tests never touch the live database. They run the migration against a local Postgres that has Supabase's `anon`, `authenticated`, and `service_role` roles, and call every RPC as `anon` the way PostgREST does. Browser tests route the app's Supabase calls to that database.

```bash
sudo apt-get install -y postgresql && sudo service postgresql start
sudo -u postgres psql -c "alter user postgres password 'postgres'"
npm install && npx playwright install --with-deps chromium webkit

node tools/db.mjs          # schema, access rules, lifecycle, one-time draw, races, rate limits
node tools/flows.mjs       # every branch, six phones, chromium and webkit
node tools/keyboard.mjs    # keyboard up: iPhone SE/15 (webkit), small Android/Pixel (chromium)
node tools/record-spin.mjs # frame timing, plus spin.mp4 and spin.gif
```

Set `BOOKCLUB_SHOTS=/some/dir` to save screenshots from `flows.mjs` and `keyboard.mjs`. Open Library responses and covers are cached in `/tmp/bookclub-net-cache` after the first run. Google Books is answered with its usual over-quota error, so the tests cover the Open Library-only path that phones on a shared address will often see.
