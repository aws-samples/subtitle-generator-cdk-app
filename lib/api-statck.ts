import * as cdk from "aws-cdk-lib";
import {Construct} from "constructs";
import * as stepFunctions from "aws-cdk-lib/aws-stepfunctions";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apiGateway from "aws-cdk-lib/aws-apigateway";
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as cognito from "aws-cdk-lib/aws-cognito";

export interface ApiStackProps extends cdk.StackProps {
    readonly assetsBucket: s3.Bucket;
    readonly staticWebBucket: s3.Bucket;
    readonly bucketAccessPolicyStatement: iam.PolicyStatement;
    readonly createSubtitleStateMachine: stepFunctions.StateMachine;
    readonly dynamoVideoTable: dynamodb.Table;
    readonly assetsDistribution: cloudfront.Distribution;
    readonly staticWebDistribution: cloudfront.Distribution;
    readonly userPool: cognito.UserPool;
}

export class ApiStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: ApiStackProps) {

        super(scope, id, props);

        const uuidLayer = new lambda.LayerVersion(this, 'UUIDLayer', {
            code: lambda.Code.fromAsset('resources/lambdas/layers/uuidLayer.zip'),
            description: 'UUID Package Layer',
            compatibleRuntimes: [lambda.Runtime.NODEJS_12_X],
            removalPolicy: cdk.RemovalPolicy.DESTROY
        });

        const crudLambdaDefaultProps = {
            runtime: lambda.Runtime.NODEJS_12_X,
            code: lambda.Code.fromAsset('resources/lambdas/DynamoCRUD'),
            timeout: cdk.Duration.minutes(1),
            environment: {
                BUCKET_NAME: props.assetsBucket.bucketName,
                PRIMARY_KEY: 'videoId',
                TABLE_NAME: props.dynamoVideoTable.tableName,
                DISTRIBUTION_ID: props.assetsDistribution.distributionId,
            },
        }

        const getOneLambda = new lambda.Function(this, 'GetOneFunction', {
            ...crudLambdaDefaultProps,
            handler: "get-one.handler",
        });

        const getAllLambda = new lambda.Function(this, 'GetAllFunction', {
            ...crudLambdaDefaultProps,
            handler: "get-all.handler",
        });

        const createOneLambda = new lambda.Function(this, 'CreateOneFunction', {
            ...crudLambdaDefaultProps,
            handler: "create.handler",
            layers: [uuidLayer],
        });

        const updateOneLambda = new lambda.Function(this, 'UpdateOneFunction', {
            ...crudLambdaDefaultProps,
            handler: "update-one.handler",
        });

        const deleteOneLambda = new lambda.Function(this, 'DeleteOneFunction', {
            ...crudLambdaDefaultProps,
            handler: "delete-one.handler",
            layers: [uuidLayer],
        });

