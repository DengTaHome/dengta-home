# DengTa bundled fonts

The App bundles local WOFF2 files so Android can render the selected type system
without a font CDN:

- DengTa Sans CJK: the default chat/UI face. This WOFF2 preserves the complete
  local Noto Sans SC variable source repertoire, including its supplementary
  Han set, so long AI messages and uncommon names stay visually consistent.

- Noto Sans SC UI: legacy display face kept for older decorative surfaces.
- Noto Serif SC: display headings and companion names.
- LXGW WenKai Lite: short emotional notes and navigation labels.
- Roboto Mono: English data, times and technical labels.

All families are distributed under SIL Open Font License 1.1. The complete
license text for each upstream family is stored beside the font files.
The `DengTaSans-cjk-v2.woff2` asset is the standard chat face; users can switch
to the explicit Follow system mode from Appearance settings when they prefer
their device font.
