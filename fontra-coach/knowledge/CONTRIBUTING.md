# CONTRIBUTING TO THE KNOWLEDGE BASE

You don't need to be a programmer. You need to know type design.

## Adding a Knowledge Card (simplest contribution)

Edit `knowledge/v1/knowledge-cards.json`. Copy an existing card as template.
Required fields: id, glyph, title, body.
Optional: tips, related_cards, sources, tags, verbosity.

Your card will appear in the Coach panel when the specified glyph is selected.

## Adjusting an Optical Rule Threshold

Edit `knowledge/v1/optical-rules.json`. Find the rule by ID.
Change the `trigger_when` value.

Example: OPT-001 currently triggers when horizontal bar is >=95% of 
vertical. If you find this too aggressive for your style of type, 
change to 0.90 and document why in the `notes` field.

## Adding a Glyph Relationship

Edit `knowledge/v1/glyph-dna.json`. Find the source glyph.
Add an entry to `feeds_into`. Include: glyph, method, description, 
confidence (high/medium/low), parts_used.

## Validation Before Submission

```bash
npm run test:kb
```
Both `kb-validate.js` and `kb-lint.js` must pass before submitting a pull request.

## Notes on Quality

- Be specific. "Adjust the curve" is not useful. "Reduce the handle 
  length by ~20% to eliminate the S-curve inflection" is useful.
- Cite sources when possible. Published type design literature, 
  workshop transcripts, master typographers' notes.
- Note your experience level and context. Advice for display type 
  differs from advice for text type.
- Tag opinions clearly. If a rule is stylistic rather than optical/
  technical, tag it "style" and mark verbosity "expert".
