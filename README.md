# Finger Kaiju

**Your desk becomes a tiny city. Your hand becomes a giant monster.**

A mixed reality, hands-only game for Meta Quest, built for the Meta VR Start Developer Competition 2026 (Gaming track).

## Campaign (new): be the giant hamster, win 3 stars

A Moss-style diorama: the city sits on your table and you play **one chubby giant hamster from the third
person**, walking the streets of Tokyo and wrecking it from the inside. Zoom in to street level (the rest of the
city fades to a see-through ghost so you still see everything around) or zoom out to see all of Tokyo.

- **5 levels**, each with one clear goal and **3 stars**: **goal done, faster than par, nobody hurt**.
- The hamster **waddles** (yes, the bottom jiggles), **punches**, **jumps onto roofs** (a hard landing is a
  butt slam), **grabs cars and gnaws them** or **throws them** at buildings, tanks and the helicopter.
- **Sunflower seeds** on streets and roofs: +3 s and health; 5 seeds = cheeks full = super punch.
  A rare **golden seed** gives **15 s of GOD MODE**: your own hands become the monster (smash, grab, quake).
- **The city fights back:** police cars shoot from level 2, a helicopter from level 4, tanks in level 5.
- It **grows** with the campaign: Hamster -> Chonky Hamster (level 4) -> Mega -> Giga -> Kaiju Hamster.
- **Controllers:** left stick walk, A punch / throw, B jump, X grab (hold X = gnaw), right stick zoom,
  hold grip and point at any surface to move the city there.
- **Hands only:** pinch the ground to walk, pinch a building to smash it, pinch a car to grab and eat it,
  pinch a building while holding a car to throw it there, pinch the hamster to carry him, two-hand pinch to zoom.
- **Desktop:** WASD (Shift run), J punch / throw, E grab (hold = gnaw), Space jump, + / - zoom.

## How to play (classic modes)

1. Open the game in the Meta Quest browser and press **Enter Mixed Reality**.
2. Look at a table. The city lands on it automatically (no table? it appears in front of you after a few seconds).
   Pinch and hold for 1 second to move the city anywhere.
3. Touch one of the **four game cards** at the front of the city (3-2-1-GO!):
   - **BLITZ**: smash as much as you can before the clock runs out. Tap the yellow chip on the card to switch
     between 10 s, 15 s, 30 s, 1 min and endless.
   - **HELI HUNT**: the city sinks away and only a fast, evasive helicopter is left. Grab or swat it as many
     times as you can in 30 s; every catch makes the next one faster.
   - **MISSIONS**: quick random orders with 3 lives: smash the glowing buildings, destroy the tanks, catch the
     chopper, knock down people with a quake, wreck cars, destroy N buildings, or... *don't touch the city!*
     Missions get faster, and a new themed city grows whenever the old one runs out.
   - **RAMPAGE**: the classic: wreck the city while tanks and a helicopter fight back. Destroy everything for
     +30 s while a brand new city (Mega Metro, Sleepy Suburbia, Factory Town...) grows in its place.
4. Controls: **touch / punch** to smash, **grab** (pinch or fist) to rip buildings and vehicles off the ground,
   **throw** them, **squeeze your fist** to crush, **slam your palm** for an earthquake,
   **two-hand pinch** to zoom and rotate the city.

**Settings:** poke the gear next to the city (in mixed reality) or click the gear in the top-right corner (desktop):
music and sound volume, Blitz and Rampage length, difficulty, time of day, fire & smoke amount, new city on/off,
earthquake shake, kaiju claws, hand shadows, news ticker, reset best scores, end game. The game pauses while settings are open.
Each game mode keeps its own best score.

**Progression:** every game earns XP. Your kaiju levels up (Baby Kaiju → Street Stomper → Block Buster → ... → Legend of
the Desk) and unlocks new claw skins (Lava Red, Ice Blue, Toxic Purple, Royal Gold, Shadow, Rainbow). A **daily challenge**
(the same for every player each day) gives bonus XP and builds a streak.

Your fingertips grow scaly kaiju caps and claws, and your hand casts a shadow on the streets so you can judge height.
The round starts on a calm golden afternoon and turns into a burning night city: windows and street lamps light up,
ruins smoke and burn, emergency vehicles race with sirens, and a news ticker reports your rampage live.

Fully seated, controller-free, and a complete round takes about a minute and a half.

## Tech

- [Immersive Web SDK](https://github.com/facebook/immersive-web-sdk) (WebXR + Three.js, ECS)
- WebXR hand tracking: 25 joints per hand for fingertip collisions, pinch and palm-slam detection
- Plane detection (scene understanding) to find the real table
- City built from Kenney CC0 kits: 5 districts (downtown, commercial, suburbs, industrial, park), roads, cars, animated people
- Detailed procedural tank and attack helicopter, baked to a few draw calls each
- Destruction that stays: rubble mounds in each building's colours, scorch marks, quake cracks, fires with smoke columns, embers and a fire light
- Day-to-night cycle over the round (sun, ambient, window glow, street lamps, car head/tail lights)
- Kaiju hands: fingertip caps + curved claws following the WebXR finger joints, contact shadows for palm and fingertips
- Juice: hit-stop on big hits, monster roar, tiny-people screams, sirens, fire crackle, BREAKING NEWS ticker
- Pedestrians walk a sidewalk network (turn at corners, cross at intersections, stop to chat) and flee from your hand
- Steering-based helicopter flight (nose follows velocity, banks into turns, pitches when accelerating)
- Calm city music until the first smash, then a crossfade into the fight theme
- Sampled sound effects, with a Web Audio fallback

## Run locally

Requires Node.js 20.19+ (or 22.12+ / 24+).

```bash
npm install
npm run dev
```

The dev server opens the app with IWER, the built-in WebXR emulator (Meta Quest 3 with hand tracking).
Without a headset you can also click buildings and tanks with the mouse, and press **Space** for an earthquake.

## Build and deploy

```bash
npm run build   # output in dist/
```

Pushing to `main` deploys to GitHub Pages through `.github/workflows/deploy.yml`.

## Credits

- 3D models and sound effects: [Kenney](https://kenney.nl) (City Kit Commercial/Suburban/Industrial/Roads, Car Kit, Mini Characters, audio packs), CC0
- Monster roar: [trazzz123](https://opengameart.org/content/cc0-deep-monster-roar), CC0 · Scream: [pauliuw](https://opengameart.org/content/high-pitch-scream-sounds2), CC0 · Siren: [aquinn](https://opengameart.org/content/sirens-and-alarm-noise), CC0 · Fire: [AntumDeluge](https://opengameart.org/content/fire-crackling), CC0
- Fight music: "Fast Fight Battle Music (looped)" by XCVG, [OpenGameArt](https://opengameart.org/content/fast-fight-battle-music-looped), CC0
- Calm music: "Peaceful village loop" by elerya, [OpenGameArt](https://opengameart.org/content/peaceful-village-loop), CC-BY 3.0

## License

Code: MIT. Assets: see credits.
