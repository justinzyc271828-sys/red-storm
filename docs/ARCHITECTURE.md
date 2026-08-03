# Red Storm architecture

Red Storm is a zero-build browser RTS. `index.html` loads plain scripts in dependency order, and each module extends the global `RS` namespace. This keeps local play as simple as opening one file while still allowing the simulation to run under Node for deterministic tests.

## Runtime layers

```text
Data and rules
  config.js · i18n.js · art-data.js · campaign-art.js

Simulation
  iso.js · map.js · units.js · game.js · combat.js · ai.js

Browser systems
  sprites.js · enemy-art.js · camera.js · input.js
  field-guide.js · campaign.js · cutscene.js · audio.js · render.js · main.js
```

The simulation layer is kept free of DOM dependencies. Node tests can therefore create maps, run economies, issue unit commands, resolve combat, and advance AI behavior without launching a browser.

## Important boundaries

- `src/config.js` owns gameplay tuning and building values.
- `src/game.js` owns match state, economy, construction, production, and lifecycle rules.
- `src/combat.js` owns targeting, projectiles, damage, retaliation, turrets, and combat movement.
- `src/units.js` owns paths, formation destinations, movement, and soft separation.
- `src/ai.js` owns legal AI development, scouting, defense, raids, and attack waves.
- `src/map.js` owns deterministic map generation, resources, exploration, and terrain validity.
- `src/render.js`, `src/input.js`, `src/camera.js`, and `src/audio.js` are browser-facing subsystems.

## Asset boundary

Runtime unit and building art is embedded in `src/art-data.js`; campaign plates, music, and sound effects remain external runtime files under `art/`. The public source export includes the runtime assets needed to play the game, but omits unused candidates, raw generation files, prompts, and internal review material.

The code is MIT-licensed. Assets follow [`ASSET-LICENSE.md`](../ASSET-LICENSE.md).

## Verification model

Standalone Node scripts under `test/` print `PASS` or `FAIL` and return a nonzero exit code on failure. Canonical regressions cover simulation, pathfinding, construction, production, combat, AI, maps, browser DOM integration, core mechanics, and internationalization.

Balance is checked separately through deterministic bot matches across difficulty levels and player styles. A green unit-test run does not by itself establish that a balance change is good; balance changes must include match evidence.
