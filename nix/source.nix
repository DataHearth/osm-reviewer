{ lib }:
let
  root = ../.;

  alwaysDropped = [
    ".direnv"
    ".git"
    ".jj"
    ".svelte-kit"
    "build"
    "data"
    "node_modules"
    "playwright-report"
    "test-results"
  ];

  topLevel =
    path: lib.head (lib.splitString "/" (lib.removePrefix "${toString root}/" (toString path)));

  mkSource =
    {
      name,
      exclude ? [ ],
    }:
    builtins.path {
      inherit name;
      path = root;
      filter =
        path: _type:
        let
          top = topLevel path;
        in
        !(lib.elem top alwaysDropped)
        && !(lib.elem top exclude)
        && top != "result"
        && !(lib.hasPrefix "result-" top);
    };
in
{
  app = mkSource {
    name = "osm-reviewer-source";
    exclude = [
      "CLAUDE.md"
      "e2e"
      "flake.lock"
      "flake.nix"
      "nix"
      "tests"
    ];
  };

  full = mkSource {
    name = "osm-reviewer-source-full";
    exclude = [
      "flake.lock"
      "flake.nix"
      "nix"
    ];
  };

  nixFiles = builtins.path {
    name = "osm-reviewer-nix-files";
    path = root;
    filter =
      path: _type:
      let
        top = topLevel path;
      in
      top == "flake.nix" || top == "nix";
  };

  # fetchPnpmDeps only reads the manifest and the lockfile; keeping the input
  # this narrow stops the (expensive) dependency fetch from being invalidated by
  # any other file in the tree.
  manifest = builtins.path {
    name = "osm-reviewer-manifest";
    path = root;
    filter =
      path: _type:
      lib.elem (baseNameOf path) [
        ".npmrc"
        "package.json"
        "pnpm-lock.yaml"
        # Holds pnpm 12's allowBuilds list; without it the install aborts with
        # ERR_PNPM_IGNORED_BUILDS.
        "pnpm-workspace.yaml"
      ];
  };
}
