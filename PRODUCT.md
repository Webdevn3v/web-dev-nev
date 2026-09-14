# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two audiences, tied together by the OWNER → KEY → DOOR → CUSTOMER PATH → ACTION chain:

- **Primary: the business owner.** An independent or small-business operator (realtor, attorney, HVAC contractor, interior designer, roofer, funeral home director, dentist, etc.) who meets prospects and clients in person and needs to hand off their business identity instantly and memorably.
- **Secondary: that owner's prospect or customer.** The person on the receiving end of the Key/Door handoff, who needs a fast, low-friction route to the specific action they came for.

## Product Purpose

The Digital Side builds a business owner's digital ecosystem around the way that owner actually works, rather than making the owner adapt to generic templated software ("Your business shouldn't have to adapt to the technology it needs. The technology should adapt to the way you do business."). Success is a real-world interaction — in person, via NFC/QR/Wallet — converting smoothly into a specific customer outcome through a deliberately short, branded path, not a generic website visit.

## Positioning

Not a website-template business. The differentiating mechanism is the in-person, physical-to-digital handoff (NFC tap / QR scan / Apple or Google Wallet Digital Key) that leads directly into a branded Digital Door and a customer-specific Path — a sequence a template-website competitor could not truthfully replicate, because it starts from a physical networking moment, not from a URL.

## Operating Context

- The core moment: an owner meets someone anywhere and hands off their business digitally on the spot.
- Handoff mechanisms: NFC tap, QR scan, or opening/sharing an Apple/Google Wallet Digital Key.
- The handoff leads into the Digital Door, which routes the visitor toward a Customer Path suited to what they specifically need.
- The Full Digital Side (the larger site) is available when a visitor wants more depth than the Door/Path provides.
- Seven initial vertical contexts currently represented: Real Estate, Law, HVAC, Interior Design, Roofing, Funeral Home, and Dental — each with materially different owner workflows and customer needs.

## Capabilities and Constraints

- **Digital Key** — the owner's portable business identity; intended to live in Apple/Google Wallet and be supported by physical NFC/QR assets; must feel valuable enough that an owner actually wants to carry and use it, not a formality.
- **Digital Door** — a branded entrance, explicitly not a mini website. Its job is a memorable first interaction that immediately routes the visitor toward useful action.
- **Customer Path** — short, intentional per-customer routes to actions such as call, text, save contact, listings, quote, booking, portfolio, review, or custom request. Paths differ by business type; there is no fixed universal set.
- **Full Digital Side** — the deeper site, used when a visitor needs more than Door/Path provides.
- **Family relationship, not scaled copies** — Key, Door, Path, and full site must read as the same identity without being resized duplicates of one another: full site is the grand expression, mobile is its clean responsive translation, the Door is a concentrated entrance built from the identity's strongest elements.
- **Constraint — one creative world per demo** — every client/demo experience requires its own distinct typography, composition, imagery, motion language, interaction behavior, and personality. A shared reusable template recolored per client does not satisfy this constraint.
- **Constraint — brand separation** — The Digital Side's own master-brand aesthetic must not be forced onto individual client/demo brands.
- **Inferred technical constraint** (from repo, not an explicit product decision): the current implementation is static HTML/CSS/JS with no build framework or backend evident in the repository.
- **Open / unconfirmed** — whether the Digital Key currently generates a real Apple/Google Wallet pass, or is HTML + vCard only, was not confirmed as product truth this session; see Evidence on Hand.

## Brand Commitments

- Company name: **The Digital Side**.
- TDS master-brand identity — binding for The Digital Side's own surfaces only, NOT for individual client/demo brands: refined tech elegance; black/charcoal/graphite/off-white foundation; a restrained "Digital Lime" accent; Space Mono + Inter typography. Confirmed present in the current `door.html` / `index.html` implementation (dark charcoal/graphite and off-white color tokens and a named "lime" accent token were found there, consistent with this commitment).
- Client/demo brand identities are independent per vertical and must not inherit the TDS master-brand palette or type system. Current demo names in evidence: Avery Cole / Rivermore Real Estate (Real Estate), Frederick Legacy Law (Law), Northflow HVAC (HVAC), Atelier House (Interior Design), Northline Roofing Co. (Roofing), Lumina Dental Studio (Dental). Funeral Home currently has two competing, uncanonicalized identities in the repo — Hallow & Grace, and Harbor & Pine Funeral Care — which one is binding is an open decision, not yet made.

## Evidence on Hand

- Seven target verticals each have at least a Door page in the repo; most also have an Owner Key page and either a mobile or full-site companion page:
  - Real Estate: `avery-cole-door.html`, `realtor-index.html`, `realtor-key.html`
  - Law: `door-frederick-legacy-law.html`, `frederick-legacy-law-mobile.html`, `key-frederick.html`
  - HVAC: `hvac-door.html`, `hvac-index.html`, `hvac-key.html`
  - Interior Design: `atelier-door.html`, `atelier-house-full-site.html`, `atelier-house-mobile-site.html`, `key-atelier.html`
  - Roofing: `northline-door.html`, `northline-full-site.html`, `northline-mobile-site.html`, `key-northline.html`
  - Dental: `lumina-door.html`, `lumina-mobile-site.html`, `key-lumina.html`
  - Funeral Home (two uncanonicalized versions): `hallow-grace-door.html`, `hallow-grace-index.html`, `key-hallow-grace.html`; and `harbor-funeral-door.html`, `harbor-pine.vcf`, `key-harbor-pine.html`
- Also present: three fully-built demos for verticals outside the current seven — `wrench-run-door.html` (Wrench Run Mobile Auto), `rapid-relief-door.html` (Rapid Relief Roadside), `quiet-line-door.html` (Quiet Line Investigations). Per explicit product decision, these are legacy/orphaned and are not current product truth. They have not been deleted yet.
- TDS's own Key/Door assets: `nev-owner-key.html`, `the-digital-side.vcf`, `digitalside-door-qr.png`, `td-digital-door-template.png`.
- **Absence to note:** no confirmed evidence in the repo of a generated Apple/Google Wallet pass (`.pkpass`) file or pass-generation code; current Key pages are HTML pages paired with `.vcf` vCard downloads. Future work must not assume Wallet-pass functionality already exists just because the product description requires it.

## Product Principles

1. Technology adapts to the way the owner does business — never the reverse.
2. The Key must be something an owner actually wants to carry and use, not a compliance artifact.
3. Every client/demo world is authored on its own terms; no template is recolored to produce a "new" demo.
4. The Digital Side's own master-brand identity and each client's brand identity are kept strictly separate.
5. Motion and every design decision must serve entrance, hierarchy, state change, navigation, or delight — never decoration for its own sake.

## Accessibility & Inclusion

Respect `prefers-reduced-motion`; motion and interaction must also hold up under real mobile performance constraints. This is an explicit product requirement, not a nice-to-have.
