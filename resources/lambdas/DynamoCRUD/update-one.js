const AWS = require('aws-sdk');

const TABLE_NAME = process.env.TABLE_NAME || '';
const PRIMARY_KEY = process.env.PRIMARY_KEY || '';
const DISTRIBUTION_ID = process.env.DISTRIBUTION_ID || '';

const RESERVED_RESPONSE = `Error: You're using AWS reserved keywords as attributes`,
    DYNAMODB_EXECUTION_ERROR = `Error: Execution update, caused a Dynamodb error, please take a look at your CloudWatch Logs.`;


const db = new AWS.DynamoDB.DocumentClient();
const cloudFront = new AWS.CloudFront();

const headers = {
    // "Access-Control-Allow-Origin": CF_URL,
    // "Access-Control-Allow-Credentials": true,
    "Access-Control-Allow-Origin": "*",
};

exports.handler = async (event, context) => {

    if (!event.body) {
        return { statusCode: 400, body: 'invalid request, you are missing the parameter body' };
    }

    const editedItemId = event.pathParameters.id;
    if (!editedItemId) {
        return { statusCode: 400, body: 'invalid request, you are missing the path parameter id' };
    }

    const editedItem = JSON.parse(event.body);

    if (editedItem['isSubtitleEdit']) {
        delete editedItem.isSubtitleEdit;
        cloudFront.createInvalidation({
            DistributionId: DISTRIBUTION_ID, /* required */
            InvalidationBatch: { /* required */
                CallerReference: (new Date()).toString(), /* required */
                Paths: { /* required */
                    Quantity: 1, /* required */
                    Items: [
                        '/video-subtitle/' + editedItemId + '/*',
                    ]
                }
            }
        });
    }


    const editedItemProperties = Object.keys(editedItem);
    if (!editedItem || editedItemProperties.length < 1) {
        return { statusCode: 400, body: 'invalid request, no arguments provided' };
    }

    const firstProperty = editedItemProperties.splice(0, 1);
    const params = {
        TableName: TABLE_NAME,
        Key: {
            [PRIMARY_KEY]: editedItemId
        },
        UpdateExpression: `set ${firstProperty} = :${firstProperty}`,
        ExpressionAttributeValues: {},
        ReturnValues: 'UPDATED_NEW'
    }
    params.ExpressionAttributeValues[`:${firstProperty}`] = editedItem[`${firstProperty}`];

    editedItemProperties.forEach(property => {
        params.UpdateExpression += `, ${property} = :${property}`;
        params.ExpressionAttributeValues[`:${property}`] = editedItem[property];
    });

    try {
        await db.update(params).promise();
        return { statusCode: 204, body: '', headers };
    } catch (dbError) {
        const errorResponse = dbError.code === 'ValidationException' && dbError.message.includes('reserved keyword') ?
            DYNAMODB_EXECUTION_ERROR : RESERVED_RESPONSE;
        return { statusCode: 500, body: errorResponse };
    }
};
