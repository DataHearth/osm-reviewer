self:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.osm-reviewer;
in
{
  options.services.osm-reviewer = {
    enable = lib.mkEnableOption "the OSM reviewer web application as a user service";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.osm-reviewer;
      defaultText = lib.literalExpression "osm-reviewer.packages.\${system}.osm-reviewer";
      description = "Package providing the osm-reviewer server.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 3000;
      description = "TCP port the server listens on.";
    };

    host = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Address the server binds to.";
    };

    origin = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "https://review.example.org";
      description = ''
        Public URL the app is served under. adapter-node compares this against
        the Origin header on form submissions, so it must be set (including
        scheme and any non-default port) whenever the app sits behind a reverse
        proxy, or every POST will be rejected as cross-site.
      '';
    };

    dataDir = lib.mkOption {
      type = lib.types.str;
      default = "${config.xdg.stateHome}/osm-reviewer";
      defaultText = lib.literalExpression ''"''${config.xdg.stateHome}/osm-reviewer"'';
      description = "Directory holding the SQLite database.";
    };

    environment = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = { };
      example = {
        BODY_SIZE_LIMIT = "1M";
      };
      description = "Extra environment variables, applied after the ones derived from the options above.";
    };

    environmentFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      description = "systemd EnvironmentFile holding secrets.";
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.user.tmpfiles.rules = [ "d ${cfg.dataDir} 0700 - - - -" ];

    systemd.user.services.osm-reviewer = {
      Unit = {
        Description = "OSM reviewer web application";
        After = [ "network-online.target" ];
        Wants = [ "network-online.target" ];
      };

      Install.WantedBy = [ "default.target" ];

      Service = {
        Environment = lib.mapAttrsToList (name: value: "${name}=${value}") (
          {
            NODE_ENV = "production";
            HOST = cfg.host;
            PORT = toString cfg.port;
            DATABASE_PATH = "${cfg.dataDir}/osm-reviewer.db";
          }
          // lib.optionalAttrs (cfg.origin != null) { ORIGIN = cfg.origin; }
          // cfg.environment
        );

        EnvironmentFile = lib.optional (cfg.environmentFile != null) (toString cfg.environmentFile);

        ExecStart = lib.getExe cfg.package;
        Restart = "on-failure";
        RestartSec = 5;

        CapabilityBoundingSet = [ "" ];
        LockPersonality = true;
        # See the NixOS module: V8's JIT needs writable-then-executable pages.
        MemoryDenyWriteExecute = false;
        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectHostname = true;
        ProtectKernelLogs = true;
        ProtectKernelModules = true;
        ProtectKernelTunables = true;
        RestrictAddressFamilies = [
          "AF_INET"
          "AF_INET6"
          "AF_UNIX"
          "AF_NETLINK"
        ];
        RestrictNamespaces = true;
        RestrictRealtime = true;
        RestrictSUIDSGID = true;
        SystemCallArchitectures = "native";
        SystemCallFilter = [
          "@system-service"
          "~@privileged"
          "~@resources"
        ];
        UMask = "0077";
      };
    };
  };
}
