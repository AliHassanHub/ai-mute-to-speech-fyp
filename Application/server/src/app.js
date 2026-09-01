const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const morgan = require("morgan");


const authRoutes = require("./routes/authRoutes");
const profileRoutes = require("./routes/profileRoutes");
const calibrationRoutes = require("./routes/calibrationRoutes");
const bluetoothRoutes = require("./routes/bluetoothRoutes");
const recordingRoutes = require("./routes/recordingRoutes");
const processedRecordingRoutes = require("./routes/processedRecordingRoutes");
const textResultRoutes = require("./routes/textResultRoutes");
const sessionRoutes = require("./routes/sessionRoutes");
const historyRoutes = require("./routes/historyRoutes");
const inferenceRoutes = require("./routes/inferenceRoutes");

const path = require("path");

const uploadErrorHandler = require("./middlewares/uploadErrorMiddleware");
const { notFoundHandler, errorHandler } = require("./middlewares/errorMiddleware");

const app = express();

app.use(cors());
app.use(helmet({
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: false,
}));
app.use(compression());
app.use(morgan("dev"));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "AI Mute-to-Speech Backend API is running."
    });
});

app.use("/api/auth", authRoutes);
app.use("/api/profile", profileRoutes);
app.use(

    "/uploads",

    express.static(

        path.join(

            process.cwd(),

            "uploads"

        )

    )

);
app.use(uploadErrorHandler);

app.use(

    "/api/sessions",

    sessionRoutes

);

app.use(

    "/api/calibration",

    calibrationRoutes

);

app.use(

    "/api/bluetooth",

    bluetoothRoutes

);

app.use(

    "/api/recordings",

    recordingRoutes

);

app.use(

    "/api/processed-recordings",

    processedRecordingRoutes

);

app.use(

    "/api/text-results",

    textResultRoutes

);

app.use(

    "/api/history",

    historyRoutes

);

app.use(

    "/api/inference",

    inferenceRoutes

);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
