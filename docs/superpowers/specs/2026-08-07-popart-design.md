# Pop-art halftone background design

## Goal

Add a subtle pop-art halftone-dot background to the whole site while keeping the main content area clean.

## Decisions

- **Scope:** full site (`body::before` overlay).
- **Background form:** halftone dots only at the edges, fading to transparent toward the center.
- **Dot color:** black dots in light mode, white dots in dark mode.
- **Component styling:** no changes to cards, buttons, or headings — only the background.
- **Implementation:** pure CSS radial-gradient, no extra images or assets.

## Visual behavior

- A fixed, full-viewport `::before` pseudo-element sits behind all content.
- The pseudo-element uses a repeating radial gradient to draw the dots.
- A radial `mask-image` makes dots fully visible at the viewport edges and fade to nothing near the center.
- `pointer-events: none` so the overlay never blocks clicks.

## CSS outline

```scss
body::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background-image: radial-gradient(
    circle,
    var(--popart-dot-color) 1.5px,
    transparent 2px
  );
  background-size: 12px 12px;
  -webkit-mask-image: radial-gradient(
    ellipse at center,
    transparent 30%,
    black 80%
  );
  mask-image: radial-gradient(
    ellipse at center,
    transparent 30%,
    black 80%
  );
}
```

## Theme variables

Light mode:

```scss
--popart-dot-color: #{v.$black-color};
```

Dark mode:

```scss
--popart-dot-color: #{v.$grey-color-light};
```

## Tunables

| Property | Default | Effect |
|----------|---------|--------|
| `background-size` | `12px 12px` | Dot density |
| Dot radius in gradient | `1.5px` / `2px` | Dot size |
| Mask transparent stop | `30%` | Size of the clean center area |
| Mask black stop | `80%` | How far the dots reach inward |

## Files to change

- `_sass/_themes.scss` — add CSS variables and `body::before` rule.

## Out of scope

- No changes to `_config.yml`.
- No new assets or images.
- No changes to typography, cards, buttons, or navigation.

## Risks

- `mask-image` has good modern-browser support but still needs `-webkit-` prefix for Safari.
- The overlay must stay behind content and not interfere with scrolling or clicking.
