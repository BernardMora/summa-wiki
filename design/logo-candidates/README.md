# Candidatos de logo

- `SU0..SU5` — para la marca **Summa**. Generados con Higgsfield (Recraft V4.1,
  `model_type: vector`), tres direcciones: S sola, monograma SW, y una Σ como
  comodín. Hoja de contacto en `sheet-summa.png`.
- `W1..W4` — generados con Higgsfield (Recraft V4.1, modo vector), a partir de
  la idea "libro abierto cuyas páginas forman la W". Salen como SVG real, no
  ráster. Ojo: usan `rgb(39,61,249)`, no el `#2f5fbf` de la app.
- `A..D` — dibujados a mano sobre el concepto de λόγος (Λ) y el grafo de enlaces.
- `sheet.png` / `sheet2.png` — hojas de contacto a 110/48/32/16 px, que es
  donde se decide si un icono sirve.

## Dos cosas que Recraft hace siempre y hay que corregir a mano

**El color no obedece.** Se le pasó `background_color: "#2f5fbf"` y `colors`
explícitos; devolvió `rgb(32,48,246)`, `rgb(24,58,247)` y `rgb(44,50,240)` —
un azul distinto en cada variante y ninguno el pedido. Es la misma queja
anotada arriba para `W1..W4`, así que ya no es casualidad: **el azul se
corrige editando el SVG después**, no pidiéndolo en el prompt.

**Las esquinas son blanco opaco, no transparencia.** El redondeado viene
pintado de blanco para simularlo, lo que deja cuatro cuadros blancos en el Dock
y sobre cualquier fondo que no sea blanco. Se arregla envolviendo el arte en un
`clipPath` de esquinas redondeadas, que además vuelve innecesarias esas formas.

## Lo que enseñó la hoja de contacto

**Dos letras no sobreviven a 16 px.** `SU3` (SW lado a lado) y `SU4` (ligadura
SW) se leen bien a 110 px y son una mancha ilegible a 16 y 32. No es un
problema de ejecución: son el doble de trazos en el mismo ancho. Coincide con
el argumento de marca —el producto se llama Summa, no Summa Wiki— pero aquí
falla por geometría, que es un motivo independiente y más difícil de discutir.

`SU3` además salió con una barra vertical parásita después de la W.

## Elegido: `SW-compuesta.svg`

No salió de un prompt: es un COMPUESTO de dos candidatos. Las letras Didone
vienen de `SB1` (paths 5-8, incluidas sus contraformas) y el libro de `SB3`
(paths 9-10), identificados por bounding box y recolocados por coordenada, no a
ojo. Re-promptear no habría devuelto justo esas dos piezas.

También lleva las dos correcciones de rigor: el azul forzado a `#2f5fbf` —
Recraft había devuelto `rgb(14,69,240)` y `rgb(5,87,251)`, uno distinto por
variante — y el `clipPath` que sustituye las esquinas de blanco opaco.

Ya está copiado a `public/wiki-icon.svg` y generado con `npm run icons &&
npm run brand`. Para cambiarlo, se repite ese par de comandos con otro SVG.

Nota de fidelidad: `make-icon.mjs` rasteriza con `capturePage`, que aplica el
perfil de color de la pantalla, así que los PNG salen un pelo corridos del hex
exacto. El SVG —que es lo que se sirve como favicon— sí lleva el valor literal.
