{ pkgs, self }:

# Boots the NixOS module in a real VM. This is the only thing that exercises the systemd
# sandbox: a build-sandbox check has no init, so it cannot tell you that
# MemoryDenyWriteExecute stops V8 from starting or that ProtectSystem=strict blocks the
# database write. Both of those were found here.
#
# Deliberately not in `checks`: it needs /dev/kvm to be practical, and `nix flake check`
# would then fail for environmental reasons on machines that have none.
# Run it with `nix build .#vm-test`.
pkgs.testers.runNixOSTest {
  name = "osm-reviewer-service";

  nodes.machine = {
    imports = [ self.nixosModules.default ];

    services.osm-reviewer = {
      enable = true;
      port = 3000;
      origin = "http://127.0.0.1:3000";
    };

    environment.systemPackages = [ pkgs.curl ];
    virtualisation.memorySize = 2048;
    virtualisation.diskSize = 4096;
  };

  testScript = ''
    machine.wait_for_unit("osm-reviewer.service")
    machine.wait_for_open_port(3000)

    body = machine.succeed("curl -fsSL http://127.0.0.1:3000/")
    assert "<!doctype html>" in body.lower(), body[:200]

    # WAL means the service writes three files, not one — a StateDirectory that only
    # allowed the database itself would pass a naive check and fail in use.
    machine.succeed("test -f /var/lib/private/osm-reviewer/osm-reviewer.db")
    machine.succeed("test -f /var/lib/private/osm-reviewer/osm-reviewer.db-wal")

    machine.succeed("systemctl restart osm-reviewer.service")
    machine.wait_for_unit("osm-reviewer.service")
    machine.wait_for_open_port(3000)
    machine.succeed("curl -fsSL http://127.0.0.1:3000/ >/dev/null")

    print(machine.succeed("systemd-analyze security osm-reviewer.service --no-pager"))
  '';
}
