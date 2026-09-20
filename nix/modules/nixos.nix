self:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.osm-reviewer;

  defaultDataDir = "/var/lib/osm-reviewer";
  managedDataDir = cfg.dataDir == defaultDataDir;
in
{
  options.services.osm-reviewer = {
    enable = lib.mkEnableOption "the OSM reviewer web application";

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
      default = defaultDataDir;
      description = ''
        Directory holding the SQLite database. The default is provisioned by
        systemd's StateDirectory; any other path must already exist and be
        writable by the service, which with DynamicUser means creating it and
        chowning it yourself.
      '';
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
      description = ''
        systemd EnvironmentFile holding secrets. Read by systemd as root before
        the unit drops privileges, so it need not be readable by the service
        user.
      '';
    };

    openFirewall = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Open `port` in the host firewall.";
    };

    user = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = ''
        User to run as. Null keeps the unit on DynamicUser; setting it opts out
        of DynamicUser, and the account must then exist.
      '';
    };

    group = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Group to run as. Same DynamicUser trade-off as `user`.";
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.services.osm-reviewer = {
      description = "OSM reviewer web application";
      wantedBy = [ "multi-user.target" ];
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];

      environment = {
        NODE_ENV = "production";
        HOST = cfg.host;
        PORT = toString cfg.port;
        DATABASE_PATH = "${cfg.dataDir}/osm-reviewer.db";
      }
      // lib.optionalAttrs (cfg.origin != null) { ORIGIN = cfg.origin; }
      // cfg.environment;

      serviceConfig = {
        ExecStart = lib.getExe cfg.package;
        Restart = "on-failure";
        RestartSec = 5;

        DynamicUser = cfg.user == null && cfg.group == null;
        User = cfg.user;
        Group = cfg.group;

        EnvironmentFile = lib.optional (cfg.environmentFile != null) cfg.environmentFile;

        AmbientCapabilities = [ "" ];
        CapabilityBoundingSet = [ "" ];
        DevicePolicy = "closed";
        LockPersonality = true;
        # V8 maps JIT pages writable and then executable, so enabling this kills
        # the process at startup. Restoring it would mean running node --jitless,
        # at a large performance cost for a request-serving process.
        MemoryDenyWriteExecute = false;
        NoNewPrivileges = true;
        PrivateDevices = true;
        PrivateTmp = true;
        PrivateUsers = true;
        ProcSubset = "pid";
        ProtectClock = true;
        ProtectControlGroups = true;
        ProtectHome = true;
        ProtectHostname = true;
        ProtectKernelLogs = true;
        ProtectKernelModules = true;
        ProtectKernelTunables = true;
        ProtectProc = "invisible";
        ProtectSystem = "strict";
        RemoveIPC = true;
        RestrictAddressFamilies = [
          "AF_INET"
          "AF_INET6"
          "AF_UNIX"
          # glibc's getaddrinfo opens a netlink socket to decide whether the
          # host has usable IPv6; without it, name resolution fails.
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
      }
      // (
        if managedDataDir then
          { StateDirectory = "osm-reviewer"; }
        else
          { ReadWritePaths = [ cfg.dataDir ]; }
      );
    };

    networking.firewall.allowedTCPPorts = lib.mkIf cfg.openFirewall [ cfg.port ];
  };
}
