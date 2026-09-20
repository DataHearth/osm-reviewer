{
  lib,
  runCommand,
  kubernetes-helm,
}:
let
  chartYaml = builtins.readFile ../chart/Chart.yaml;
  version = lib.head (builtins.match ".*\nversion: ([^\n]+)\n.*" chartYaml);
in
runCommand "osm-reviewer-chart-${version}" { nativeBuildInputs = [ kubernetes-helm ]; } ''
  export HOME=$(mktemp -d)
  mkdir $out
  helm package ${../chart} --destination $out
''
