# Summa Wiki contributor instructions

## Language

All source code, identifiers, comments, tests, test names, documentation, commit-facing text, and developer-facing diagnostics in this repository must be written in English.

User-facing copy may be localized through the existing internationalization system. Do not hardcode Spanish or any other localized prose in components, API routes, server modules, or shared libraries.

When editing an area that contains legacy non-English developer text, write all new material in English. Translate nearby legacy text when it is directly affected by the change and doing so does not create unrelated churn.

## Verification

Before declaring an implementation complete, run the relevant tests and TypeScript checks. For user-interface changes, also run the production build and inspect the affected flow in a browser when possible.
