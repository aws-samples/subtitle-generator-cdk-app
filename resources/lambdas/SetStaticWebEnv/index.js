const AWS = require("aws-sdk");
const s3 = new AWS.S3();
const cloudfront = new AWS.CloudFront();
const BUCKET_NAME = process.env.BUCKET_NAME;
const DISTRIBUTION_ID = process.env.DISTRIBUTION_ID;


const headers = {
    // "Access-Control-Allow-Origin": CF_URL,
    // "Access-Control-Allow-Credentials": true,
    "Access-Control-Allow-Origin": "*",
};

exports.handler = async (event, context) => {
    if (!event.body) {
        return { statusCode: 400, body: 'invalid request, you are missing the parameter body' };
    }
    const body = typeof event.body == 'object' ? event.body : JSON.parse(event.body);

    await new Promise((resolve, reject) => {
        const s3Params = {
            Bucket: BUCKET_NAME,
            Body: `(function (window) {
  window.__env = window.__env || {};
  
  window.__env.ApiUrl = "${body.ApiUrl}";
  window.__env.AssetsDistributionUrl = "https://${body.AssetsDistributionUrl}";
  window.__env.AssetsBucketName = "${body.AssetsBucketName}";
  window.__env.UserPoolId = "${body.UserPoolId}";
  window.__env.UserPoolClientId = "${body.UserPoolClientId}";
  window.__env.IdentityPoolId = "${body.IdentityPoolId}";
  window.__env.Region = "${body.Region}";
  
}(this));`,
            Key: `env.js`,
        };
        s3.putObject(s3Params, (err, data) => {
            if (err) {
                console.log(err, err.stack);
                reject(err);
            } else {
                resolve(data);
            }
        });
    });

    await new Promise((resolve, reject) => {
        const params = {
            DistributionId: DISTRIBUTION_ID,
            InvalidationBatch: {
                CallerReference: (new Date()).toString(),
                Paths: {
                    Quantity: '1',
                    Items: [
                        '/env.js',
                    ]
                }
            }
        };
        cloudfront.createInvalidation(params, (err, data) => {
            if (err) {
                console.log(err, err.stack); // an error occurred
                reject(err);
            } else {
                console.log(data);           // successful response
                resolve(data);
            }
        });
    });

    return { statusCode: 201, body: 'Success Static Web Environment Setting!', headers };
}
