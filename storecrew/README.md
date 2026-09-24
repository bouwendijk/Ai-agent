# StoreCrew Studio 2

A Dutch design workspace for creating and refining Shopify themes with authenticated generative AI. Run with Node 22+; no runtime package installation required.

```sh
node storecrew/server.mjs
npm test --prefix storecrew
```

Existing deployment: https://storecrew-ai-studio.onrender.com, GitHub branch `storecrew-studio-v1`. Render runs `node storecrew/server.mjs`. No extra paid infrastructure was provisioned.

## One-time owner configuration

Use the existing service's [Render environment settings](https://dashboard.render.com/web/srv-dapu4io473hc73c98h3g/env). Do not put secrets in a project, theme, commit or chat message. `.env.example` lists the settings; Node does not load it automatically.

- `PUBLIC_URL`: `https://storecrew-ai-studio.onrender.com`.
- `STORECREW_SESSION_SECRET`: random, at least 32 characters, stable across deploys. Encrypts HttpOnly session/OAuth cookies and approval tokens.
- `GEMINI_API_KEY`: an owner-provided Gemini API key. `GEMINI_MODEL` chooses a model supporting JSON generation. Alternatively configure `AI_API_KEY`, `AI_BASE_URL` (HTTPS, ending at the versioned API root), and `AI_MODEL` for a JSON-capable OpenAI-compatible chat API. Generic provider compatibility is not a promise that every model supports the same parameters.
- `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET`: the Client ID and Client Secret of the **StoreCrew app**, not credentials from the ChatGPT Shopify connection. App URL: the public URL above. Allowed redirect URL: `https://storecrew-ai-studio.onrender.com/auth/shopify/callback`. Configure a standalone, non-embedded app and distribution appropriate to the shop. Install/authorize from the Shopify button inside StoreCrew.
- Base scope: `read_products`. No access to customers, orders or payments is requested.

After saving, redeploy and open AI status to check configuration. `/health` exposes only boolean configuration status and build version. A configured key still needs an actual successful model request to confirm validity and quota.

## Costs and availability

StoreCrew adds no usage fee. The existing Render free service can sleep and has no SLA. Gemini offers free capacity for eligible models/accounts subject to provider limits; paid keys are billed by the provider. No billing plan is activated by this application. Check [current Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), model availability, regional eligibility and data terms before enabling a key. Free-tier prompts may be used by Google to improve products. ChatGPT subscriptions do not supply this server with an API entitlement.

Default application capacity is 100 **provider attempts** per UTC day, two concurrent generations, six generation submissions per session per minute. Change `AI_DAILY_REQUEST_LIMIT` to match available capacity. The counter is in process memory and resets on a restart; it is an operational limit, **not a hard monetary spending cap**. Set a provider-side quota/budget, especially on a public URL with a paid key. Retries count. There is no fixed lifetime refinement limit; provider quota, available capacity and browser storage remain finite.

Authenticated requests have timeouts, one repair/retry per configured provider, cooldowns and clear errors. There is no anonymous upstream and no rule-based fallback pretending to be AI. Without a valid key, manual design editing, preview, version history and ZIP export work; AI generation is explicitly unavailable.

## Design and conversation memory

The provider receives the current design, the compact brand brief, the latest 40 messages and catalog context. It proposes a complete validated design with layouts, typography, color tokens, original copy, navigation, section order and real product selections. Seven native Shopify section types support hero, products, collections, story, statement, features and FAQ. This is structured design generation; arbitrary AI JavaScript is never executed.

All messages, versions, drafts, the brief and imported catalog persist in IndexedDB **on the current browser/device**. Each successful refinement creates a new version. Manual changes and restores revoke approval. Download a project JSON to back up or transfer devices. Deleting browser data removes local projects. Pending jobs, preview documents and temporary ZIP sources live in memory and expire; a restart can interrupt a pending job but does not erase locally saved projects. There is no server database or cross-device sync fee.

## Preview and Shopify export

`theme.mjs` compiles one set of native Liquid/JSON theme files. `preview.mjs` renders those exact files with vendored LiquidJS and the imported snapshot. ZIP export uses the same compiler and a SHA-256 digest. Tests unzip the archive and re-render every supported route, asserting identical generated HTML. There is no separately authored preview layout.

