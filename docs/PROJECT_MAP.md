# The Digital Side Project Map

- Last audited: 2026-09-03
- Production domain: `thedigitalside.org`
- Primary contact: `handled@thedigitalside.org`

## Architecture and deployment

This is a build-free static site: root HTML files, inline or adjacent CSS/JavaScript, and image assets. There is no package manifest, framework, site generator, Pages workflow, or build configuration in the repository.

- `index.html` is the main website entry.
- `CNAME` maps GitHub Pages to `thedigitalside.org`.
- The audited checkout has only the local `work` branch and no configured remote, so the Pages source branch/folder cannot be proven locally. Confirm it in GitHub Settings → Pages before changing deployment structure.
- HTTPS is pending a DNS check per the project briefing; no repository action is currently requested.
- `README.md` currently contains only the repository name and no operating or deployment documentation.

## Public experience map

### The Digital Side

| File | Role | Current state |
| --- | --- | --- |
| `index.html` | Main portfolio/full-site entry | Live site surface; demo portfolio, services, process, Owner Key showcase, contact, and About. Its contact form currently displays success without sending data. |
| `door.html` | Vee's own Digital Door | Rebuilt to the approved briefing structure with the locked explainer, four demos, Breakdown, separate intake choices, Good to know, and discreet footer links. Quick intake currently opens an honest email draft until Vee supplies its Formspree ID. |
| `client-intake.html` | Full in-depth intake | Structurally complete but disconnected from the main site and still uses `YOUR_FORM_ID`. Keep separate from quick intake. |
| `customer-path-demo.html` | Blackline Tattoo animated concept demo | Uses `customer-path-demo.css` and `.js`; demonstrates Key → Door → Path → Destination with a non-scannable mock QR. No inbound site link. |

### Four customer demos

| Business | Digital Door | Mobile-optimized destination | Desktop/full destination | Key/path notes |
| --- | --- | --- | --- | --- |
| Frederick Legacy Law | `door-frederick-legacy-law.html` | None local | External `law-firm-demo` GitHub Pages site | Gate-free auto-launch is preserved. Real Owner Key preview uses `owner-key-frederick-law.png`; paths now resolve to useful destinations and include a parking/urgent-matter FAQ. Desktop remains the allowed Explore Everything fallback until a mobile version exists. |
| Lumina Dental Studio | `lumina-door.html` | `lumina-mobile-site.html` | External `dental-office-demo` GitHub Pages site | Entrance animation is preserved; a quiet Owner Key placeholder and insurance FAQ were added. Explore Everything uses the local mobile site. The fictional real-looking `hello@luminadental.com` address still merits review. |
| Northline Roofing Co. | `northline-door.html` | `northline-mobile-site.html` | `northline-full-site.html` | Entrance is preserved with corrected Door language; quiet Owner Key placeholder and insurance FAQ added. Explore Everything uses mobile. Source remains heavily minified. |
| Atelier House | `atelier-door.html` | `atelier-house-mobile-site.html` | `atelier-house-full-site.html` | Branded entrance preserved with corrected Door language; quiet Owner Key placeholder and pricing FAQ added. Explore Everything uses mobile, placeholder path targets were removed, and the mobile page received portfolio/scope/FAQ/visit content. |

Every demo ultimately needs this ordered path ending:

1. Working Door entrance.
2. Quiet/muted Owner Key preview.
3. **Explore Everything** to mobile-optimized content, with desktop fallback only when mobile does not exist.

Each business also needs one custom FAQ-style Customer Path aimed at its most common phone question (for example, Frederick parking/urgent matters or Lumina insurance).

## Customer Paths and purposeful loops

Most Customer Paths are embedded in their Door rather than stored as separate pages:

- `door.html`: Walk a Path, Build My Digital Side, Fix What I Have, and I Just Need Help.
- Frederick: four visual path cards plus contact/Owner Key/full-site actions; the cards are not real destinations yet.
- Lumina: JavaScript-driven route panels that lead into its mobile site.
- Northline: inspection, storm, replacement, and current-customer modal routes.
- Atelier: portfolio, style quiz, project, current-client, and small-help routes.

A purposeful loop should carry a visitor forward to a useful destination and give them a contextual way back to the Door/paths. Existing examples include the Lumina and Northline mobile pages linking back to their Doors. Preserve these loops; fix paths that terminate at `#`, missing fragments, or the wrong full-site variant.

## Known broken, placeholder, or disconnected behavior

### Conversion-critical / externally blocked

- `index.html` contact form does not transmit; it only swaps to a success message and was outside the Door implementation pass.
- `door.html#helpForm` opens a populated email draft and clearly states that it has not sent anything; replace this with the dedicated quick-intake Formspree endpoint when Vee supplies it.
- `client-intake.html` uses `https://formspree.io/f/YOUR_FORM_ID`.
- The two real Formspree IDs will be supplied by Vee and must remain separate.

### Demo paths

- `index.html` links Lumina's Full Site to the external desktop demo even though `lumina-mobile-site.html` exists.
- The repaired Door and path endings use `mailto:handled@thedigitalside.org`; fictional in-demo business contact actions remain visibly demo data.

### Disconnected pages

The current local link graph provides no inbound production link to:

- `customer-path-demo.html`
- `client-intake.html`
- `atelier-house-mobile-site.html`

`door.html` is not linked from `index.html`; it is currently reached locally only from the intake page. Treat these as unintegrated, not automatically obsolete: direct URLs or future approved navigation may depend on them.

### Fictional information

The customer demos contain placeholder `.example` addresses and/or `555`/dummy phone numbers. Keep them visibly fictional until approved replacements exist. Do not silently turn demos into apparently live businesses.

## Asset inventory

### In use

