{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    devshell = {
      url = "github:numtide/devshell";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      devshell,
    }:
    let
      sources = import ./nix/source.nix { inherit (nixpkgs) lib; };
      rev = self.shortRev or self.dirtyShortRev or null;
    in
    flake-utils.lib.eachSystem
      [
        "x86_64-linux"
        "aarch64-linux"
      ]
      (
        system:
        let
          pkgs = import nixpkgs {
            inherit system;
            overlays = [ devshell.overlays.default ];
          };
          packages = import ./nix/packages.nix { inherit pkgs sources rev; };
        in
        {
          packages = packages // {
            vm-test = import ./nix/tests/vm.nix { inherit pkgs self; };
          };

          checks = import ./nix/checks.nix {
            inherit pkgs sources;
            inherit (packages) osm-reviewer;
          };

          devShells.default = pkgs.devshell.mkShell {
            packages = with pkgs; [
              nodejs
              pnpm
              biome
              nixfmt
              kubernetes-helm
              git-cliff
            ];

            env = [
              {
                name = "PLAYWRIGHT_BROWSERS_PATH";
                value = pkgs.playwright-driver.browsers;
              }
              {
                name = "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD";
                value = "1";
              }
            ];

            commands = [
              {
                name = "dev";
                help = "Run the SvelteKit dev server";
                command = ''pnpm dev "$@"'';
                category = "app";
              }
              {
                name = "check";
                help = "Type-check the app (svelte-check)";
                command = ''pnpm check "$@"'';
                category = "quality";
              }
              {
                name = "lint";
                help = "Lint and format-check with Biome";
                command = ''pnpm lint "$@"'';
                category = "quality";
              }
              {
                name = "fmt";
                help = "Apply Biome formatting and safe fixes";
                command = ''pnpm format "$@"'';
                category = "quality";
              }
              {
                name = "test";
                help = "Run the Vitest unit suite";
                command = ''pnpm test "$@"'';
                category = "quality";
              }
              {
                name = "e2e";
                help = "Run the Playwright end-to-end suite";
                command = ''pnpm test:e2e "$@"'';
                category = "quality";
              }
              {
                name = "build";
                help = "Build the app package with Nix (result/bin/osm-reviewer)";
                command = ''nix build .#osm-reviewer "$@"'';
                category = "package";
              }
              {
                name = "image";
                help = "Build the OCI image with Nix and load it into podman or docker";
                command = ''
                  runtime=$(command -v podman || command -v docker) || {
                    echo "image: neither podman nor docker is on PATH" >&2
                    exit 1
                  }
                  "$(nix build .#image --no-link --print-out-paths "$@")" | "$runtime" load
                '';
                category = "package";
              }
              {
                name = "chart-push";
                help = "Package the Helm chart with Nix and push it (after helm registry login)";
                command = ''
                  chart=$(nix build .#chart --no-link --print-out-paths) || exit 1
                  helm push "$chart"/*.tgz "''${1:-oci://ghcr.io/datahearth/charts}"
                '';
                category = "package";
              }
              {
                name = "release";
                help = "Cut an app (v*) or chart (chart-v*) release; run without arguments for usage";
                command = ''"$PRJ_ROOT/scripts/release.sh" "$@"'';
                category = "package";
              }
            ];
          };
        }
      )
    // {
      overlays.default = final: _prev: {
        osm-reviewer = final.callPackage ./nix/osm-reviewer.nix {
          sources = import ./nix/source.nix { inherit (final) lib; };
          inherit rev;
        };
      };

      nixosModules.default = import ./nix/modules/nixos.nix self;
      nixosModules.container = import ./nix/modules/nixos-container.nix self;
      homeModules.default = import ./nix/modules/home-manager.nix self;
      homeModules.container = import ./nix/modules/home-manager-container.nix self;
    };
}
