# Third-party notices

## fonteditor-core

Used only to encode the final TrueType font as WOFF2.

- Project: https://github.com/kekee000/fonteditor-core
- Version: 2.6.3
- License: MIT
- Copyright: fonteditor-core contributors

The pinned package is bundled during the build into `vendor/woff2-codec.mjs`. The deployed application does not fetch the JavaScript module from a third-party CDN.

## Google WOFF2

The WebAssembly binary distributed by `fonteditor-core` contains Google's WOFF2 reference encoder/decoder.

- Project: https://github.com/google/woff2
- License: MIT
- Copyright: Google Inc. and WOFF2 contributors

It is copied during the build to `vendor/woff2.wasm` and loaded from the same origin as the application.

## Scope

The template generator, scanner, perspective correction, glyph editor, project persistence, vectorization, TrueType/WOFF writer, metrics, kerning, CSS and ZIP implementations are part of this repository and do not require `fonteditor-core` at runtime except when WOFF2 output is requested.
