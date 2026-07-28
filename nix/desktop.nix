{
  lib,
  stdenv,
  bun,
  nodejs,
  darwin,
  electron_41,
  makeWrapper,
  writableTmpDirAsHomeHook,
  autoPatchelfHook,
  crokcode,
}:
let
  electron = electron_41;
in
stdenv.mkDerivation (finalAttrs: {
  pname = "crokcode-desktop";
  inherit (crokcode)
    version
    src
    node_modules
    patches
    ;

  nativeBuildInputs = [
    bun
    nodejs
    makeWrapper
    writableTmpDirAsHomeHook
  ] ++ lib.optionals stdenv.hostPlatform.isLinux [
    autoPatchelfHook
  ] ++ lib.optionals stdenv.hostPlatform.isDarwin [
    # Ad-hoc sign the .app: --config.mac.identity=null below skips signing.
    darwin.autoSignDarwinBinariesHook
  ];

  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [
    (lib.getLib stdenv.cc.cc)
  ];

  env = crokcode.env // {
    ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
  };

  # https://github.com/electron/electron/issues/31121
  # mac builds use a .app bundle which doesnt have this issue
  postPatch = lib.optionalString stdenv.isLinux ''
    BASE_PATH=packages/desktop
    FILES=(src/main/windows.ts)
    for file in "''${FILES[@]}"; do
      substituteInPlace $BASE_PATH/$file \
        --replace-fail "process.resourcesPath" "'$out/opt/crokcode-desktop/resources'"
    done
  '';

  preBuild = ''
    cp -r "${electron.dist}" $HOME/.electron-dist
    chmod -R u+w $HOME/.electron-dist

    cp -R ${finalAttrs.node_modules}/. .
    patchShebangs node_modules
    patchShebangs packages/*/node_modules
  '';

  buildPhase = ''
    runHook preBuild

    cd packages/desktop

    bun run build
    npx electron-builder --dir \
      --config electron-builder.config.ts \
      --config.mac.identity=null \
      --config.electronDist="$HOME/.electron-dist"

    runHook postBuild
  '';

  installPhase =
    ''
      runHook preInstall
    ''
    + lib.optionalString stdenv.hostPlatform.isDarwin ''
      mkdir -p $out/Applications
      mv dist/mac*/*.app $out/Applications
      makeWrapper "$out/Applications/CrokCode.app/Contents/MacOS/CrokCode" $out/bin/crokcode-desktop
    ''
    + lib.optionalString stdenv.hostPlatform.isLinux ''
      mkdir -p $out/opt/crokcode-desktop
      cp -r dist/linux*-unpacked/{resources,LICENSE*} $out/opt/crokcode-desktop
      makeWrapper ${lib.getExe electron} $out/bin/crokcode-desktop \
        --inherit-argv0 \
        --set ELECTRON_FORCE_IS_PACKAGED 1 \
        --add-flags $out/opt/crokcode-desktop/resources/app.asar \
        --add-flags "\''${NIXOS_OZONE_WL:+\''${WAYLAND_DISPLAY:+--ozone-platform-hint=auto --enable-features=WaylandWindowDecorations --enable-wayland-ime=true}}"
    ''
    + ''
      runHook postInstall
    '';

  autoPatchelfIgnoreMissingDeps = [
    "libc.musl-x86_64.so.1"
  ];

  meta = {
    description = "CrokCode Desktop App";
    mainProgram = "crokcode-desktop";
    inherit (crokcode.meta) homepage license platforms;
  };
})
