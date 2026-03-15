// Vercel serverless entrypoint
// all requests are forwarded here by vercel.json

const app = require('../server/index.js');
module.exports = app;