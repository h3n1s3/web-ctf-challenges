const express = require('express');

const app = express();

const PORT = Number(process.env.PORT) || 4000;

const FLAG = process.env.FLAG

const ADMIN_SERVICE_TOKEN = process.env.ADMIN_SERVICE_TOKEN;

if (!FLAG) {
    throw new Error("FLAG environment variable is not set.");
}

if (!ADMIN_SERVICE_TOKEN) {
    throw new Error("ADMIN_SERVICE_TOKEN environment variable is not set.");
}

app.get("/health", (req, res) => {
    res.status(200).send("OK");
});

function requireApp(req, res, next) {
    const token = req.get("X-Admin-Service-Token");
    if (token !== ADMIN_SERVICE_TOKEN || !token) {
        return res.status(403).send("Forbidden");
    }
    next();
}

app.get("/api/flag", requireApp, (req, res) => {
    res.json({ flag: FLAG });
});

app.use((req, res) => {
    res.status(404).send("Not Found");
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running on http://0.0.0.0:${PORT}`);
});
