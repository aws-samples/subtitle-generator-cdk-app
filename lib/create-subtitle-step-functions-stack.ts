import * as cdk from 'aws-cdk-lib';
import {Construct} from 'constructs';
import * as stepFunctions from "aws-cdk-lib/aws-stepfunctions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as stepFunctionsTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";

export interface CreateSubtitleStepFunctionsStackProps extends cdk.StackProps {
    readonly assetsBucket: s3.Bucket;
    readonly bucketAccessPolicyStatement: iam.PolicyStatement;
    readonly dynamoVideoTable: dynamodb.Table;
    readonly assetsDistribution: cloudfront.Distribution;
}

export class CreateSubtitleStepFunctionsStack extends cdk.Stack {
    public readonly createSubtitleStateMachine: stepFunctions.StateMachine;

    constructor(scope: Construct, id: string, props: CreateSubtitleStepFunctionsStackProps) {
        super(scope, id, props);

        /** IAM Role List Start **/
        const convertTranscriptToSubtitleLambdaRole = new iam.Role(this, 'ConvertTranscriptToSubtitleLambdaRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
            ]
        });
        convertTranscriptToSubtitleLambdaRole.addToPolicy(props.bucketAccessPolicyStatement);
        props.dynamoVideoTable.grantReadWriteData(convertTranscriptToSubtitleLambdaRole);

        const translateSubtitleLambdaRole = new iam.Role(this, 'TranslateSubtitleLambdaRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                iam.ManagedPolicy.fromAwsManagedPolicyName('TranslateFullAccess'),
            ]
        });
        translateSubtitleLambdaRole.addToPolicy(props.bucketAccessPolicyStatement);
        props.dynamoVideoTable.grantReadWriteData(translateSubtitleLambdaRole);
        /** IAM Role List End **/

        /** Lambda List Start **/
        const convertTranscriptToSubtitleLambda = new lambda.Function(this, 'ConvertTranscriptToSubtitleLambda', {
            role: convertTranscriptToSubtitleLambdaRole,
            runtime: lambda.Runtime.NODEJS_12_X,
            code: lambda.Code.fromAsset('resources/lambdas/ConvertTranscriptToSubtitle'),
            handler: "index.handler",
            environment: {
                BUCKET_NAME: props.assetsBucket.bucketName,
                PRIMARY_KEY: 'videoId',
                TABLE_NAME: props.dynamoVideoTable.tableName,
                CF_URL: `https://${props.assetsDistribution.distributionDomainName}`,
            },
            timeout: cdk.Duration.minutes(5),
        });

        const translateSubtitleLambda = new lambda.Function(this, 'TranslateSubtitleLambda', {
            role: translateSubtitleLambdaRole,
            runtime: lambda.Runtime.NODEJS_12_X,
            code: lambda.Code.fromAsset('resources/lambdas/TranslateSubtitle'),
            handler: "index.handler",
            environment: {
                BUCKET_NAME: props.assetsBucket.bucketName,
                PRIMARY_KEY: 'videoId',
                TABLE_NAME: props.dynamoVideoTable.tableName,
                CF_URL: `https://${props.assetsDistribution.distributionDomainName}`,
            },
            timeout: cdk.Duration.minutes(10),
        });
        /** Lambda List End **/

        /** Step Function Definition Start**/
        const hasTranscript = new stepFunctions.Choice(this, 'HasTranscript');

        const startTranscriptionTask = new stepFunctionsTasks.CallAwsService(this, 'StartTranscriptionTask', {
            service: 'transcribe',
            action: 'startTranscriptionJob',
            iamResources: ['*'],
            parameters: {
                "Media": {
                    "MediaFileUri.$": "States.Format('s3://" + props.assetsBucket.bucketName + "/video-source/{}.mp4', $.videoId)"
                },
                "TranscriptionJobName.$": "$$.Execution.Name",
                "OutputBucketName": props.assetsBucket.bucketName,
                "OutputKey.$": "States.Format('video-transcript/{}.json', $.videoId)",
                "LanguageCode.$": "$.sourceLanguageCode"
            },
            resultPath: '$.transcription',
        });

        const wait10 = new stepFunctions.Wait(this, 'Wait10Seconds', {
            time: stepFunctions.WaitTime.duration(cdk.Duration.seconds(30)),
        });

        const getTranscriptionTask = new stepFunctionsTasks.CallAwsService(this, 'GetTranscriptionTask', {
            service: 'transcribe',
            action: 'getTranscriptionJob',
            iamResources: ['*'],
            parameters: {
                "TranscriptionJobName.$": "$$.Execution.Name"
            },
            resultPath: '$.transcription',
        });

        const isTranscriptionDone = new stepFunctions.Choice(this, 'IsTranscriptionDone');

        const convertTranscriptToSubtitleTask = new stepFunctionsTasks.LambdaInvoke(this, 'ConvertTranscriptToSubtitleTask', {
            lambdaFunction: convertTranscriptToSubtitleLambda,
            outputPath: '$.Payload',
        });

        const translateSubtitleTask = new stepFunctionsTasks.LambdaInvoke(this, 'TranslateSubtitleTask', {
            lambdaFunction: translateSubtitleLambda,
            outputPath: '$.Payload',
        });

        const stepFunctionDefinition =
            hasTranscript
                .when(stepFunctions.Condition.booleanEquals('$.hasTranscript', true), translateSubtitleTask)
                .otherwise(startTranscriptionTask
                    .next(wait10)
                    .next(getTranscriptionTask)
                    .next(isTranscriptionDone
                        .when(stepFunctions.Condition.stringMatches('$.transcription.TranscriptionJob.TranscriptionJobStatus', 'COMPLETED'),
                            convertTranscriptToSubtitleTask.next(translateSubtitleTask))
                        .otherwise(wait10)));

        const createSubtitleStateMachine = new stepFunctions.StateMachine(this, 'CreateSubtitleStateMachine', {
            definition: stepFunctionDefinition,
            stateMachineType: stepFunctions.StateMachineType.STANDARD,
        });
        createSubtitleStateMachine.addToRolePolicy(props.bucketAccessPolicyStatement);
        convertTranscriptToSubtitleLambda.grantInvoke(createSubtitleStateMachine.role);
        translateSubtitleLambda.grantInvoke(createSubtitleStateMachine.role);
        /** Step Function Definition End**/

        this.createSubtitleStateMachine = createSubtitleStateMachine;
    }
}