The exported theme includes home, product variants/gallery, collections, cart, search, 404, generic page/contact templates, and theme-contained about/contact views (`/?view=about`, `/?view=contact`). These alternate index templates do not create or overwrite Shopify pages. Product forms and cart use Shopify's native endpoints. The preview simulates cart interactions; it does not place orders or send contact messages.

**Limits of parity:** the local renderer adapts native Shopify forms/pagination and cannot execute Shopify platform code, app embeds, Markets or checkout. Shopify uses current products, policies, inventory and shop content; preview uses the most recently imported snapshot and default currency. Product publication, collection sorting, tax/discount/app behavior and native theme editor changes can differ. Preview/export **source parity is verified**; pixel-perfect parity with a live Shopify runtime requires reviewing the exact unpublished theme in that shop. Do not describe a local screenshot as a Shopify-hosted preview.

Catalog import reads active online-store products, media, variants and collections with pagination. Bounded at 1,000 products, 250 collections, 100 variants/20 media per product and 100 product references per collection. Larger nested records are marked partial, surfaced in the review. Existing product facts/prices are not written or invented. No products or orders are created.

## Theme approval and Shopify permissions

Every exact design/catalog combination requires the review checkbox before ZIP download. The approval is encrypted, session bound, expires in one hour and becomes invalid if design, shared theme files or catalog changes. Direct upload needs an additional explicit checkbox for **a new unpublished theme**.

Shopify's [themeCreate documentation](https://shopify.dev/docs/api/admin-graphql/latest/mutations/themeCreate) requires `write_themes` and a Shopify-approved Theme API exemption. A scope alone does not prove exemption. Follow Shopify's exemption application linked from that official page for the particular app's Client ID; approval cannot be granted by StoreCrew. The separate ChatGPT connector's permissions do not establish this app's permissions.

Keep `SHOPIFY_THEME_UPLOAD_ENABLED=0` unless the exemption has been granted. After approval, set it to `1`, add `read_themes,write_themes` to the app configuration, and reauthorize StoreCrew to obtain those scopes. Upload rereads granted permissions, creates a temporary random ZIP URL and calls only `themeCreate(role: UNPUBLISHED)`. It verifies the returned role and processing result and provides the actual Shopify preview/editor links. The same approval ID cannot cause a second upload during its lifetime in the same process. On ambiguous timeout/restart, check the Shopify theme library before trying again.

**There is no publish, update-existing-theme or delete-theme endpoint.** Existing live themes, products and pages are never modified by this app. ZIP fallback is available without theme scopes. Upload a ZIP manually to the theme library and review the unpublished copy; publication remains a merchant action.

## Security and verification

OAuth checks shop hostname, one-use state, signed callback HMAC, timestamp and session binding. Secrets stay on the server. Shopify tokens are encrypted in Secure/HttpOnly/SameSite cookies with a maximum 24-hour lifetime; plaintext tokens never enter client scripts or backups. CSRF checks origin plus a session token on every POST. Preview is session-bound and sandboxed without same-origin privileges. CSP and strict static paths prevent access to server files. Logs contain event codes, not keys or prompts.

`npm test --prefix storecrew` tests byte-identical ZIP contents/rendering, malicious input, provider memory/repair/failure paths, session isolation, OAuth forgery/replay, CSRF, approval invalidation, real catalog field mapping/pagination and draft-only upload idempotency. Provider/OAuth/upload tests use explicitly mocked transports; they are not evidence of live external authorization. Live UI/actual external checks are recorded in `VERIFICATION.md`.

## Third-party assets

- LiquidJS 10.29.0, MIT, vendored browser ES module; license in `vendor/LIQUIDJS-LICENSE`.
- Example editorial photograph by [Preslav Rachev on Unsplash](https://unsplash.com/photos/a-chair-sits-near-a-window-and-shadow-ceRTU7gOAtI), downloaded under the Unsplash license. The default is an example design, not actual store inventory. Generated themes reference hosted imagery; keep the StoreCrew image URL available or replace the sample with merchant media. No fake product/review imagery is generated.
