# Scheduled Supabase query

`.github/workflows/supabase-query.yml` runs at 00:17, 06:17, 12:17 and 18:17 UTC daily. It uses the GitHub-hosted runner's built-in curl, with no checkout, package installation or extra service.

The request is `GET /rest/v1/meals?select=id&limit=1`: a genuine database SELECT against the existing public `meals` table, returning at most one ID and modifying no data. An empty table is also a successful query. The response body is discarded so meal data is not logged.

## Configure secrets

In the GitHub repository, open **Settings > Secrets and variables > Actions > New repository secret** and add:

| Secret | Value |
| --- | --- |
| `SUPABASE_URL` | Your existing project's HTTPS URL, such as `https://your-project-ref.supabase.co`. Use the project URL, not the PostgreSQL connection string or a URL ending in `/rest/v1`. |
| `SUPABASE_SECRET_KEY` | A server-side `sb_secret_...` API key for the same project, available under Supabase **Settings > API Keys**. This is not the database password or a Supabase personal access token. |

The secret key grants elevated access and bypasses Row Level Security; keep it only in GitHub Actions secrets, never commit it. The workflow itself only sends a GET. The existing Data API must be enabled, expose the public schema, and permit the key's role to SELECT `meals`. No application, schema, policy or Render changes are made by this workflow.

See [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys) and [GitHub Actions secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).

## Verify runs

1. Commit and push the workflow to the repository's default branch; GitHub requires it there for scheduled runs and the manual run button.
2. Open **Actions > Supabase database query > Run workflow**, select the default branch and run it.
3. Open the run's summary and **query > Query one meal** log. Success shows HTTP 200 and a green run. Missing secrets, network/timeouts or other HTTP responses produce an error, a failure summary and a red run. HTTP 401 generally means invalid credentials; HTTP 403 suggests insufficient permissions; HTTP 404 suggests a wrong project URL or a table unavailable through the Data API.
4. After the next scheduled time, check the same workflow's run history for a run triggered by `schedule`. GitHub may delay scheduled runs during high load, so the times are not an exact execution guarantee.

In public repositories, GitHub disables scheduled workflows after 60 days without repository activity; re-enable the workflow from Actions if needed. See [GitHub schedule events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
