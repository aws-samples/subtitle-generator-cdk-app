import * as cdk from 'aws-cdk-lib';
import {Construct} from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as cloudfrontOrigins from "aws-cdk-lib/aws-cloudfront-origins";

export interface SharedStackProps extends cdk.StackProps {
    readonly staticWebDistributionDomainName: string;
}

export class SharedStack extends cdk.Stack {
    public readonly assetsBucket: s3.Bucket;
    public readonly bucketAccessPolicyStatement: iam.PolicyStatement;
    public readonly dynamoVideoTable: dynamodb.Table;
    public readonly assetsDistribution: cloudfront.Distribution;

    constructor(scope: Construct, id: string, props: SharedStackProps) {
        super(scope, id, props);

        this.assetsBucket = new s3.Bucket(this, 'VideoBucket', {
            removalPolicy: cdk.RemovalPolicy.RETAIN
        });

        this.bucketAccessPolicyStatement = new iam.PolicyStatement({
            actions: ['s3:DeleteObject', 's3:PutObject', 's3:GetObject'],
            effect: iam.Effect.ALLOW,
            resources: [`${this.assetsBucket.bucketArn}/*`],
        });

        const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'AssetsOriginAccessIdentity');
        this.assetsBucket.grantRead(originAccessIdentity);

        this.assetsDistribution = new cloudfront.Distribution(this, 'AssetsDistribution', {
            defaultBehavior: {
                origin: new cloudfrontOrigins.S3Origin(this.assetsBucket, {originAccessIdentity}),
                allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
                originRequestPolicy: cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN,
            },
        });

        this.assetsBucket.addCorsRule({
            allowedMethods: [
                s3.HttpMethods.GET,
                s3.HttpMethods.PUT,
                s3.HttpMethods.POST,
                s3.HttpMethods.DELETE,
                s3.HttpMethods.HEAD,
            ],
            exposedHeaders: [
                'ETag'
            ],
            allowedOrigins: [`https://${props.staticWebDistributionDomainName}`],
            allowedHeaders: ['*'],
        });

        this.dynamoVideoTable = new dynamodb.Table(this, 'VideoTable', {
            partitionKey: {
                name: 'videoId',
                type: dynamodb.AttributeType.STRING
            },
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        new cdk.CfnOutput(this, 'AssetsBucketName', {value: this.assetsBucket.bucketName});

        new cdk.CfnOutput(this, 'AssetsDistributionUrl', {value: this.assetsDistribution.distributionDomainName});

        new cdk.CfnOutput(this, 'Region', {value: cdk.Stack.of(this).region});
    }
}
