---
name: mapml-viewer-markup
description: Tells you how to correctly create and edit the markup for a <mapml-viewer> element. Use it when generating MapML output markup in an HTML page.
---

# Skill Instructions

The <mapml-viewer> element is an autonomous HTML custom element.  It can be sized using CSS.  The <mapml-viewer> 
element can contain 0 or more <map-layer> child elements.  <map-layer> elements represent the map content. The <mapml-viewer> can also contain a single <map-caption> element which is especially important to describe the purpose of the map for screen reader users.

#### Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `projection` | `string` | `'OSMTILE'` | The coordinate reference system for the map (`OSMTILE`, `CBMTILE`, `WGS84`, `APSTILE`) |
| `lat` | `number` | 0.0 | Initial latitude center of the map |
| `lon` | `number` | 0.0 | Initial longitude center of the map |
| `zoom` | `number` | 0 | Initial zoom level |
| `controls` | `boolean` | `true` | Show/hide map controls |
| `controlslist` | `string` | - | Space-separated list of controls to show/hide. Values include: `nozoom`,`nofullscreen`,`noscale`,`geolocation`,`noreload`,`nolayer`. Mostly these are used to remove a default control, the exeption being `geolocation`, which is required to include the geolocation button. |
| `width` | `string` | `'300px'` | Width of the map |
| `height` | `string` | `'150px'` | Height of the map |
| `static` | `boolean` | `false` | Disable interactive features like panning, zooming, querying |
