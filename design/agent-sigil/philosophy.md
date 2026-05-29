# Coral Sigil — an algorithmic philosophy for agent identity

## The movement

**Coral Sigil** treats an agent's wallet address not as a string to be truncated, but as a *seed of identity* — a number that, run through a deterministic system, crystallizes into a unique geometric seal. Where a monogram says "two letters of an address," a sigil says "this, and only this, agent." The address is destiny: the same key always blooms into the same mark, and no two keys bloom alike. Identity is not stored; it is *computed*, fresh, every render, from the one thing that is already canonical and on-chain.

## Computational expression

The system is a small, ruthless act of controlled chaos. A hash diffuses the address into high-entropy state; a seeded PRNG (mulberry32) draws every subsequent decision from it, so the output is pure function of the key — reproducible to the pixel, on the server and the client alike. A warm gradient field is laid first — two adjacent tones from the coral-terminal palette, rotated by a seeded angle — establishing temperature and direction. Over it, a small cast of bold geometric agents are placed: rotated polygons, discs, and an occasional sealing ring, their counts, positions, scales, and hues all decided by successive draws from the same stream. Three to four forms, never more — restraint is the discipline that lets the mark survive at forty pixels.

## Emergence and constraint

Beauty here is emergent but bounded. The palette is fixed coral/ember/amber/sea, so chaos can never produce an ugly or off-brand color — only a *novel arrangement* of approved ones. Shapes are large and few, so the result reads as a single confident emblem rather than visual noise. The blend of overlapping translucent forms over the gradient produces depth the parameters never explicitly encode — a third color appears where two overlap, a sense of light where opacities stack. This is the signature of a meticulously crafted generative system: the rules are simple, the surface is rich, and every seal feels both inevitable and surprising.

## Master-level intent

The implementation must read as the product of deep care — every magic number (shape-size range, opacity band, gradient angle quantization, the choice to favor angular forms over blobby ones for a "terminal/circuit" feel) chosen so the *worst* seed still looks deliberate and the *best* looks designed by hand. It is painstakingly tuned for the small canvas: legible as a 40px avatar, crisp as scalable SVG, identical across SSR and hydration, and cheap enough to render a hundred at once without a dropped frame. The address goes in; an agent's seal comes out — quiet conceptual DNA of a reputation network where identity is cryptographic, not nominal.
```
```

> Implementation note: expressed as deterministic inline SVG (`web/components/AgentSigil.tsx`), not p5/canvas — the avatar is SSR-rendered at 40px, many per page. The p5 viewer pattern is the wrong runtime for that; the philosophy above is what carries over.
