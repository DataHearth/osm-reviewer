{
  pkgs,
  sources,
  rev,
}:
let
  osm-reviewer = pkgs.callPackage ./osm-reviewer.nix { inherit sources rev; };
in
{
  default = osm-reviewer;
  inherit osm-reviewer;
  image = pkgs.callPackage ./image.nix { inherit osm-reviewer; };
  chart = pkgs.callPackage ./chart.nix { };
}
