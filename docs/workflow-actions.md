# Fontra Workflow Actions

This document describes the workflow filter actions available in Fontra for automating type design tasks.

## Overview

Workflow actions are defined in the `fontra.workflow.actions` module and can be used in workflow YAML files to process fonts automatically.

## Composition Actions

The composition module (`fontra.workflow.actions.composition`) provides actions for automating glyph composition and diacritic positioning.

### auto-position-diacritics

Automatically positions combining marks based on base glyph metrics (x-height, cap-height, ascender).

**Configuration:**
- `use_anchors` (bool): If True, respect existing anchor positions. Default: True
- `skip_components` (bool): If True, skip glyphs with components (they inherit anchors from base glyphs). Default: True
- `default_x_height` (float): Default x-height if not detectable. Default: 500.0
- `default_cap_height` (float): Default cap-height if not detectable. Default: 700.0

**Example:**
```yaml
filter: auto-position-diacritics
use_anchors: true
skip_components: true
default_x_height: 500
default_cap_height: 700
```

### smart-compose-glyphs

Automatically composes glyphs from base glyphs and diacritics using Unicode decomposition data.

**Configuration:**
- `decompose_first` (bool): Decompose existing composites before recomposing. Default: False

**Example:**
```yaml
filter: smart-compose-glyphs
decompose_first: true
```

### suggest-components

Analyzes glyphs and suggests optimal component structure based on Unicode decomposition.

**Example:**
```yaml
filter: suggest-components
```

Results are stored in the glyph's `customData.component_suggestions` for later review.

## Glyph Actions

The glyph module (`fontra.workflow.actions.glyph`) provides actions for manipulating glyph outlines.

### scale

Scales glyphs by a specified factor.

**Configuration:**
- `scaleFactor` (float): Scale factor (e.g., 2 for 200%)
- `scaleFontMetrics` (bool): Also scale font metrics. Default: True
- `scaleKerning` (bool): Also scale kerning values. Default: True

### decompose-composites

Decomposes composite glyphs into their component outlines.

**Configuration:**
- `onlyVariableComposites` (bool): Only decompose variable composites. Default: False

### shallow-decompose-composites

Decomposes only the top-level components, keeping nested components intact.

### convert-to-quadratics

Converts bezier curves to quadratic curves.

### round-coordinates

Rounds point coordinates to integers.

### remove-overlaps

Removes overlapping paths from glyphs.

### propagate-anchors

Propagates anchors from components to the parent glyph.

## Axis Actions

The axes module (`fontra.workflow.actions.axes`) provides actions for manipulating variable font axes.

### rename-axes

Renames font axes.

### adjust-axes

Adjusts axis settings (min, default, max values).

### subset-axes

Subsets the variable font to only include specified axis locations.

### instantiate

Instantiates a variable font at specific axis locations.

### move-default-location

Changes the default location of a variable font.

## Feature Actions

The features module (`fontra.workflow.actions.features`) provides actions for OpenType feature manipulation.

### add-features

Adds OpenType features to the font.

### generate-kern-feature

Generates kerning features from kerning data.

### generate-palt-vpal-feature

Generates proportional and vertical alternates features.

### drop-features

Removes specified OpenType features.

## Subset Actions

The subset module (`fontra.workflow.actions.subset`) provides actions for creating font subsets.

### subset-glyphs

Keeps only specified glyphs in the font.

### drop-unreachable-glyphs

Removes glyphs not reachable from the glyph map.

### subset-by-development-status

Filters glyphs based on development status.

## Misc Actions

The misc module (`fontra.workflow.actions.misc`) provides various utility actions.

### set-font-info

Sets font info fields.

### amend-cmap

Modifies the character map (cmap).

### check-interpolation

Validates that variable font interpolates correctly.

### drop-font-sources-and-kerning

Removes all sources and kerning data.

## Usage in Workflows

Workflows are defined in YAML format. Here's an example workflow:

```yaml
steps:
  - input:
      fontra-read:
        source: ./source-font.fontra

  - filter:
      auto-position-diacritics: {}

  - filter:
      round-coordinates: {}

  - output:
      fontra-write:
        destination: ./output-font.fontra
```

## Creating Custom Actions

To create a custom filter action:

1. Create a new module in `fontra/workflow/actions/`
2. Define your action class inheriting from `BaseFilter`
3. Register it with `@registerFilterAction("action-name")`
4. Implement the appropriate `process*` methods

Example:

```python
from dataclasses import dataclass
from .base import BaseFilter, registerFilterAction

@registerFilterAction("my-custom-action")
@dataclass(kw_only=True)
class MyCustomAction(BaseFilter):
    myParameter: str = "default"

    async def processGlyph(self, glyph: VariableGlyph) -> VariableGlyph:
        # Transform glyph
        return glyph
```
