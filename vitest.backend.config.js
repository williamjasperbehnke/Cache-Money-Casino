module.exports = {
  test: {
    environment: "node",
    globals: true,
    include: ["backend-lambda/**/*.test.js"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json"],
      include: ["backend-lambda/**/*.js"],
      exclude: ["backend-lambda/**/*.test.cjs", "backend-lambda/node_modules/**"],
    },
  },
};
