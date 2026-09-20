{
  pkgs,
  sources,
  osm-reviewer,
}:
let
  # Every node-based check reuses the package's already-fetched pnpm store
  # instead of running fetchPnpmDeps again per check.
  mkNodeCheck =
    {
      name,
      script,
      extraInputs ? [ ],
      env ? { },
    }:
    pkgs.stdenv.mkDerivation (
      {
        name = "osm-reviewer-${name}";
        src = sources.full;
        inherit (osm-reviewer) pnpmDeps;

        nativeBuildInputs = [
          pkgs.nodejs
          pkgs.pnpm
          pkgs.pnpmConfigHook
        ]
        ++ extraInputs;

        dontStrip = true;
        dontFixup = true;

        buildPhase = ''
          runHook preBuild
          ${script}
          runHook postBuild
        '';

        installPhase = ''
          runHook preInstall
          touch $out
          runHook postInstall
        '';
      }
      // env
    );
in
{
  # Checked in place in the store rather than from a copy: biome matches its
  # `!**/build` ignore pattern against the absolute path, so anything unpacked
  # under the sandbox's /build working directory is silently skipped and biome
  # reports "no files were processed".
  lint = pkgs.runCommand "osm-reviewer-lint" { nativeBuildInputs = [ pkgs.biome ]; } ''
    export HOME=$(mktemp -d)
    biome ci --colors=off --config-path=${sources.full} ${sources.full}
    touch $out
  '';

  chart = pkgs.runCommand "osm-reviewer-chart" { nativeBuildInputs = [ pkgs.kubernetes-helm ]; } ''
    export HOME=$(mktemp -d)
    helm lint --strict ${../chart} --set origin=https://review.example.test,image.tag=0.0.0
    helm template ${../chart} --set origin=https://review.example.test,image.tag=0.0.0 \
      --set admin.email=a@example.test,admin.password=x \
      --set ingress.enabled=true,httpRoute.enabled=true \
      --set 'httpRoute.parentRefs[0].name=gw' > /dev/null
    touch $out
  '';

  formatting = pkgs.runCommand "osm-reviewer-nixfmt" { nativeBuildInputs = [ pkgs.nixfmt ]; } ''
    nixfmt --check $(find ${sources.nixFiles} -name '*.nix')
    touch $out
  '';

  types = mkNodeCheck {
    name = "types";
    script = "pnpm check";
  };

  unit = mkNodeCheck {
    name = "unit";
    script = "pnpm test";
  };

  e2e = mkNodeCheck {
    name = "e2e";
    extraInputs = [ pkgs.playwright-driver.browsers ];
    env = {
      PLAYWRIGHT_BROWSERS_PATH = pkgs.playwright-driver.browsers;
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
      # The sandbox has no fonts and playwright-driver.browsers carries none, so Chromium
      # measures every glyph as zero wide. Anything sized by its own text then collapses to
      # an empty box, which Playwright reports as `hidden` — the element is there with the
      # right text and never becomes visible. IBM Plex is what the design asks for, so the
      # layout assertions measure the real thing rather than a substitute metric.
      FONTCONFIG_FILE = pkgs.makeFontsConf { fontDirectories = [ pkgs.ibm-plex ]; };
      CI = "1";
    };
    script = "pnpm test:e2e";
  };
}
