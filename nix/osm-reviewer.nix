{
  lib,
  stdenv,
  fetchPnpmDeps,
  makeWrapper,
  nodejs,
  nodejs-slim,
  pnpm,
  pnpmConfigHook,
  sources,
  # Null outside a git checkout or for a dirty tree; the app then reports the rev as unknown.
  rev ? null,
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
    hash = "sha256-nczE6817BjzkiRlZFh2Y4gHd4OhzBXVM/pBI/+rhMls=";
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
      # pnpmConfigHook points the CLI shebangs at the full nodejs it installed with, which
      # would pull npm and corepack into the runtime closure for scripts the server never
      # runs. Same version, so nodejs-slim serves them identically.
      grep -rlF --null ${nodejs} $out | xargs -0 -r sed -i "s|${nodejs}|${nodejs-slim}|g"
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

    makeWrapper ${lib.getExe' nodejs-slim "node"} $out/bin/osm-reviewer \
      --chdir $out/lib/osm-reviewer \
      --add-flags $out/lib/osm-reviewer/build/index.js \
      --set-default NODE_ENV production \
      ${lib.optionalString (rev != null) "--set-default OSM_REVIEWER_REV ${rev}"}

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
