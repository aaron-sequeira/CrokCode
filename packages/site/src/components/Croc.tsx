/**
 * The Pixel Croc, drawn from the exact art the TUI ships in
 * packages/tui/src/logo.ts. Keeping one source for the mascot means the
 * terminal and the site can never drift apart.
 */
const ART = [
  "         ####   #   #   #         ##",
  "       ###########################",
  "  ###### ######################",
  "  #*#*#*######################",
  "     ######################",
  "        ##   ##     ##  ##",
]

const COLS = Math.max(...ART.map((row) => row.length))

export function Croc({ px = 11 }: { px?: number }) {
  return (
    <div
      className="croc"
      role="img"
      aria-label="CrokCode pixel crocodile"
      style={{
        gridTemplateColumns: `repeat(${COLS}, ${px}px)`,
        ["--px" as string]: `${px}px`,
      }}
    >
      {ART.flatMap((row, y) =>
        Array.from({ length: COLS }, (_, x) => {
          const char = row[x] ?? " "
          const on = char === "#" ? "1" : char === "*" ? "2" : undefined
          return (
            <div
              key={`${y}-${x}`}
              className="croc-cell"
              data-on={on}
              // Pixels land left to right, like the TUI painting a frame.
              style={on ? { animationDelay: `${x * 14 + y * 22}ms` } : undefined}
            />
          )
        }),
      )}
    </div>
  )
}
