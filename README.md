# snug · a cozy room machine

An infinitely rerollable procedural cozy room generator. Every seed is a little world:
a storybook cutaway room with its own palette, furniture, clutter, weather, light —
and sometimes a cat.

**Live:** https://rlag1998.github.io/cozy_room/

## Using it

- **new room** button, **Space** / **R**, or just click/tap the room — reroll
- The **seed chip** is editable: paste any text and press Enter to visit that room
- The URL hash holds the seed, so every room is a shareable link
- **←/→** walk your room history (browser back/forward works too)
- **C** copies the room link · **S** downloads the current frame as a PNG

## What's inside a room

Everything is drawn procedurally on a single `<canvas>` — zero dependencies, zero
network requests, no image assets.

- **Deterministic seeding** — xmur3 + mulberry32, with an independent PRNG stream per
  subsystem (palette, shell, layout, décor, rares), so the same seed always builds the
  pixel-identical room. Animation phase is the only thing driven by the clock.
- **Mood & palette engine** — day / golden hour / dusk / night moods; six wall-hue
  families; all item colors drawn from a quantized 5-step lightness ramp with hue drift
  (shadows toward dusk blue, highlights toward lamp amber), plus taste rails that make
  ugly combinations unrepresentable.
- **Lighting finish stack** — an ambient "mood grade" multiply layer with warm holes
  punched at every lamp, fire and window; window light slabs; glow cores; paper grain;
  vignette. Night rooms are blue darkness except where the lamp reaches.
- **Layout engine** — interval-based back/front lanes, wall-rect collision, surface
  slot system: furniture never overlaps and nothing floats. Room archetypes (reading
  nook, bedroom, studio, lounge, music room, plant room, kitchen) bias what spawns.
- **60+ object types** — sofas, beds, pianos, fireplaces, bookshelves full of seeded
  books, plants, string lights, steaming mugs, typewriters, fishbowls, guitars…
- **Ambient animation** — fire and candle flicker, steam, rain and snow on the glass,
  twinkling stars, drifting dust motes in the light slab, a swaying cat tail.
  Honors `prefers-reduced-motion`; throttles when idle; pauses when hidden.
- **Rare delights** — cats in six coats (5% are black cats), dogs, cat-and-dog
  jackpots, snow, aurora, shooting stars, harvest moons, rainbows, fireflies,
  god rays, neon signs, a letter under the door, birthday rooms, and the elusive
  golden seed. They're discovered, never announced.

## Dev

Open `index.html` — that's it. Useful hashes:

- `#gallery-24` (up to `-200`) — contact-sheet mode: renders N sequential seeds in a
  grid for tuning variety at a glance (`#gallery-48-hue` sorts by wall hue).

Deployed to GitHub Pages by `.github/workflows/pages.yml` on every push.