| Asset | Dimensions | Use |
| --- | ---: | --- |
| `owner-key-frederick-law.png` | 1080×1920 | Frederick Owner Key overlay and homepage showcase. |
| `about_mim.png` | 1086×1448 | Main About portrait and first mobile timeline image. |
| `about-dropout.png` | 1086×1448 | About timeline. |
| `about_salesforce.png` | 1086×1448 | About timeline. |
| `about_meta_summit.png` | 1086×1448 | About timeline. |

The four live About PNGs are roughly 2.0–2.6 MB each and are the clearest homepage optimization opportunity. `door.html` is roughly 804 KB because it embeds multiple base64 images, which cannot be cached independently.

### Unreferenced candidates — verify before removal

- `about_main.jpg`
- `about_mim.webp` (same dimensions as the live PNG and much smaller)
- `digital-door-stone-stardust-example.png`
- `digital-door-stone-stardust-example.webp`
- `tds-logo.webp`

No current assets are byte-identical. The PNG/WebP pairs are encoding variants, not exact duplicates. Do not delete them until direct URLs, QR usage, design intent, and the actual published branch have been checked.

## Locked product and content decisions

- Required vocabulary: **Digital Key → Digital Door → Customer Path → Destination**.
- The owner holds the Key; visitors enter the Door.
- Custom code, no templates, and scroll-driven storytelling rather than page-load navigation.
- Voice is direct and concrete; no agency filler such as “transform your digital presence,” “unlock your potential,” or “seamless.”
- No advertised deposit-now path.
- Payment/privacy copy lives in a **Good to know** tab.
- Locked briefing copy for “What is this, exactly?”, About Me, and Good to know must be inserted verbatim when those sections are built.

### Digital Side visual system

The current canonical homepage establishes near-black surfaces (`#080a0c` and `#0d1014`), dark cards, restrained white/gray type, muted sage-lime (`#a9b1a2`) for the main accent, and bright signal green (`#A6FF00`) for sparing active-state emphasis. Its typography system uses monospace display details, a practical sans-serif heading stack, and a humanist sans-serif body stack. Preserve that contrast, restraint, compact geometry, and subtle technical/grid/scan-line texture unless a later approved brief changes it. The four customer Doors should retain business-specific visual systems rather than being recolored copies of the Digital Side.

### Locked copy

**What is this, exactly?**

> You hold the digital key — the one QR code your customers scan. It opens your digital door, and behind it is the path built around why they actually came: an intake form ready to fill out, an answer to the question people always ask, a way to flag something urgent. No digging, no guesswork. Custom code for your business, your brand voice, yours for good.

**About Me**

> Hi, I'm Vee. I design and build every Digital Door myself — there's no agency, no template, and no sales team between you and the person actually writing your code.

**Good to know**

Headline:

> We don't collect or store your payment card information.

Body:

> Deposits and payments go through a separate payment processor — we never see or hold your card details. For most of our work, we don't need your passwords or account logins either. The exception is Connect the Dots: depending on scope, that tier may require login access to complete the junk-drawer cleanup — organizing your domain, email, and account info into one clean, handed-off system.

### Locked Breakdown

| Offering | Price | Justification |
| --- | ---: | --- |
| Signal Check | Free | No cost to figure out what you actually need. |
| Key + Door + Path | $350 | Your digital key, a working door, and a real customer path — built and handed to you. |
| + Mobile-Optimized Desktop | +$100 | Your existing site, cleaned up so it actually works on a phone. |
| + Revive | +$250 | Freshens up your current desktop site to match your new door. |
| + Evolve | +$350 | Modernizes your brand and desktop site to match your new door. |
| Full Custom Build | $750+ | Everything new — door, mobile, and a brand-new desktop, built from scratch. |

Apple Wallet access is included in the advertised Key + Door + Path price. The $250 without-Wallet alternative is never advertised and is mentioned only if directly asked. Connect the Dots is a combination name, not a priced row; Digital Cleanup is scoped only within that combination.

## Safest implementation order

1. **Verify deployment and preserve baselines:** confirm remote/default branch/Pages source, DNS and HTTPS state, external demo availability, shared direct URLs, and screenshots of all live pages.
2. **Lock the route architecture:** decide how `index.html`, `door.html`, intake, standalone path demo, and local versus external full sites connect before moving anything.
3. **Rebuild `door.html` to the approved brief:** preserve useful behavior while implementing the locked sequence, copy, mobile carousel, Walk a Path, Breakdown, intake choices, privacy tab, and discreet footer links.
4. **Complete the four demo endings:** working entrance → quiet Owner Key → mobile-first Explore Everything; preserve Frederick's gate-free launch and verify Lumina/Northline animations.
5. **Complete paths and loops:** add each custom FAQ and replace placeholder/hash/missing destinations with useful, contextual routes.
6. **Restore real conversion behavior after IDs arrive:** configure separate Formspree forms, honest confirmed-success states, failure fallbacks, and all `handled@thedigitalside.org` mail links.
7. **Bring Atelier mobile to content parity:** compare every meaningful desktop section, then condense/reorder without silently dropping content.
8. **Optimize assets and source:** convert/replace heavy live images after visual comparison, extract base64 assets, and reformat minified Northline sources without changing behavior.
9. **Remove only proven dead files:** verify published branch, external/direct use, QR/print references, and rollback before deletion or renaming.

## External work and current limitations

Vee is handling the following separately; do not invent or preempt them:

- Formspree account and two real form IDs.
- GA4 property and Measurement ID.
- Stripe payment link (though deposit-now is not part of the public build).
- Private client tracker/renewal-log tool; it does not belong in this public site.

During the repository audit, the execution environment's outbound proxy blocked requests to the custom domain, GitHub API, and external GitHub Pages demos with HTTP 403. Their live status still requires verification from an unrestricted network.
