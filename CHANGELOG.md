# Changelog

All notable changes, grouped by the type of their [Conventional Commit](https://www.conventionalcommits.org/).
Set a new version with `node scripts/set-version.js <version>` and move the entries of "Unreleased" under it.

## Unreleased

Maintenance review (docs/maintenance-review.md): bugs, server-side rules, CI, single sources of truth, tests and refactorings.

### Fixes

- green verify again (user guide TOC, unused e2e argument) (496b982)
- **runs:** a failed result write ends the run FAILED, long topics are cut (a8baccb)
- check enum values, numeric limits and broker variables on the server (9161236)
- **subscribe:** testers can only delete their own saved messages (b233ecf)
- **subscribe:** 4xx instead of 500 for unknown, inactive or unreachable brokers (c4bfe31)
- **agent:** report skipped messages, repetitions and up to 25 real failures (33f262f)
- **solace:** dispose dropped sessions, time out a queue bind that never answers (5bd5b1d)
- **subscribe:** a heartbeat per subscription instead of keeping all alive (4eba3ea)
- **ui:** export of unsaved drafts only, run dialog total, smaller UI bugs (b88f001)
- **db:** no orphaned stats, one username length, run order stored, unique range names (5cca662)

### Refactoring

- **ui:** one app catalog (app/_shared/Apps.js) for Home, Help and navigation (522167b)
- **cds:** result types of TestService and the agent service defined once (4d7b60d)
- column lengths come from the model wherever text is cut (474e687)
- one list of test case fields for export, import, agent and checks (71fc969)
- one way to push live events, aem- loggers, comments that match (135ddca)
- errMsg and req.reject throughout, template names that fit (df0a3cb)
- keys through lib/request.ts, one case-insensitive name rule (8b33008)
- **agent:** runTests relies on startRun; outcome CDS = runOutcome tested (4a9b982)
- **ui:** shared Prefs, no id lookups in the run dialog, small cleanups (b4fe91f)
- **srv:** use the cds-typer models for entities, rows and enums (35c5ed0)
- **testcases:** Run dialog and file export/import in their own modules (a1423e6)
- **subscriber:** session, message buffer and topic list out of the controller (4e9c8b1)
- **testcases:** payload status through the view model, real waits in the screenshots (9b7fbde)

### Tests

- independent number range tests, no e2e race or leftovers (8d7e8c3)
- **e2e:** Test Runs opens - check a column of the results table (aba536d)
- the UI5 version agrees in every index.html, manifest and type package (28db6fb)
- shared helpers, no real-time waits, precise assertions, coverage gaps (7bca07c)
- **e2e:** shared Playwright base config, stable selectors, shared helpers (38e2305)
- unit describes without a server boot, small cleanups (4bc4754)
- split the big agent and run tests (896b8b5)

### Documentation

- maintenance review of the whole repository (e691fca)
- **local:** broker setup text matches the app, pinned image, password from env (2a5769a)
- technical docs match the code again, development workflow written down (ffc35e5)
- status of every finding in the maintenance review (ef369c8)

### CI

- GitHub Actions workflow and closed lint/typecheck gaps (ebb9c34)

### Chores

- LF line endings via .gitattributes and .editorconfig (70144cc)
- archive the old review, delete the dead router copy, .gitignore gaps (32819a0)
- **build:** reproducible approuter, mbt as dependency, MTA health check (81786a8)
- **ui:** each app gets only the shared modules it uses (27432a8)

## 1.0.0 – 2026-10-16

The first version: test cases in folders, multi-broker runs with advanced settings, live subscriber, saved messages, variables, number ranges, faker test data, MCP access for AI assistants, Home and Help apps.

### Features

- initial commit (413d83e)
- feature updates (849871b)
- added docs (92b0325)
- **runs:** one row per test case x broker with filters and config links (db3b58c)
- **brokers:** optional username, asked together with the password (e622a97)
- **testcases:** Copy button to copy test cases and folders (62d25c0)
- **testcases:** icon instead of text in the Type column (05703e2)
- **subscriber:** redesigned Live Subscriber with a topic list (f3520ad)
- **subscriber:** topic subscriptions as a list, status next to the title (57e108d)
- **agent:** MCP service so an AI assistant can plan, check and run tests (da27ac3)
- **export-import:** export and import test cases and folders as JSON (c57c819)
- **agent:** export and import for the AI assistant (2debeb6)
- **testcases:** Export and Import buttons (637c8df)
- **help:** serve the user guide as rendered sections (7dac1b2)
- **help:** Help app with navigation, search and deep links (5192715)
- **help:** Help button on every page (a5fb07f)
- terragrunt setup for local solace and matching demo data (ba6aa3f)
- OAuth login via XSUAA for the MCP endpoint (14f3458)
- deploy UI apps to HTML5 repo and prepare SAP Build Work Zone (cb57e22)
- **home:** start page app with apps, attention items and latest runs (9c5b778)
- **subscriber:** saved setups per user (backend) (86fa4bb)
- **subscriber:** save, load and delete setups in the Live Subscriber (0cd20ba)
- **numberranges:** number ranges for SAP-like identifiers in templates (f42e9b1)
- **numberranges:** Number Ranges app (Admin) and launchpad / home / HTML5 registration (5bd7c54)
- **numberranges:** expression help entries and a demo test case using the ranges (348e66d)
- **templates:** faker.js test data in templates (ad35c4c)
- **templates:** faker in the expression help, demo test case and docs (a7771f4)
- **demo:** faker in the order examples and a Customers folder with person payloads (bafbb45)
- **runs:** repetitions, pause, order, stop on first failure and stop run (98e5153)
- **runs:** advanced settings and Stop run in the Run dialog, repetition column in the results (72f5d7e)

### Fixes

- regenerate package-lock.json with all platform packages (dd84c88)
- **brokers:** no default username, so brokers without one ask for it (92a039a)
- **testcases:** credential fields missing in the Run dialog (e226afd)
- **testcases:** folder variables could not be saved (9fa31c3)
- **testcases:** use named icon colors in the Type column (413847e)
- **mta:** srv-api destination via token exchange (05aa25f)
- deployment fixes (55a9b40)
