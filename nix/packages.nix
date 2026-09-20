{ pkgs, sources }:
let
  osm-reviewer = pkgs.callPackage ./osm-reviewer.nix { inherit sources; };
in
{
  default = osm-reviewer;
  inherit osm-reviewer;
}
