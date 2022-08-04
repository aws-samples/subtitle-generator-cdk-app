import * as cdk from "aws-cdk-lib";
import {Construct} from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as s3Deployment from "aws-cdk-lib/aws-s3-deployment";
import * as cloudfrontOrigins from "aws-cdk-lib/aws-cloudfront-origins";
import * as path from "path";

export class StaticWebStack extends cdk.Stack {
    public readonly staticWebBucket: s3.Bucket;
    public readonly staticWebDistribution: cloudfront.Distribution;

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        this.staticWebBucket = new s3.Bucket(this, 'StaticWebBucket', {
            removalPolicy: cdk.RemovalPolicy.RETAIN
        });

        new s3Deployment.BucketDeployment(this, 'StaticWebBucketDeployment', {
            destinationBucket: this.staticWebBucket,
            sources: [s3Deployment.Source.asset(path.resolve(__dirname, '../static-web'))]
        })

        const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'StaticWebOriginAccessIdentity');
        this.staticWebBucket.grantRead(originAccessIdentity);

        this.staticWebDistribution = new cloudfront.Distribution(this, 'StaticWebDistribution', {
            defaultRootObject: 'index.html',
            defaultBehavior: {
                origin: new cloudfrontOrigins.S3Origin(this.staticWebBucket, {originAccessIdentity}),
                allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
                originRequestPolicy: cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN,
            },
            errorResponses: [
                {
                    responsePagePath: '/index.html',
                    httpStatus: 403,
                    responseHttpStatus: 403,
                },
                {
                    responsePagePath: '/index.html',
                    httpStatus: 404,
                    responseHttpStatus: 404,
                },
            ],
        });



        this.staticWebBucket.addCorsRule({
            allowedMethods: [
                s3.HttpMethods.GET,
            ],
            allowedOrigins: ['*'],
            allowedHeaders: ['*'],
        });

        new cdk.CfnOutput(this, 'StaticWebDistributionUrl', {value: this.staticWebDistribution.distributionDomainName});

    }
}
