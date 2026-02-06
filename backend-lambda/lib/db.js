const AWS = require("aws-sdk");

const ddb = new AWS.DynamoDB.DocumentClient();

module.exports = { ddb };