        // This lambda is for setting up a static web environment.
        const setStaticWebEnv = new lambda.Function(this, 'SetStaticWebEnv', {
            runtime: lambda.Runtime.NODEJS_12_X,
            code: lambda.Code.fromAsset('resources/lambdas/SetStaticWebEnv'),
            timeout: cdk.Duration.minutes(3),
            environment: {
                BUCKET_NAME: props.staticWebBucket.bucketName,
                DISTRIBUTION_ID: props.staticWebDistribution.distributionId,
            },
            handler: "index.handler",
        });
        setStaticWebEnv.role?.addToPrincipalPolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ["cloudfront:CreateInvalidation"],
                resources: [`*`]
            })
        )
        // Grant the Lambda access to the S3 Bucket
        props.assetsBucket.grantRead(deleteOneLambda);
        props.assetsBucket.grantDelete(deleteOneLambda);
        props.staticWebBucket.grantReadWrite(setStaticWebEnv);

        // Grant the Lambda function read access to the DynamoDB table
        props.dynamoVideoTable.grantReadWriteData(getAllLambda);
        props.dynamoVideoTable.grantReadWriteData(getOneLambda);
        props.dynamoVideoTable.grantReadWriteData(createOneLambda);
        props.dynamoVideoTable.grantReadWriteData(updateOneLambda);
        props.dynamoVideoTable.grantReadWriteData(deleteOneLambda);

        // Integrate the Lambda functions with the API Gateway resource
        const getAllIntegration = new apiGateway.LambdaIntegration(getAllLambda);
        const createOneIntegration = new apiGateway.LambdaIntegration(createOneLambda);
        const getOneIntegration = new apiGateway.LambdaIntegration(getOneLambda);
        const updateOneIntegration = new apiGateway.LambdaIntegration(updateOneLambda);
        const deleteOneIntegration = new apiGateway.LambdaIntegration(deleteOneLambda);

        const setStaticWebEnvIntegration = new apiGateway.LambdaIntegration(setStaticWebEnv);

        const invokeExecutionAPIRole = new iam.Role(this, "InvokeExecutionAPIRole", {
            assumedBy: new iam.ServicePrincipal("apigateway.amazonaws.com"),
            inlinePolicies: {
                allowSFNInvoke: new iam.PolicyDocument({
                    statements: [
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: ["states:StartExecution"],
                            resources: [props.createSubtitleStateMachine.stateMachineArn]
                        })
                    ]
                })
            }
        });
        const createSubtitleIntegration = new apiGateway.Integration({
            type: apiGateway.IntegrationType.AWS,
            integrationHttpMethod: "POST",
            uri: `arn:aws:apigateway:${cdk.Aws.REGION}:states:action/StartExecution`,
            options: {
                passthroughBehavior: apiGateway.PassthroughBehavior.NEVER,
                requestTemplates: {
                    "application/json": `{
                        "input": "$util.escapeJavaScript($input.json('$'))",
                        "stateMachineArn": "${props.createSubtitleStateMachine.stateMachineArn}"
                    }`
                },
                credentialsRole: invokeExecutionAPIRole,
                integrationResponses: [
                    {
                        selectionPattern: "200",
                        statusCode: "201",
                        responseTemplates: {
                            "application/json": `
                                #set($inputRoot = $input.path('$'))
                                #if($input.path('$.status').toString().equals("FAILED"))
                                    #set($context.responseOverride.status = 500)
                                    {
                                        "error": "$input.path('$.error')",
                                        "cause": "$input.path('$.cause')"
                                    }
                                #else
                                    {
                                        "id": "$context.requestId",
                                        "output": "$util.escapeJavaScript($input.path('$.output'))"
                                    }
                                #end
                            `
                        },
                        responseParameters: {
                            "method.response.header.Access-Control-Allow-Methods": "'OPTIONS,GET,PUT,POST,DELETE,PATCH,HEAD'",
                            "method.response.header.Access-Control-Allow-Headers": "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent'",
                            "method.response.header.Access-Control-Allow-Origin": "'*'"
                        }
                    }
                ]
            }
        });


        // Create an API Gateway resource for each of the CRUD operations
        const api = new apiGateway.RestApi(this, 'videosApi');

        const authorizer = new apiGateway.CfnAuthorizer(this, 'cfnAuth', {
            restApiId: api.restApiId,
            name: 'GenerateSubtitleAppApiAuthorizer',
            type: apiGateway.AuthorizationType.COGNITO,
            identitySource: 'method.request.header.Authorization',
            providerArns: [props.userPool.userPoolArn],
        })

        const methodAuthorizerOptions = {
            authorizationType: apiGateway.AuthorizationType.COGNITO,
            authorizer: {
                authorizerId: authorizer.ref
            }
        }

        const videosResource = api.root.addResource('videos');
        videosResource.addMethod('GET', getAllIntegration, {
            ...methodAuthorizerOptions,
            requestParameters: {
                "method.request.querystring.user": true,
            },
            requestValidatorOptions: {
                requestValidatorName: "querystring-validator",
                validateRequestParameters: true,
                validateRequestBody: false,
            }
        });
        videosResource.addMethod('POST', createOneIntegration, methodAuthorizerOptions);
        addCorsOptions(videosResource);

        const settingResource = api.root.addResource('setting');
        settingResource.addMethod('POST', setStaticWebEnvIntegration);
        addCorsOptions(settingResource);

        const subtitleResource = api.root.addResource('subtitle');

        subtitleResource.addMethod('POST', createSubtitleIntegration, {
            ...methodAuthorizerOptions,
            methodResponses: [
                {
                    statusCode: "201",
                    responseParameters: {
                        "method.response.header.Access-Control-Allow-Methods": true,
                        "method.response.header.Access-Control-Allow-Headers": true,
                        "method.response.header.Access-Control-Allow-Origin": true,
                        'method.response.header.Access-Control-Allow-Credentials': false,
                    }
                }
            ]
        });
        addCorsOptions(subtitleResource);

        const singleVideoResource = videosResource.addResource('{id}');
        singleVideoResource.addMethod('GET', getOneIntegration, methodAuthorizerOptions);
        singleVideoResource.addMethod('PATCH', updateOneIntegration, methodAuthorizerOptions);
        singleVideoResource.addMethod('DELETE', deleteOneIntegration, methodAuthorizerOptions);
        addCorsOptions(singleVideoResource);

        api.addGatewayResponse('ExpiredTokenResponse', {
            responseHeaders: {
                'Access-Control-Allow-Headers':
                    "'Authorization,Content-Type,X-Amz-Date,X-Amz-Security-Token,X-Api-Key'",
                'Access-Control-Allow-Origin': "'*'"
            },
            statusCode: '401',
            type: apiGateway.ResponseType.EXPIRED_TOKEN
        });

        new cdk.CfnOutput(this, 'ApiUrl', {value: api.url});
    }
}

export function addCorsOptions(apiResource: apiGateway.IResource) {
    apiResource.addMethod('OPTIONS', new apiGateway.MockIntegration({
        integrationResponses: [{
            statusCode: '200',
            responseParameters: {
                'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent'",
                'method.response.header.Access-Control-Allow-Origin': "'*'",
                'method.response.header.Access-Control-Allow-Methods': "'OPTIONS,GET,PATCH,PUT,POST,DELETE'",
            },
        }],
        passthroughBehavior: apiGateway.PassthroughBehavior.NEVER,
        requestTemplates: {
            "application/json": "{\"statusCode\": 200}"
        },
    }), {
        methodResponses: [{
            statusCode: '200',
            responseParameters: {
                'method.response.header.Access-Control-Allow-Headers': true,
                'method.response.header.Access-Control-Allow-Methods': true,
                'method.response.header.Access-Control-Allow-Credentials': false,
                'method.response.header.Access-Control-Allow-Origin': true,
            },
        }]
    })
}
