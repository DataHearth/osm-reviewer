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
in
{
  options.services.osm-reviewer.container = {
    enable = lib.mkEnableOption "the OSM reviewer as a container in virtualisation.oci-containers";

    image = lib.mkOption {
      type = lib.types.str;
      default = "${image.imageName}:${image.imageTag}";
      defaultText = lib.literalExpression ''"osm-reviewer:''${version}"'';
      example = "ghcr.io/datahearth/osm-reviewer:0.1.0";
      description = "Image reference to run. Set `imageStream` to null when this names a registry image.";
    };

    imageStream = lib.mkOption {
      type = lib.types.nullOr lib.types.package;
      default = image;
      defaultText = lib.literalExpression "osm-reviewer.packages.\${system}.image";
      description = "Nix-built image loaded into the runtime before start; null pulls `image` instead.";
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
        uid 1000.
      '';
    };

    environment = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = { };
      example = {
        SSO_ISSUER = "https://auth.example.net";
        SSO_PROVIDER = "Authelia";
      };
      description = "Extra environment variables for the container.";
    };

    environmentFiles = lib.mkOption {
      type = lib.types.listOf lib.types.path;
      default = [ ];
      description = ''
        Files of secrets read into the container's environment, e.g. the first admin's
        SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD, or SSO_CLIENT_SECRET. Not copied into
        the Nix store.
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

    virtualisation.oci-containers.containers.osm-reviewer = {
      inherit (cfg) image imageStream environmentFiles;
      ports = [ "${cfg.host}:${toString cfg.port}:3000" ];
      volumes = [ "${cfg.volume}:/data" ];
      environment = lib.optionalAttrs (cfg.origin != null) { ORIGIN = cfg.origin; } // cfg.environment;
      extraOptions = [
        "--read-only"
        "--tmpfs=/tmp"
        "--cap-drop=ALL"
        "--security-opt=no-new-privileges"
      ];
    };
  };
}
