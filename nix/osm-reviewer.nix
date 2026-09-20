{
  lib,
  stdenv,
  fetchPnpmDeps,
  makeWrapper,
  nodejs,
  pnpm,
  pnpmConfigHook,
  sources,
}:
let
  manifest = lib.importJSON ../package.json;
  pname = "osm-reviewer";
  inherit (manifest) version;

  pnpmDeps = fetchPnpmDeps {
    inherit pname version pnpm;
    src = sources.manifest;
    # pnpm 12 rejects fetcherVersion 3; 4 is the only value this nixpkgs accepts.
    fetcherVersion = 4;
    hash = "sha256-/fDe8RYkGPuEir+X/DsHtyHXwaZ3HxNdrSgLAMs44Cw=";
  };

  # `pnpm prune --prod` hangs in the build sandbox: it re-runs pnpm 12's
  # supply-chain verification, which pnpmConfigHook only disables for
  # `pnpm install`. Resolving the runtime tree in its own derivation reaches the
  # same result through the supported path, and keeps the dev dependencies out
  # of the runtime closure.
  prodModules = stdenv.mkDerivation {
    name = "${pname}-${version}-node-modules-prod";
    src = sources.manifest;
    inherit pnpmDeps;
    pnpmInstallFlags = [ "--prod" ];

    nativeBuildInputs = [
      nodejs
      pnpm
      pnpmConfigHook
    ];

    dontBuild = true;
    dontFixup = true;

    installPhase = ''
      runHook preInstall
      mkdir -p $out
      cp -r node_modules $out/node_modules
      runHook postInstall
    '';
  };
in
stdenv.mkDerivation {
  inherit pname version pnpmDeps;

  src = sources.app;

  nativeBuildInputs = [
    makeWrapper
    nodejs
    pnpm
    pnpmConfigHook
  ];

  buildPhase = ''
    runHook preBuild
    pnpm build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/lib/osm-reviewer
    cp -r build package.json $out/lib/osm-reviewer/
    cp -r ${prodModules}/node_modules $out/lib/osm-reviewer/node_modules

    makeWrapper ${lib.getExe' nodejs "node"} $out/bin/osm-reviewer \
      --chdir $out/lib/osm-reviewer \
      --add-flags $out/lib/osm-reviewer/build/index.js \
      --set-default NODE_ENV production

    runHook postInstall
  '';

  dontStrip = true;

  passthru = { inherit prodModules; };

  meta = {
    inherit (manifest) description;
    mainProgram = "osm-reviewer";
    platforms = lib.platforms.linux;
  };
}
