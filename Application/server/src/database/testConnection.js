const pool = require("../config/db");

const testConnection = async () => {
    try {
        const connection = await pool.getConnection();

        console.log("MySQL Connected Successfully");

        connection.release();

    } catch (error) {

        console.error("MySQL Connection Failed");

        console.error(error.message);

        process.exit(1);

    }
};

module.exports = testConnection;