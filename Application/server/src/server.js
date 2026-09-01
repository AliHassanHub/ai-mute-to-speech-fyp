require("dotenv").config();

const app = require("./app");

const testConnection = require("./database/testConnection");

const { getPhoneAccessLanIp } = require("./utils/networkAddress");

const PORT = process.env.PORT || 5000;

const startServer = async () => {

    await testConnection();

    app.listen(PORT, "0.0.0.0", () => {

        const { address: lanIp, interfaceName, defaultRouteInterfaceIp } =
            getPhoneAccessLanIp();
        console.log(`Server running on http://localhost:${PORT}`);
        if (lanIp) {
            console.log(`Phone access URL: http://${lanIp}:${PORT}/api`);
            if (interfaceName) {
                console.log(
                    `Phone access interface: ${interfaceName} (${lanIp})${
                        defaultRouteInterfaceIp === lanIp ? " [default route]" : ""
                    }`
                );
            }
        }

    });

};

startServer();