const AWS = require('aws-sdk');

const TABLE_NAME = process.env.TABLE_NAME || '';
const db = new AWS.DynamoDB.DocumentClient();

const headers = {
    "Access-Control-Allow-Origin": "*",
};

exports.handler = async (event, context) => {
    const userName = event.queryStringParameters.user;
    const params = {
        TableName: TABLE_NAME,
        FilterExpression: '#l = :l',
        ExpressionAttributeNames: { '#l': 'userName' },
        ExpressionAttributeValues: { ':l': userName }
    };


    try {
        const response = await db.scan(params).promise();
        return { statusCode: 200, body: JSON.stringify(response.Items), headers };
    } catch (dbError) {
        return { statusCode: 500, body: JSON.stringify(dbError) };
    }
};
