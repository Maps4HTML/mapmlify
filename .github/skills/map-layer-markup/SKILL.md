---
name: mapml-layer-markup
description: Tells you how to correctly create and edit the markup for a <map-layer> element. Use it when generating MapML output markup in an HTML page.
---

# Skill Instructions
# MapML `<map-layer>` Element Markup Constraints

## Purpose
Document constraints and guidelines for generating valid `<map-layer>` elements.

## Required Attributes
- `label` - Display name for the layer, although if the `<map-layer>` has a child `<map-title>`, the latter element's content will supercede the `label`.

## Optional Attributes
- `src` - URL to external MapML document
- `checked` - Boolean, whether layer is rendered on the map
- `hidden` - Boolean, whether layer appears in layer control
- `opacity` - Number between 0 and 1, defaults to 1

## Child Elements
- `<map-extent>` - Defines a "form" that binds to the map viewport, enabling client-server requests to child templated `<map-link>` element(s).
- `<map-link>` - Links to related resources, such as alternates, license info, legends
- `<map-meta>` - Metadata about the layer

## Constraints
- Either `src` attribute OR inline `<map-extent>` must be provided
- Cannot have both `src` and inline content

## Example
```html
<map-layer label="OpenStreetMap" checked>
  <map-extent units="OSMTILE">
    <!-- extent content -->
  </map-extent>
</map-layer>
```

## Notes
- 
