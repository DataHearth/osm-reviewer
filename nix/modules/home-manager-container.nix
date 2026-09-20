self:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.osm-reviewer.container;
  image = self.packages.${pkgs.stdenv.hostPlatform.system}.image;
  podman = lib.getExe config.services.podman.package;
in
{
  options.services.osm-reviewer.container = {
    enable = lib.mkEnableOption "the OSM reviewer as a rootless podman container in services.podman.containers";

    image = lib.mkOption {
      type = lib.types.str;
      # podman files a loaded image without a registry under localhost/.
      default = "localhost/${image.imageName}:${image.imageTag}";
      defaultText = lib.literalExpression ''"localhost/osm-reviewer:''${version}"'';
      example = "ghcr.io/datahearth/osm-reviewer:0.9.3";
      description = "Image reference to run. Set `imageStream` to null when this names a registry image.";
    };

    imageStream = lib.mkOption {
      type = lib.types.nullOr lib.types.package;
      default = image;
      defaultText = lib.literalExpression "osm-reviewer.packages.\${system}.image";
      description = "Nix-built image loaded into podman before start; null pulls `image` instead.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 3000;
      description = "Host port the container is published on.";
    };

    host = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Host address the port is published on.";
    };

    origin = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "https://review.example.org";
      description = ''
        Public URL the app is served under. adapter-node compares this against
        the Origin header on form submissions, so it must be set (including
        scheme) whenever the app sits behind a reverse proxy.
      '';
    };

    volume = lib.mkOption {
      type = lib.types.str;
      default = "osm-reviewer";
      description = ''
        Named volume or host path mounted on /data, where the SQLite database lives.
        A named volume takes the image's ownership; a host path must be writable by
        uid 1000 inside the container's user namespace.
      '';
    };

    environment = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = { };
      example = {
        SSO_ENABLED = "false";
      };
      description = "Extra environment variables for the container.";
    };

    environmentFiles = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      description = ''
        Files of secrets read into the container's environment, e.g. the first admin's
        SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD. Not copied into the Nix store.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = !(config.services.osm-reviewer.enable or false);
        message = "services.osm-reviewer.enable and services.osm-reviewer.container.enable both run the app; pick one.";
      }
    ];

    services.podman.enable = lib.mkDefault true;

    services.podman.containers.osm-reviewer = {
      inherit (cfg) image;
      ports = [ "${cfg.host}:${toString cfg.port}:3000" ];
      volumes = [ "${cfg.volume}:/data" ];
      environment = lib.optionalAttrs (cfg.origin != null) { ORIGIN = cfg.origin; } // cfg.environment;
      environmentFile = cfg.environmentFiles;
      dropCapabilities = [ "ALL" ];
      extraPodmanArgs = [
        "--read-only"
        "--tmpfs=/tmp"
        "--security-opt=no-new-privileges"
      ];
      # home-manager's podman module only pulls from registries; this is the
      # counterpart of oci-containers' imageStream, loading the Nix-built image first.
      extraConfig = lib.optionalAttrs (cfg.imageStream != null) {
        Service.ExecStartPre = toString (
          pkgs.writeShellScript "osm-reviewer-load-image" "${cfg.imageStream} | ${podman} load"
        );
      };
    };
  };
}
