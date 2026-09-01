const os = require("os");
const { execSync } = require("child_process");

const VIRTUAL_ADAPTER_NAME_PATTERNS = [
    /virtualbox/i,
    /vmware/i,
    /hyper-?v/i,
    /vethernet/i,
    /host[- ]only/i,
    /virtual/i,
    /loopback/i,
];

const PREFERRED_ADAPTER_NAME_PATTERNS = [
    /\bwi[- ]?fi\b/i,
    /\bwlan\b/i,
    /\bwireless\b/i,
    /\bethernet\b/i,
    /\blan\b/i,
];

function isIpv4Family(family) {
    return family === "IPv4" || family === 4;
}

function isValidIpv4(address) {
    if (!address || address === "0.0.0.0") {
        return false;
    }
    const parts = String(address).split(".").map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
        return false;
    }
    return true;
}

/**
 * Known VM/host-only ranges that should not be used unless they carry the
 * active default route.
 */
function isLikelyVirtualHostOnlyRange(address) {
    if (!isValidIpv4(address)) {
        return false;
    }

    const [a, b] = address.split(".").map(Number);
    if (a === 192 && b === 168) {
        // VirtualBox Host-Only Network default.
        const third = Number(address.split(".")[2]);
        return third === 56;
    }
    if (a === 172 && b === 16) {
        return true;
    }
    if (a === 172 && b === 23) {
        return true;
    }
    return false;
}

function isVirtualAdapterName(name) {
    return VIRTUAL_ADAPTER_NAME_PATTERNS.some((pattern) => pattern.test(String(name || "")));
}

function adapterNameScore(name) {
    if (isVirtualAdapterName(name)) {
        return -100;
    }
    if (PREFERRED_ADAPTER_NAME_PATTERNS.some((pattern) => pattern.test(String(name || "")))) {
        return 50;
    }
    return 0;
}

function listIpv4Candidates(interfaces = {}) {
    const candidates = [];

    for (const [name, entries] of Object.entries(interfaces)) {
        for (const entry of entries ?? []) {
            if (!entry || !isIpv4Family(entry.family) || entry.internal) {
                continue;
            }
            if (!isValidIpv4(entry.address)) {
                continue;
            }
            candidates.push({
                name,
                address: entry.address,
            });
        }
    }

    return candidates;
}

function parseWindowsRouteOutput(output) {
    const lines = String(output || "").split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("0.0.0.0")) {
            continue;
        }
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 5 && parts[0] === "0.0.0.0" && parts[1] === "0.0.0.0") {
            const interfaceIp = parts[3];
            if (isValidIpv4(interfaceIp)) {
                return interfaceIp;
            }
        }
    }
    return null;
}

function parseLinuxRouteOutput(output) {
    const line = String(output || "")
        .split(/\r?\n/)
        .find((entry) => entry.startsWith("default"));
    if (!line) {
        return null;
    }

    const devMatch = line.match(/\bdev\s+(\S+)/);
    const interfaceName = devMatch ? devMatch[1] : null;
    if (!interfaceName) {
        return null;
    }

    const interfaces = os.networkInterfaces();
    const entries = interfaces[interfaceName] ?? [];
    for (const entry of entries) {
        if (isIpv4Family(entry.family) && !entry.internal && isValidIpv4(entry.address)) {
            return entry.address;
        }
    }
    return null;
}

function parseDarwinRouteOutput(output) {
    const match = String(output || "").match(/interface:\s*(\S+)/i);
    const interfaceName = match ? match[1] : null;
    if (!interfaceName) {
        return null;
    }

    const interfaces = os.networkInterfaces();
    const entries = interfaces[interfaceName] ?? [];
    for (const entry of entries) {
        if (isIpv4Family(entry.family) && !entry.internal && isValidIpv4(entry.address)) {
            return entry.address;
        }
    }
    return null;
}

function getDefaultRouteInterfaceIp() {
    try {
        if (process.platform === "win32") {
            const output = execSync("route print -4", {
                encoding: "utf8",
                windowsHide: true,
            });
            return parseWindowsRouteOutput(output);
        }

        if (process.platform === "linux") {
            const output = execSync("ip -4 route show default", {
                encoding: "utf8",
            });
            return parseLinuxRouteOutput(output);
        }

        if (process.platform === "darwin") {
            const output = execSync("route -n get default", {
                encoding: "utf8",
            });
            return parseDarwinRouteOutput(output);
        }
    } catch {
        return null;
    }

    return null;
}

/**
 * Select the best LAN IPv4 for phone access logging.
 *
 * @param {NodeJS.Dict<import('os').NetworkInterfaceInfo[]>} interfaces
 * @param {string|null} defaultRouteInterfaceIp
 */
function selectLanIpFromInterfaces(interfaces, defaultRouteInterfaceIp = null) {
    if (
        defaultRouteInterfaceIp &&
        isValidIpv4(defaultRouteInterfaceIp)
    ) {
        return defaultRouteInterfaceIp;
    }

    const candidates = listIpv4Candidates(interfaces)
        .filter((candidate) => !isLikelyVirtualHostOnlyRange(candidate.address))
        .filter((candidate) => !isVirtualAdapterName(candidate.name));

    if (candidates.length === 0) {
        return null;
    }

    candidates.sort((left, right) => {
        const scoreDiff = adapterNameScore(right.name) - adapterNameScore(left.name);
        if (scoreDiff !== 0) {
            return scoreDiff;
        }
        return left.address.localeCompare(right.address);
    });

    return candidates[0].address;
}

function getPhoneAccessLanIp() {
    const defaultRouteInterfaceIp = getDefaultRouteInterfaceIp();
    const interfaces = os.networkInterfaces();
    const address = selectLanIpFromInterfaces(interfaces, defaultRouteInterfaceIp);

    return {
        address,
        defaultRouteInterfaceIp,
        interfaceName: address
            ? listIpv4Candidates(interfaces).find((candidate) => candidate.address === address)
                  ?.name ?? null
            : null,
    };
}

module.exports = {
    isLikelyVirtualHostOnlyRange,
    parseWindowsRouteOutput,
    selectLanIpFromInterfaces,
    getDefaultRouteInterfaceIp,
    getPhoneAccessLanIp,
};
