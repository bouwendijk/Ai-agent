# Verification — 24 September 2026

## Completed before deployment

- Inspected original Node server, rule-based engine, single-file UI, ZIP export, smoke test, workflow, root Python files, current website and Render logs. Confirmed anonymous upstream HTTP 502 and fallback to local design rules.
- Ten automated Node test cases passed, including ZIP/source parity over home/product/collection/cart/about/contact/search/404, input escaping, generative-provider request memory, retries and quota, cookie encryption, CSRF, OAuth replay/forgery, session isolation, catalog pagination and draft-only upload approval/idempotency.
- Shopify official GraphQL schema validation passed all five operations. Catalog queries executed read-only against the connected Shopify store and returned product media, real variant prices and collections. The independent StoreCrew app has not yet been authorized by this read.
- Shopify theme validator: all 31 generated Liquid/JSON/locale files passed using official bundled schemas. The documentation cache update could not reach GitHub; the validator used its packaged schema fallback. The instrumentation request timed out after validation output; the validation itself completed successfully.
- Local browser access to localhost was blocked by the cloud browser. Interactive tests therefore follow on the existing Render domain.

## External activation gates

- A valid AI provider key/model with quota is required for a real generation and conversational follow-up test. Mock tests are not presented as real AI generation.
- StoreCrew Shopify Client ID/Secret, allowed callback, installation and authorization are required for the independent website import flow.
- Direct upload additionally requires Shopify's Theme API exemption and `write_themes`. No real theme upload/publication was performed during pre-deploy tests.
- Shopify-hosted visual equivalence cannot be asserted before an actual approved unpublished-theme preview is available. The automated guarantee covers common source files and rendered snapshot content.

Post-deployment browser results will be appended after the public release is checked.
