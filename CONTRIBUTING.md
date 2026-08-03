# Contributing to Red Storm

Thank you for helping improve Red Storm. The most useful contributions are reproducible bug reports, focused gameplay observations, documentation fixes, and small code changes backed by tests.

## Before opening a pull request

1. Open an issue first for balance changes, new units, economy changes, AI behavior changes, or large structural work.
2. Keep simulation modules free of DOM dependencies. Browser-only behavior belongs in the rendering, input, audio, or main-loop layer.
3. Put gameplay tuning in `src/config.js` where possible.
4. Follow the existing style: two-space indentation, semicolons, single quotes, IIFE modules, and the global `RS` namespace.
5. Add a focused regression for gameplay bugs and run the canonical test suite.

## Running tests

```powershell
npm ci
$tests = 'sim-test','path-test','build-test','prod-test','combat-test','ai-test','map-test','dom-test','review-m5','mech-test','i18n-test'
foreach ($test in $tests) {
  node "test/$test.js"
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
```

Changes to balance, AI, unit statistics, or the economy should also include:

```powershell
node test/bot-match.js easy 10
node test/bot-match.js normal 10
node test/bot-match.js hard 10
```

Rendering and input changes require a browser smoke test.

## Art and audio contributions

The repository's art and audio are not covered by the MIT code license. Do not submit third-party media, generated media with unclear rights, or replacements for existing assets without discussing the source and license in an issue first.

Code-only contributions may use simple placeholders when a visual is required for review.

## Pull request checklist

- Explain the player-visible effect.
- List the tests you ran and their results.
- Link the issue or review note that motivated the change.
- Include before/after screenshots for visual changes.
- Do not include temporary logs, credentials, raw prompts, or exploratory `test/tmp-*` files.
