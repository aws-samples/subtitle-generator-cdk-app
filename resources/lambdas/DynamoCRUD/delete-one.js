const AWS = require("aws-sdk");

const TABLE_NAME = process.env.TABLE_NAME || '';
const PRIMARY_KEY = process.env.PRIMARY_KEY || '';
const BUCKET_NAME = process.env.BUCKET_NAME;

const db = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();

const headers = {
    "Access-Control-Allow-Origin": "*",
};

exports.handler = async (event) => {
    const requestedItemId = event.pathParameters.id;
    if (!requestedItemId) {
        return { statusCode: 400, body: `Error: You are missing the path parameter id` };
    }

    const params = {
        TableName: TABLE_NAME,
        Key: {
            [PRIMARY_KEY]: requestedItemId
        }
    };

    try {
        await emptyS3Directory(BUCKET_NAME, `video-subtitle/${requestedItemId}`);

        await s3.deleteObject({
            Bucket: BUCKET_NAME,
            Key: `video-source/${requestedItemId}.mp4`
        }).promise();

        await s3.deleteObject({
            Bucket: BUCKET_NAME,
            Key: `video-transcript/${requestedItemId}.json`
        }).promise();

        await s3.deleteObject({
            Bucket: BUCKET_NAME,
            Key: `video-transcript/${requestedItemId}.txt`
        }).promise();

        await db.delete(params).promise();
        return { statusCode: 200, body: 'Success Video Delete.', headers };
    } catch (dbError) {
        return { statusCode: 500, body: 'Server Error' };
    }
};

async function emptyS3Directory(bucket, dir) {
    const listParams = {
        Bucket: bucket,
        Prefix: dir
    };

    const listedObjects = await s3.listObjectsV2(listParams).promise();

    if (listedObjects.Contents.length === 0) return;

    const deleteParams = {
        Bucket: bucket,
        Delete: { Objects: [] }
    };

    listedObjects.Contents.forEach(({ Key }) => {
        deleteParams.Delete.Objects.push({ Key });
    });

    await s3.deleteObjects(deleteParams).promise();

    if (listedObjects.IsTruncated) await emptyS3Directory(bucket, dir);
}
