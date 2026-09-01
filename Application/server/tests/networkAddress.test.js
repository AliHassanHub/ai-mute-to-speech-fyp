const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const {
    isLikelyVirtualHostOnlyRange,
    parseWindowsRouteOutput,
    selectLanIpFromInterfaces,
    getPhoneAccessLanIp,
} = require("../src/utils/networkAddress");

describe("networkAddress", () => {
    it("flags common virtual host-only ranges", () => {
        assert.equal(isLikelyVirtualHostOnlyRange("192.168.56.1"), true);
        assert.equal(isLikelyVirtualHostOnlyRange("172.16.5.10"), true);
        assert.equal(isLikelyVirtualHostOnlyRange("172.23.48.1"), true);
        assert.equal(isLikelyVirtualHostOnlyRange("192.168.100.26"), false);
    });

    it("parses the Windows default route interface IP", () => {
        const output = `
Active Routes:
Network Destination        Netmask          Gateway       Interface  Metric
          0.0.0.0          0.0.0.0    192.168.100.1  192.168.100.26     35
`;
        assert.equal(parseWindowsRouteOutput(output), "192.168.100.26");
    });

    it("prefers the default-route interface over VirtualBox host-only", () => {
        const interfaces = {
            "VirtualBox Host-Only Network": [
                { family: "IPv4", address: "192.168.56.1", internal: false },
            ],
            "Wi-Fi": [{ family: "IPv4", address: "192.168.100.26", internal: false }],
        };

        assert.equal(
            selectLanIpFromInterfaces(interfaces, "192.168.100.26"),
            "192.168.100.26"
        );
    });

    it("ignores VirtualBox host-only when Wi-Fi is available without route hint", () => {
        const interfaces = {
            "VirtualBox Host-Only Network": [
                { family: "IPv4", address: "192.168.56.1", internal: false },
            ],
            "Wi-Fi": [{ family: "IPv4", address: "192.168.100.26", internal: false }],
        };

        assert.equal(selectLanIpFromInterfaces(interfaces, null), "192.168.100.26");
    });

    it("keeps a virtual-range IP when it is the active default route", () => {
        const interfaces = {
            "VirtualBox Host-Only Network": [
                { family: "IPv4", address: "192.168.56.1", internal: false },
            ],
        };

        assert.equal(
            selectLanIpFromInterfaces(interfaces, "192.168.56.1"),
            "192.168.56.1"
        );
    });

    it("reports the live machine LAN IP diagnostic", () => {
        const result = getPhoneAccessLanIp();
        assert.ok(result, "expected diagnostic result object");
        if (result.address) {
            assert.match(result.address, /^\d+\.\d+\.\d+\.\d+$/);
        }
    });
});
