// The printers' beds, for grid.js: the printable area in mm with the origin at the bed's front-left corner (the
// slicer's frame, +Y toward the back), the height, and the zones a part must stay out of. Figures from Bambu
// Studio's machine profiles (resources/profiles/BBL/machine/*.json, 2026-10-29): printable_area, bed_exclude_area,
// extruder_printable_area. The viewer centres the bed on the origin, where a part is usually modelled and where the
// slicer drops it anyway.
//   zones: { rect: [x0, y0, x1, y1], why }   hatched; the part may overlap one only if that nozzle is not used
export const PRINTERS = [
  { id: 'p1s', name: 'P1S', size: [256, 256, 256],
    zones: [{ rect: [0, 0, 18, 28], why: 'wipe area, front left' }] },
  { id: 'h2c', name: 'H2C', size: [330, 320, 325],
    // left nozzle reaches 0..325, right nozzle 25..330: a two-nozzle print lives in the middle 300
    zones: [{ rect: [0, 0, 25, 320], why: 'right nozzle cannot reach' }, { rect: [325, 0, 330, 320], why: 'left nozzle cannot reach' }] },
];
export const printer = (id) => PRINTERS.find((p) => p.id === id) ?? null;
