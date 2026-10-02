# Import Recipe from URL

In Admin, choose **Import Recipe from URL**, enter a public HTTP(S) recipe page, and click **Preview Recipe**. Review the resulting draft in the existing meal form, then click **Save Meal** only when you want it added to the catalog.

Previewing and cancelling do not save anything. Saving uses the existing `POST /api/meals` endpoint. If development and production use the same `DATABASE_URL`, saved meals appear in both versions.

## Supported pages and mapping

The importer reads [Schema.org Recipe](https://schema.org/Recipe) JSON-LD metadata, including arrays, graphs, and nested instruction sections. Pages without structured recipe metadata, login-only pages, and sites that block requests produce an error; use manual entry for those pages.

- Name, description, image, cook time, ingredients, and instructions map to the existing meal fields.
- ISO cook durations become minutes. Total time is not silently substituted for cook time.
- Clear leading ingredient quantities and common units are separated into amount and name. Ambiguous quantities remain in the original text for review. Ingredient categories default to `other`.
- Difficulty defaults to `Easy`. Unclear or missing serving counts default to `4`, with a warning.
- Missing required fields must be completed in the form. Utensils start empty.
- The source link is available during review. Source URLs, nutrition, and recipe categories are not persisted because the current model has no corresponding fields.

The preview endpoint (`POST /api/recipes/import-preview`, body `{ "url": "https://..." }`) has no database dependency. It returns `{ draft, sourceUrl, warnings }`. Fetching allows only public destinations on standard HTTP(S) ports, checks every redirect, pins the resolved IP, limits redirects to three, limits HTML to 2 MiB, and applies a 15-second request deadline. Compressed responses are not accepted. At most three extractions run concurrently per server process.

## Verification without Supabase writes

```sh
npx tsx --test server/recipe-import.test.ts
npm run build
npm run check
```

Tests use fixture HTML, mocked network requests, and an isolated Express preview endpoint. They do not load the database module or write to Supabase. Do not launch the normal server merely for isolated tests: its existing startup code connects to the database and may seed an empty meals table.

Manual browser checks can use an isolated app with in-memory meal endpoints. Before testing against the normal app, remember that **Save Meal writes to the configured database**.

The repository currently has pre-existing TypeScript errors in admin CSV exception handling and database/meal-plan code. These are separate from the importer. No migrations or new environment variables are required.
