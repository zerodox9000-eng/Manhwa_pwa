# Purpose

Owns frontend tests and browser QA fixtures.

## Ownership

- Unit tests, integration tests, and Playwright flows live here.

## Local Contracts

- Read the root AGENTS.md first.
- Tests should protect real user flows: Home swipe/scroll restoration, feed management, search typing, details navigation, import/share, and settings migrations.

## Work Guidance

- Prefer focused tests for the changed behavior.
- Avoid brittle timing assertions unless the bug is specifically timing-related.

## Verification

- Run `npm test -- --run` for test changes.
- Run browser checks for Playwright or UI interaction changes when possible.

## Child DOX Index

No child AGENTS.md files.
