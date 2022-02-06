const AWS = require('aws-sdk');

const TABLE_NAME = process.env.TABLE_NAME || '';
const PRIMARY_KEY = process.env.PRIMARY_KEY || '';

const db = new AWS.DynamoDB.DocumentClient();

const headers = {
    // "Access-Control-Allow-Origin": CF_URL,
    // "Access-Control-Allow-Credentials": true,
    "Access-Control-Allow-Origin": "*",
};

exports.handler = async (event, context) => {
    const requestedItemId = event.pathParameters.id;
    if (!requestedItemId) {
        return {statusCode: 400, body: `Error: You are missing the path parameter id`};
    }

    const params = {
        TableName: TABLE_NAME,
        Key: {
            [PRIMARY_KEY]: requestedItemId
        }
    };

    try {
        const response = await db.get(params).promise();
        if (response.Item) {
            return {
                statusCode: 200, body: JSON.stringify(response.Item),
                headers,
            };
        } else {
            return {statusCode: 404};
        }
    } catch (dbError) {
        return {statusCode: 500, body: JSON.stringify(dbError)};
    }
};
