# The Digital Side — Repository Instructions

These instructions apply to the entire repository.

The current locked correction brief is the source of truth. If these instructions, the project map, or an older implementation conflict with it, follow the brief and amend the documentation rather than expanding scope.

## Protect the working site

- Preserve every working feature, route, animation, responsive behavior, form fallback, and accessibility affordance unless the task explicitly replaces it.
- Before changing a page, trace its inbound/outbound links and test its current behavior. Make the smallest safe change; do not casually delete, rename, or move public files because direct URLs and printed QR codes may depend on them.
- This is a static, custom-coded GitHub Pages site. Do not introduce templates, frameworks, build tooling, or page-load navigation unless Vee explicitly requests it. Prefer scroll-driven storytelling.
- Keep demo contact details clearly fictional until real details are supplied. Never invent Formspree IDs, analytics IDs, payment links, QR destinations, credentials, or DNS/Pages settings.

## Locked vocabulary and ownership

- Use this sequence and capitalization: **Digital Key → Digital Door → Customer Path → Destination**.
- The business owner holds the **Digital Key**; the visitor enters through the **Digital Door**. A visitor-facing tap-to-enter screen must say **door**, never **key**.
- **Explore Everything** means the mobile-optimized version of that business's site. Use a desktop/full-site destination only when no mobile version exists.
- **Owner Key** previews must be actual designed Key visuals and use quiet/muted triggers, never bright primary buttons. A non-scannable QR placeholder may appear inside a designed Key visual, but text or status messages are not previews. Do not invent a QR destination. If no visual exists, report it as missing.
- **Connect the Dots** is the assembled Door + Mobile + Desktop (Revived/Evolved) combination, not a separate priced product.
- Digital Cleanup or “junk drawer” organizing belongs only to Connect the Dots, not the base Key + Door + Path tier.

## Brand system and voice

- Preserve the established Digital Side base system unless a brief explicitly supersedes it: near-black surfaces, restrained white/gray type, muted sage-lime accents, bright signal green used sparingly for active signals, monospace display details, compact radii, and subtle technical/grid/scan-line texture. Customer demos may and should use their own brand systems.
- All experiences must feel custom to the business: carry its visual identity and **brand voice** through the Door, paths, microcopy, and destinations rather than applying a generic Digital Side template.
- Write directly, concretely, and quickly. Remove corporate filler and agency-speak.
- Never use “transform your digital presence,” “unlock your potential,” “seamless,” or close variants.
- Treat briefing text labeled **locked copy** as verbatim. Do not paraphrase it without Vee's explicit approval.
- Do not advertise a deposit-now option. Payment/privacy content belongs in **Good to know**.
- Pricing is locked to the current briefing. Apple Wallet is included in the advertised $350 Key + Door + Path price; never advertise the $250 no-Wallet alternative.
- Primary contact: `handled@thedigitalside.org`. Customer-path “Email me directly” actions must be real `mailto:` links to that address.

## Door and path requirements

- Maintain the four customer demos: Frederick Legacy Law, Lumina Dental Studio, Northline Roofing Co., and Atelier House.
- In `door.html`, each Walk a Path card must order its available actions as: quiet Owner Key example → View Door → **Explore Everything**. If the Owner Key visual is missing, show an honest non-interactive missing state in that first position rather than a fake preview button.
- Build purposeful loops: deeper/mobile pages must offer a useful route back to the Door or Customer Paths, and the Door must lead forward to the correct destination. Loops must help visitors choose another intent, not trap them or bounce them without context.
- Preserve Frederick's gate-free auto-launch behavior. Verify the Lumina and Northline Door entrance animations after related changes.

## The Digital Side Door

- `door.html` is slated for a deliberate rebuild, not piecemeal reinterpretation. Follow the approved sequence: hero/logo → “What is this, exactly?” → animated Key/Door/Path/Destination explainer → Walk a Path → The Breakdown → intake choices/contact → discreet Key/full-site/About links.
- The explainer is a horizontal icon sequence on desktop and an obviously swipeable, dotted, next-card-peeking carousel on mobile.
- Keep quick intake (`door.html#helpForm`) and full intake (`client-intake.html`) separate. They require separate real Formspree forms once Vee provides the IDs.

## Mobile and accessibility

- Design and test mobile behavior intentionally; do not merely shrink desktop. Preserve readable hierarchy, touch targets, safe-area handling, reduced-motion behavior, keyboard access, focus behavior, and usable back/close controls.
- Do not remove content from a mobile-optimized site solely to make it shorter. Condense and reorder around customer intent while preserving necessary details.
- Avoid horizontal overflow except for an intentionally labeled/afforded carousel.

## Testing and delivery

- Before editing, check `git status` and read `docs/PROJECT_MAP.md`.
- For link changes, validate every local file and fragment target plus both sides of each purposeful loop. Clearly report external links that cannot be network-verified.
- For visible changes, test representative desktop and mobile viewports and capture screenshots. Test keyboard operation and reduced motion for interactive changes.
- For forms, verify validation, confirmed-success behavior, failure fallback, recipient, and that no placeholder endpoint remains. Never show success for data that was not delivered.
- Run available HTML/CSS/JavaScript checks and inspect the browser console. Report exact commands and any environment limitations.
- Keep commits scoped. In the final summary, identify preserved behavior as well as changed behavior.
