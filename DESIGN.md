# Feedline design language

This document translates [the Feedline brand system](BRAND.md) into enforceable visual and interaction rules. It is a system for an operated source-supply line—not a generic developer-tool skin and not a factory theme.

## Design intent

An agent should understand three things before reading the API documentation:

1. varied source material enters;
2. Feedline continuously inspects, cleans, labels, and monitors it;
3. usable candidates continue toward a product the agent creates.

The interface should feel calm under load, exact about state, and visibly alive.

## Signature asset: the live line

The core composition is a continuous horizontal or vertical rail containing four moments:

1. **Intake:** differently shaped source capsules converge.
2. **Inspection:** a rectangular gate scans one item.
3. **Diversion:** duplicates, failures, or incomplete items leave on a 45-degree side path.
4. **Output:** consistent candidate units continue with provenance labels.

This sequence may become a logo animation, hero visual, section divider, loading state, architecture diagram, or product health view. Do not break it into four unrelated feature cards.

## Mark

Construct the mark from:

- one continuous 2-unit rail;
- a narrow inspection gate crossing the rail;
- one 45-degree reject path;
- one candidate continuing past the gate.

The mark must work in one color at 16 px and in motion at large sizes. The reject path may use semantic red only when it represents an actual rejected state. Do not run a decorative conveyor through the letters of the wordmark.

Use `Feedline` as the wordmark while the name remains under review. Lowercase `feedline` may be explored, but should not be used merely to mimic developer-tool conventions.

## Color system

The brand environment is cool, bright, and clean. Cobalt carries the line; semantic colors report state.

| Role | Token | Value | Behavior |
|---|---|---:|---|
| Canvas | `--feed-canvas` | `#F6F8FB` | Default page background |
| Surface | `--feed-surface` | `#FFFFFF` | Focused reading and product surfaces |
| Ink | `--feed-ink` | `#0B1220` | Primary text and one-color mark |
| Muted ink | `--feed-muted` | `#566276` | Secondary copy; never below accessible contrast |
| Rail | `--feed-blue` | `#1457FF` | Line, primary action, selected state |
| Rail dark | `--feed-blue-dark` | `#0A3DC2` | Hover, active, text links on light surfaces |
| Steel | `--feed-steel` | `#D7DEE8` | Inactive rails, rules, structural boundaries |
| Pass | `--feed-pass` | `#087A4D` | Verified healthy or complete state only |
| Reject | `--feed-reject` | `#C9362B` | Failed or diverted material only |
| Warning | `--feed-warning` | `#9A5B00` | Degraded or incomplete state only |
| Sensor | `--feed-sensor` | `#C7F23A` | Tiny scan/acquisition accent, never a text color |

Rules:

- Cobalt may occupy large structural areas. Pass, reject, warning, and sensor colors may not.
- Never use semantic colors as arbitrary decoration or to color alternating sections.
- No beige, sepia, paper texture, purple tech gradient, or black-and-yellow hazard palette.
- Gradients are unnecessary. If a scan uses one, it must communicate changing sensor intensity and disappear when motion is reduced.

## Typography

### Primary family: Spline Sans

Use Spline Sans for display, body, navigation, controls, and labels. It is clear at interface sizes but has enough engineered character to feel designed rather than generic.

