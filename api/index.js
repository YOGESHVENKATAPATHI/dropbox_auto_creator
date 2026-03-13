// Vercel serverless entrypoint
// all requests are forwarded here by vercel.json

const app = require('../index.js');
module.exports = app;