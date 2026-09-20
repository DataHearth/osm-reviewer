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
          packages = import ./nix/packages.nix { inherit pkgs sources; };
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
            ];
          };
        }
      )
    // {
      overlays.default = final: _prev: {
        osm-reviewer = final.callPackage ./nix/osm-reviewer.nix {
          sources = import ./nix/source.nix { inherit (final) lib; };
        };
      };

      nixosModules.default = import ./nix/modules/nixos.nix self;
      homeModules.default = import ./nix/modules/home-manager.nix self;
    };
}