Use the official [Spline Sans](https://github.com/SorkinType/SplineSans) family under its SIL Open Font License.

### Technical companion: Spline Sans Mono

Use Spline Sans Mono only for source IDs, timestamps, URLs, provenance labels, request examples, and live operational measurements. It should occupy roughly 10–15% of a marketing page, never the whole experience.

Use the matching official [Spline Sans Mono](https://github.com/SorkinType/SplineSansMono) family under the same license.

### Scale

| Role | Desktop | Mobile | Weight | Line height |
|---|---:|---:|---:|---:|
| Display | `clamp(3.4rem, 7vw, 7rem)` | fluid | 650–720 | 0.96–1.02 |
| Section title | `clamp(2rem, 4vw, 3.75rem)` | fluid | 620–700 | 1.05–1.12 |
| Lead | `1.25rem` | `1.125rem` | 400–500 | 1.55 |
| Body | `1.0625rem` | `1rem` | 400 | 1.6 |
| UI | `0.9375rem` | `0.9375rem` | 520–620 | 1.35 |
| Machine label | `0.75rem` | `0.6875rem` | 520 | 1.35 |

Body copy should remain between 45 and 70 characters per line. Never compress paragraph leading to create visual density.

## Geometry

- **Rails:** 2 px default, 3 px for hero-scale emphasis.
- **Inspection gates:** rectangular apertures with 4 px radius, never chunky cards.
- **Diverters:** 45-degree paths with deliberate junctions.
- **Candidate units:** compact rectangles or capsules, 4–8 px radius, consistent after inspection.
- **Raw source units:** varied but controlled shapes to show heterogeneous input.
- **Surfaces:** 8–12 px radius only when a bounded surface is functionally required.
- **Spacing:** multiples of 8 px; use 24, 40, 64, 96, and 144 px to establish stages along the line.
- **Shadows:** generally none. Use a subtle optical separation only for a surface physically passing above the line.

Avoid oversized rounding, thick black borders, sticker effects, offset shadows, hand-drawn arrows, and ornamental bolts or rivets.

## Layout

The page behaves like a line with stages, not a stack of interchangeable SaaS bands.

- Establish one dominant direction of travel, left-to-right on wide screens and top-to-bottom on narrow screens.
- Let a rail connect hero, mechanism, use cases, proof, and final action.
- Attach explanations to positions on the line rather than putting everything into equal cards.
- Use asymmetry around the rail: material can enter from several points and reject lanes can leave the main composition.
- Give the finished products—news feed, tracker, brief, research agent—more visual prominence than internal Feedline controls.
- Keep body content on a readable inner measure even when the line spans the viewport.

On mobile, preserve sequence rather than miniature complexity. Convert the rail to a vertical timeline and keep reject branches short and legible.

## Motion

Motion demonstrates operation. It is never ambient decoration.

| Event | Motion behavior |
|---|---|
| Intake | Candidate enters at a steady, linear pace |
| Inspection | A narrow scan passes once across the item |
| Pass | Candidate continues without celebration |
| Duplicate | Diverter changes state; item exits on the reject path |
| Failure | Line pauses locally and reports the reason; the entire page does not shake |
| Recovery | Gap closes and flow resumes from the affected point |

Use restrained linear or ease-in-out timing. No bounce, spring overshoot, floating particles, perpetual marquee text, or attention-seeking parallax.

Under `prefers-reduced-motion: reduce`, show the before/after state and use color, label, and path position to preserve meaning.

## Product states

- **Healthy:** continuous blue rail, even spacing, explicit recency, green used only at the health checkpoint.
- **Collecting:** one active scan point; existing candidates remain readable.
- **Degraded:** amber gap or checkpoint plus the affected source and last-success time.
- **Failed:** red local break and a candid reason; unaffected lanes continue.
- **Empty:** show configured sources entering an idle gate and explain whether no run occurred or no candidates passed.
- **Duplicate:** candidate visibly diverts with a link to the retained canonical item.
- **Incomplete:** candidate can continue only with an amber completeness label; never make it look fully passed.

Never use an empty blank panel for an operational state. The interface must distinguish “nothing happened,” “nothing was found,” and “the line failed.”

## Components

### Source capsule

Shows source type, label, provider or host, and health. Shape may vary before inspection, but color does not imply quality.

### Candidate unit

Shows title, source identity, observed/published time, completeness, and canonical URL. Provenance is attached, not hidden in a tooltip.

### Inspection gate

Explains normalization and identity checks. It must not say “truth verified.”

### Reject lane

Shows duplicates, blocked fetches, incomplete records, or failures with a reason. It is a transparency feature, not a trash aesthetic.

### Line-health strip

Shows sources moving, stale, degraded, and failed, along with last success and the next expected collection.

### Calls to action

- Primary: `Build a feed`
- Secondary: `See what comes off the line`
- Developer proof: `Read the agent guide`
- Operational proof: `Inspect feed health`

Avoid clever CTA wordplay if it obscures the action.

## Imagery and illustration

Prefer custom diagrams, product-state compositions, and simple 2D line animation. If photographic reference is ever used, favor bright, clean optical sorting and inspection environments to study motion and structure—not to place factory stock photography on the page.

Never use humanoid robots, glowing brains, generic AI orbs, gears, factory workers, hard hats, smokestacks, sparks, or literal food products as primary brand imagery.

## Accessibility

- All text and interactive states must meet WCAG AA contrast.
- Pair every semantic color with a label, icon, shape, or path change.
- Keyboard focus uses a 2 px cobalt outline with a 3 px canvas offset.
- Motion never carries unique information and must have a reduced-motion equivalent.
- Minimum interactive target is 44 × 44 px.
- Operational status uses plain language and includes timestamps where relevant.

## Landing-page structural brief

1. **Hero / promise:** hero-facing outcome beside a live-line key visual.
2. **The trap:** show the invisible repeated operation users otherwise maintain.
3. **The line:** one continuous visual explanation of intake, inspection, diversion, labeling, and health.
4. **What comes off it:** finished product examples owned by agents and creators.
5. **Why not search alone:** pile versus operated incremental supply.
6. **Choose the operating model:** hosted API/MCP or open-source self-hosting with user-owned provider accounts.
7. **Proof and boundary:** provenance, health, provider choice, and the judgment Feedline deliberately leaves to the agent.
8. **Action:** build one feed and inspect its output.

## Drift prevention

An implementation is off-brand if it:

- could become another developer-tool landing page by changing only the logo and colors;
- uses three equal feature cards where the line sequence would explain the mechanism;
- hides failure, rejection, provenance, or empty-state distinctions;
- makes Feedline look like the author, analyst, or editor;
- uses monospace for ordinary prose;
- substitutes retro beige, neo-brutalism, or industrial decoration for product character;
- makes the interface feel static when the product promise is continuous supply.

Before release, compare the page against [the brand board](docs/brand/feedline-brand-board.svg) and verify that the signature line, personality, hero, villain, and product boundary all remain visible.
