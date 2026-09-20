{
  lib,
  dockerTools,
  osm-reviewer,
}:
dockerTools.streamLayeredImage {
  name = "osm-reviewer";
  tag = osm-reviewer.version;

  # A named volume mounted on /data inherits this ownership, which is what lets the
  # unprivileged user write the database without a chown step at start.
  fakeRootCommands = ''
    mkdir -p data tmp
    chown 1000:1000 data
    chmod 1777 tmp
  '';

  config = {
    Cmd = [ (lib.getExe osm-reviewer) ];
    User = "1000:1000";
    Env = [
      "HOST=0.0.0.0"
      "PORT=3000"
      "DATABASE_PATH=/data/osm-reviewer.db"
    ];
    ExposedPorts."3000/tcp" = { };
    Volumes."/data" = { };
  };
}
