import { expect, test } from "bun:test"
import path from "path"

test("Unix installer installs the CrokCode release binary", async () => {
  const script = await Bun.file(path.join(import.meta.dir, "../public/install.sh")).text()

  expect(script).toContain('INSTALL_DIR=${CROKCODE_INSTALL_DIR:-$HOME/.crokcode/bin}')
  expect(script).toContain('mv "$tmp_dir/bin/crokcode" "${INSTALL_DIR}/crokcode"')
  expect(script).not.toContain("opencode")
})
