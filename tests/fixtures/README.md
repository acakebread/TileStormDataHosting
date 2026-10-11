# Public compatibility fixtures

`public-v1.png` and its exact UTF-8 `public-v1.txt` come from PictureCodec's frozen
public PCF1 v1 fixture. They contain public test text. Keeping a copy here makes
browser checks self-contained, with no cross-repository build or runtime reference.

Generated PNGs, binary bundle samples and synthetic audio belong in ignored
`artifacts/checks`. The browser test page uses generated public data and an
oscillator stream instead of the microphone.
