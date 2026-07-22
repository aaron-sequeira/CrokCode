// CrokCode wordmark. Left half ("crok") renders in brand green, right half
// ("code") in the bold foreground. Marker chars (_ ^ ~ ,) are shaded by the
// Logo component; everything else is drawn literally.
//
// Each glyph is 4 columns wide and 5 half-rows tall. `█` fills both halves of a
// row, `▀` the upper half, `▄` the lower half. R keeps a top bar, a shallow bowl
// and a leg so it cannot be misread as a P; K is a stem plus two diagonals.
export const logo = {
  left: ["                   ", "█▀▀▀ █▀▀▄ █▀▀█ █ ▄▀", "█___ █▀█  █__█ █▀▄ ", "▀▀▀▀ ▀  ▀ ▀▀▀▀ ▀  ▀"],
  right: ["             ▄     ", "█▀▀▀ █▀▀█ █▀▀█ █▀▀█", "█___ █__█ █__█ █^^^", "▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀"],
}

// Pixel Croc mascot. # = body (green), * = teeth (cream), space = empty.
// Facing left: brow over an enclosed eye, a narrow two-row snout with teeth
// along the jaw edge, ridged back, tapering up-tail, and four legs.
export const croc = [
  "         ####   #   #   #         ##",
  "       ###########################",
  "  ###### ######################",
  "  #*#*#*######################",
  "     ######################",
  "        ##   ##     ##  ##",
]

export const go = {
  left: ["    ", "█▀▀▀", "█_^█", "▀▀▀▀"],
  right: ["    ", "█▀▀█", "█__█", "▀▀▀▀"],
}

export const marks = "_^~,"
