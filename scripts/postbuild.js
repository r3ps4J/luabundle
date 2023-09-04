const path = require("path");
const fs = require("fs-extra");

fs.copySync(
	path.resolve(__dirname, "..", "src", "bundle", "runtime.lua"),
	path.resolve(__dirname, "..", "dist", "bundle", "runtime.lua")
);
