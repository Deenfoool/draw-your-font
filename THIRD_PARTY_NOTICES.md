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

## heic-to and libheif

Used only when the browser cannot decode a selected HEIC or HEIF photograph natively.

- Project: https://github.com/hoppergee/heic-to
- Version: 1.5.2
- License: GNU LGPL 3.0 or later
- Underlying decoder: libheif 1.22.2

The unmodified CSP-compatible distribution file is copied separately to `vendor/heic-codec.mjs`; it is not merged into the application's own source. Its complete license is copied to `vendor/heic-to-LICENSE.txt`, and the corresponding package source remains available from the project and npm package listed above. The deployed application loads this module from the same origin and only on demand for HEIC/HEIF input.

## Scope

The template generator, scanner, perspective correction, recovery interface, glyph editor, project persistence, vectorization, TrueType/WOFF writer, metrics, kerning, CSS and ZIP implementations are part of this repository. Third-party runtime code is used only for WOFF2 output and HEIC/HEIF decoding.
